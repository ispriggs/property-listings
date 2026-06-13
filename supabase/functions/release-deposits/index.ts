// Ecovilla Rentals — release-deposits
// Scheduled job (run daily). Finds paid bookings whose checkout was >48h ago and
// whose security deposit is still held in the platform account, then refunds the
// deposit to the guest and marks it released. Idempotent.
//
// Schedule: Supabase Dashboard → Edge Functions → release-deposits → Schedule
//   e.g. "0 9 * * *" (daily at 09:00 UTC).
// Deploy with --no-verify-jwt (invoked by the scheduler, not a browser user).
//
// NOTE on "release": a security deposit is refundable, so this returns it to the
// guest. There is currently no damage-claim / withholding workflow — if one is
// added later, gate the refund on whether a claim is open before releasing.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});

const HOLD_HOURS = 48;

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const cutoff = new Date(Date.now() - HOLD_HOURS * 3600 * 1000).toISOString().slice(0, 10);

  // Paid bookings, deposit held, checkout at least HOLD_HOURS ago, not yet released.
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, stripe_session_id, deposit_cents, end_date, deposit_released_at, funds_distributed_at')
    .eq('payment_status', 'paid')
    .gt('deposit_cents', 0)
    .is('deposit_released_at', null)
    .lte('end_date', cutoff);

  if (error) {
    console.error('[release-deposits] query failed:', error);
    return new Response('query failed', { status: 500 });
  }

  let released = 0, skipped = 0, failed = 0;

  for (const b of bookings ?? []) {
    try {
      // Resolve the original charge from the checkout session.
      const session = await stripe.checkout.sessions.retrieve(b.stripe_session_id, {
        expand: ['payment_intent'],
      });
      const pi = session.payment_intent as Stripe.PaymentIntent | null;
      const piId = typeof session.payment_intent === 'string' ? session.payment_intent : pi?.id;
      if (!piId) { skipped++; continue; }
      const fullPi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
      const chargeId = typeof fullPi.latest_charge === 'string' ? fullPi.latest_charge : fullPi.latest_charge?.id;
      if (!chargeId) { skipped++; continue; }

      // Refund just the deposit portion to the guest (idempotent).
      await stripe.refunds.create({
        charge: chargeId,
        amount: b.deposit_cents,
        metadata: { booking_id: b.id, kind: 'deposit_release' },
      }, { idempotencyKey: `deposit-release-${b.id}` });

      await supabase.from('bookings')
        .update({ deposit_released_at: new Date().toISOString() })
        .eq('id', b.id);

      released++;
    } catch (err) {
      console.error(`[release-deposits] booking ${b.id} failed:`, err);
      failed++;
    }
  }

  const summary = { released, skipped, failed, considered: bookings?.length ?? 0 };
  console.log('[release-deposits]', JSON.stringify(summary));
  return new Response(JSON.stringify(summary), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
