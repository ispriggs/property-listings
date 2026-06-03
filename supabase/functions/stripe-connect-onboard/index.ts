// Valle Vivo — stripe-connect-onboard
// Creates or retrieves a Stripe Express account for the host
// and returns a Stripe-hosted onboarding URL.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://vallevivo.com';

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

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('stripe_account_id, stripe_onboarded, email, full_name')
      .eq('id', user.id)
      .single();

    if (profErr || !profile) return json({ error: 'Profile not found' }, 404);

    // Already fully onboarded — nothing to do
    if (profile.stripe_onboarded && profile.stripe_account_id) {
      return json({ status: 'already_onboarded' });
    }

    let accountId: string = profile.stripe_account_id;

    // Create a new Express account if this host doesn't have one yet
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: profile.email ?? user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { supabase_user_id: user.id },
      });

      accountId = account.id;

      // Persist immediately so a retry doesn't create a second account
      await supabase
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', user.id);
    }

    // Generate a fresh Stripe-hosted onboarding link
    // (Account Links expire after 5 minutes, so we always create a new one)
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${SITE_URL}/host.html?stripe=refresh`,
      return_url:  `${SITE_URL}/host.html?stripe=return`,
      type: 'account_onboarding',
    });

    return json({ url: link.url });

  } catch (err) {
    console.error('[stripe-connect-onboard]', err);
    return json({ error: err.message }, 500);
  }
});
