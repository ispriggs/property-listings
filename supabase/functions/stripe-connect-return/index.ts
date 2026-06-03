// Valle Vivo — stripe-connect-return
// Called after a host returns from Stripe's onboarding page.
// Checks whether the Express account has charges_enabled and updates the profile.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Invalid token' }, 401);

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_account_id, stripe_onboarded')
      .eq('id', user.id)
      .single();

    if (!profile?.stripe_account_id) {
      return json({ onboarded: false, reason: 'no_account' });
    }

    // Already marked as onboarded in our DB — skip the Stripe API call
    if (profile.stripe_onboarded) {
      return json({ onboarded: true });
    }

    // Ask Stripe whether this account can accept payments
    const account = await stripe.accounts.retrieve(profile.stripe_account_id);

    if (account.charges_enabled) {
      await supabase
        .from('profiles')
        .update({ stripe_onboarded: true })
        .eq('id', user.id);

      return json({ onboarded: true });
    }

    // Onboarding started but not complete (e.g. host closed the tab partway through)
    return json({ onboarded: false, reason: 'incomplete' });

  } catch (err) {
    console.error('[stripe-connect-return]', err);
    return json({ error: err.message }, 500);
  }
});
