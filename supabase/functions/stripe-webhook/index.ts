// Valle Vivo — stripe-webhook
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
    }

    // For all other event types, acknowledge receipt and do nothing
    return new Response('ok', { status: 200 });

  } catch (err) {
    console.error('[stripe-webhook] Unexpected error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
