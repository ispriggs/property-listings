// Valle Vivo — create-checkout-session
// Called by the host dashboard when they click "Send Payment Link" on an accepted booking.
// Creates a Stripe Checkout session with automatic commission split,
// updates the booking record, and drops the payment URL into the conversation thread.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://properties.lev.cr';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // ── 1. Authenticate the host ─────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const { booking_id } = await req.json();
    if (!booking_id) return json({ error: 'booking_id is required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Invalid token' }, 401);

    // ── 2. Load booking + listing ────────────────────────────────────────────
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .select(`
        id, listing_id, requester_id, start_date, end_date, status, payment_status,
        listings (
          id, title, community, price_nightly, price_monthly, cleaning_fee, security_deposit, commission_rate, owner_id
        )
      `)
      .eq('id', booking_id)
      .single();

    if (bookingErr || !booking) return json({ error: 'Booking not found' }, 404);

    const listing = booking.listings as {
      id: string; title: string; community: string | null;
      price_nightly: number | null; price_monthly: number | null;
      cleaning_fee: number | null; security_deposit: number | null;
      commission_rate: number | null; owner_id: string;
    };

    // ── 3. Guard checks ──────────────────────────────────────────────────────
    if (listing.owner_id !== user.id) {
      return json({ error: 'Forbidden — you do not own this listing' }, 403);
    }
    if (booking.status !== 'accepted') {
      return json({ error: 'Booking must be accepted before requesting payment' }, 400);
    }
    if (booking.payment_status === 'paid') {
      return json({ error: 'This booking has already been paid' }, 400);
    }

    // ── 4. Verify host has connected Stripe ──────────────────────────────────
    const { data: hostProfile } = await supabase
      .from('profiles')
      .select('stripe_account_id, stripe_onboarded')
      .eq('id', user.id)
      .single();

    if (!hostProfile?.stripe_account_id || !hostProfile?.stripe_onboarded) {
      return json({
        error: 'Your Stripe account is not connected. Please connect Stripe in your Profile settings first.',
      }, 400);
    }

    // ── 5. Calculate amounts ─────────────────────────────────────────────────
    const nights = Math.round(
      (new Date(booking.end_date).getTime() - new Date(booking.start_date).getTime()) / 86400000,
    );

    let subtotalCents: number;
    let stayDescription: string;

    if (listing.price_nightly) {
      subtotalCents = Math.round(listing.price_nightly * nights * 100);
      stayDescription = `${fmtDate(booking.start_date)} → ${fmtDate(booking.end_date)} · ${nights} night${nights !== 1 ? 's' : ''} @ $${listing.price_nightly}/night`;
    } else if (listing.price_monthly) {
      subtotalCents = Math.round(listing.price_monthly * (nights / 30) * 100);
      stayDescription = `${fmtDate(booking.start_date)} → ${fmtDate(booking.end_date)} · ${nights} days`;
    } else {
      return json({ error: 'Listing has no price set — please update the listing before requesting payment' }, 400);
    }

    const cleaningFeeCents     = listing.cleaning_fee     ? Math.round(listing.cleaning_fee     * 100) : 0;
    const securityDepositCents = listing.security_deposit ? Math.round(listing.security_deposit * 100) : 0;

    // ── Fee structure (applies to rental + cleaning, not refundable deposit) ──
    //
    // Both communities:
    //   Guest pays 2% community giveback + 4% platform fee = 6% total
    //
    // San Mateo only:
    //   Host also pays 3% HOA fee — deducted from host payout via application_fee,
    //   NOT added to the guest total. Tracked separately for reporting.
    //
    const commissionableCents = subtotalCents + cleaningFeeCents;
    const isSanMateo          = listing.community === 'san-mateo';

    const GIVEBACK_RATE   = 2;              // guest-facing, both communities
    const PLATFORM_RATE   = 4;              // guest-facing, both communities (platform revenue)
    const HOST_FEE_RATE   = isSanMateo ? 3 : 0;  // host-side, San Mateo only → HOA fund

    const givebackCents    = Math.round(commissionableCents * GIVEBACK_RATE  / 100);
    const platformFeeCents = Math.round(commissionableCents * PLATFORM_RATE  / 100);
    const hostFeeCents     = Math.round(commissionableCents * HOST_FEE_RATE  / 100);

    // application_fee = everything the platform collects via Stripe
    // (platform revenue + giveback + HOA fee — platform distributes giveback/HOA separately)
    const commissionCents = givebackCents + platformFeeCents + hostFeeCents;

    // Guest total = rental + cleaning + deposit + their fees only (host fee not added to guest)
    const totalCents = subtotalCents + cleaningFeeCents + securityDepositCents + givebackCents + platformFeeCents;

    // ── 6. Build Stripe line items ───────────────────────────────────────────
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: 'usd',
          unit_amount: subtotalCents,
          product_data: { name: listing.title, description: stayDescription },
        },
        quantity: 1,
      },
    ];

    if (cleaningFeeCents > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          unit_amount: cleaningFeeCents,
          product_data: { name: 'Cleaning Fee' },
        },
        quantity: 1,
      });
    }

    if (securityDepositCents > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          unit_amount: securityDepositCents,
          product_data: { name: 'Security Deposit (refundable)' },
        },
        quantity: 1,
      });
    }

    lineItems.push({
      price_data: {
        currency: 'usd',
        unit_amount: givebackCents,
        product_data: { name: `Community Give Back (${GIVEBACK_RATE}%)` },
      },
      quantity: 1,
    });

    lineItems.push({
      price_data: {
        currency: 'usd',
        unit_amount: platformFeeCents,
        product_data: { name: `Valle Vivo Platform Fee (${PLATFORM_RATE}%)` },
      },
      quantity: 1,
    });

    // ── 7. Create Stripe Checkout session ────────────────────────────────────
    // application_fee_amount = Valle Vivo's commission (stays in platform account).
    // transfer_data.destination = host's connected Stripe account (gets the rest automatically).
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${SITE_URL}/host.html?payment=success&booking=${booking.id}`,
      cancel_url:  `${SITE_URL}/host.html?payment=cancelled&booking=${booking.id}`,
      payment_intent_data: {
        application_fee_amount: commissionCents,
        transfer_data: { destination: hostProfile.stripe_account_id },
      },
      metadata: {
        booking_id: booking.id,
        listing_id: booking.listing_id,
      },
    });

    // ── 8. Update booking record ─────────────────────────────────────────────
    await supabase.from('bookings').update({
      stripe_session_id:  session.id,
      payment_status:     'awaiting_payment',
      payment_amount:     totalCents,
      commission_amount:  commissionCents,
    }).eq('id', booking.id);

    // ── 9. Post payment link into the conversation thread ────────────────────
    // Try booking_id first; fall back to listing_id + requester so it works
    // even when the DB trigger doesn't populate booking_id on conversations.
    let { data: conv } = await supabase
      .from('conversations')
      .select('id, unread_user')
      .eq('booking_id', booking.id)
      .maybeSingle();

    if (!conv) {
      const { data: fallback } = await supabase
        .from('conversations')
        .select('id, unread_user')
        .eq('listing_id', booking.listing_id)
        .eq('user_id', booking.requester_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      conv = fallback;
    }

    if (conv) {
      const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
      const lines: string[] = [];
      lines.push(`Rental: ${fmt(subtotalCents)}`);
      if (cleaningFeeCents > 0)     lines.push(`Cleaning fee: ${fmt(cleaningFeeCents)}`);
      if (securityDepositCents > 0) lines.push(`Security deposit (refundable): ${fmt(securityDepositCents)}`);
      lines.push(`Community give back (${GIVEBACK_RATE}%): ${fmt(givebackCents)}`);
      lines.push(`Valle Vivo platform fee (${PLATFORM_RATE}%): ${fmt(platformFeeCents)}`);
      if (hostFeeCents > 0) lines.push(`HOA fee (${HOST_FEE_RATE}%, deducted from host): ${fmt(hostFeeCents)}`);
      lines.push(`─────────────────────`);
      lines.push(`Total: ${fmt(totalCents)} USD`);

      const msgBody =
        `Here is your secure payment link for this booking:\n\n${session.url}\n\n` +
        lines.join('\n') +
        `\n\nPlease complete payment to confirm your stay. The link expires after 24 hours.`;

      await supabase.from('messages').insert({
        conversation_id: conv.id,
        sender_id: user.id,
        body: msgBody,
      });

      await supabase.from('conversations').update({
        last_message_body: 'Payment link sent',
        last_message_at:   new Date().toISOString(),
        unread_user:       (conv.unread_user ?? 0) + 1,
      }).eq('id', conv.id);
    }

    return json({
      url:                session.url,
      session_id:         session.id,
      total_cents:        totalCents,
      commission_cents:   commissionCents,
      platform_fee_cents: platformFeeCents,
      giveback_cents:     givebackCents,
      host_fee_cents:     hostFeeCents,
      platform_rate:      PLATFORM_RATE,
      giveback_rate:      GIVEBACK_RATE,
      host_fee_rate:      HOST_FEE_RATE,
    });

  } catch (err) {
    console.error('[create-checkout-session]', err);
    return json({ error: err.message }, 500);
  }
});
