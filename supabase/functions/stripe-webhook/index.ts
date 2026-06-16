// Ecovilla Rentals — stripe-webhook
// Receives Stripe events and updates booking payment_status.
// IMPORTANT: Deploy with --no-verify-jwt (Stripe calls this, not a browser user).
// Webhook signature verification handles security instead.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});

const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

// Distribute booking funds after payment: transfer the HOST payout out of the
// platform account. Community funds (give-back + host fee), the platform fee, and
// the deposit all REMAIN in the platform account — communities (LEV/ESM) are
// Costa Rica accounts that can't receive Stripe transfers, so they're paid out
// manually via Wise; the deposit is refunded 48h after checkout.
// Idempotent — safe to call again on Stripe webhook retries.
async function distributeFunds(
  stripe: Stripe,
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
) {
  const m = session.metadata ?? {};
  const bookingId = m.booking_id;
  if (!bookingId) return;

  // Idempotency guard: skip if we've already distributed for this booking.
  const { data: bk } = await supabase
    .from('bookings')
    .select('funds_distributed_at')
    .eq('id', bookingId)
    .single();
  if (bk?.funds_distributed_at) {
    console.log(`[stripe-webhook] Funds already distributed for booking ${bookingId} — skipping.`);
    return;
  }

  const hostPayoutCents = parseInt(m.host_payout_cents ?? '0', 10);
  const communityCents  = parseInt(m.community_cents ?? '0', 10);
  const hostAccount     = m.host_account;

  if (!hostAccount) {
    console.error(`[stripe-webhook] No host Stripe account on booking ${bookingId} — aborting distribution.`);
    return;
  }

  // Resolve the charge so the transfer draws from this specific payment's funds.
  const piId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;
  if (!piId) { console.error(`[stripe-webhook] No payment_intent on session ${session.id}`); return; }
  const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
  if (!chargeId) { console.error(`[stripe-webhook] No charge on payment_intent ${piId}`); return; }

  // Host payout (rental + cleaning − host fee) → host connected account.
  if (hostPayoutCents > 0) {
    await stripe.transfers.create({
      amount: hostPayoutCents,
      currency: 'usd',
      destination: hostAccount,
      source_transaction: chargeId,
      transfer_group: bookingId,
      description: `Host payout — booking ${bookingId}`,
      metadata: { booking_id: bookingId, kind: 'host' },
    }, { idempotencyKey: `transfer-host-${bookingId}` });
  }

  // Community funds (give-back + host fee), platform fee, and deposit all remain in
  // the platform account: communities (LEV/ESM) are paid out manually via Wise, and
  // the deposit is refunded to the guest 48h after checkout.
  await supabase.from('bookings')
    .update({ funds_distributed_at: new Date().toISOString() })
    .eq('id', bookingId);

  console.log(`[stripe-webhook] Booking ${bookingId}: host ${hostPayoutCents}¢ transferred via Stripe; community ${communityCents}¢ retained in platform for manual Wise payout.`);
}

serve(async (req) => {
  try {
    // ── 1. Read raw body (required for signature verification) ───────────────
    const body = await req.text();
    const sig  = req.headers.get('stripe-signature');

    if (!sig) {
      return new Response('Missing stripe-signature header', { status: 400 });
    }
    if (!WEBHOOK_SECRET) {
      console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
      return new Response('Webhook secret not configured', { status: 500 });
    }

    // ── 2. Verify the event came from Stripe ─────────────────────────────────
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, WEBHOOK_SECRET);
    } catch (err) {
      console.error('[stripe-webhook] Signature verification failed:', err.message);
      return new Response(`Signature verification failed: ${err.message}`, { status: 400 });
    }

    console.log(`[stripe-webhook] Received event: ${event.type}`);

    // ── 3. Handle events ─────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status !== 'paid') {
        // e.g. bank transfers that are still pending — ignore for now
        return new Response('ok', { status: 200 });
      }

      const bookingId = session.metadata?.booking_id;
      if (!bookingId) {
        console.error('[stripe-webhook] No booking_id in session metadata — session:', session.id);
        return new Response('ok', { status: 200 }); // return 200 so Stripe doesn't retry
      }

      const { error } = await supabase
        .from('bookings')
        .update({ payment_status: 'paid' })
        .eq('id', bookingId)
        .eq('stripe_session_id', session.id); // double-check the session matches

      if (error) {
        console.error('[stripe-webhook] DB update failed:', error);
        return new Response('DB update failed', { status: 500 }); // 500 → Stripe will retry
      }

      console.log(`[stripe-webhook] Booking ${bookingId} marked as paid (session: ${session.id})`);

      // Split the collected funds: host payout + community transfer (idempotent).
      try {
        await distributeFunds(stripe, supabase, session);
      } catch (distErr) {
        console.error('[stripe-webhook] Fund distribution failed:', distErr);
        return new Response('Distribution failed', { status: 500 }); // 500 → Stripe retries
      }
    }

    // For all other event types, acknowledge receipt and do nothing
    return new Response('ok', { status: 200 });

  } catch (err) {
    console.error('[stripe-webhook] Unexpected error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
