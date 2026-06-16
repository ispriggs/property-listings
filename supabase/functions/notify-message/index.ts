// Ecovilla Rentals — notify-message Edge Function
// Triggered by a database webhook on messages INSERT.
// Sends an email to the recipient via Resend.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SITE_URL       = Deno.env.get('SITE_URL') ?? 'https://properties.lev.cr';
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'Ecovilla Rentals <noreply@properties.lev.cr>';

serve(async (req) => {
  try {
    const payload = await req.json();

    // Supabase database webhooks send { type, table, record, old_record }
    const message = payload.record;
    if (!message) return new Response('no record', { status: 400 });

    const { conversation_id, sender_id, body } = message;
    if (!conversation_id || !sender_id || !body) {
      return new Response('missing fields', { status: 400 });
    }

    // Use service role key so RLS doesn't block lookups
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Get conversation — includes host_id, user_id, listing
    const { data: convRows, error: convErr } = await supabase
      .from('conversations')
      .select('host_id, user_id, listing:listings(title)')
      .eq('id', conversation_id)
      .limit(1);

    if (convErr || !convRows?.length) {
      console.error('conversation lookup failed', convErr);
      return new Response('conversation not found', { status: 404 });
    }

    const conv         = convRows[0];
    const listing      = (conv.listing as { title: string } | null);
    const listingTitle = listing?.title ?? 'a property';

    // 2. Determine recipient (the other party)
    const recipientId = sender_id === conv.host_id ? conv.user_id : conv.host_id;
    if (!recipientId) return new Response('no recipient', { status: 200 });

    // 3. Fetch sender name + recipient email in one query
    const { data: profiles, error: profErr } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', [sender_id, recipientId]);

    if (profErr || !profiles?.length) {
      console.error('profile lookup failed', profErr);
      return new Response('profiles not found', { status: 404 });
    }

    const sender    = profiles.find((p) => p.id === sender_id);
    const recipient = profiles.find((p) => p.id === recipientId);

    if (!recipient?.email) {
      return new Response('recipient has no email', { status: 200 });
    }

    const senderName    = sender?.full_name ?? 'Someone';
    const recipientName = recipient.full_name?.split(' ')[0] ?? 'there';
    const dashboardUrl  = SITE_URL + (sender_id === conv.host_id ? '/pages/user.html' : '/pages/host.html');

    // Detect Stripe payment link so we can render a proper CTA button in the email
    const stripeUrlMatch = body.match(/https:\/\/checkout\.stripe\.com\/[^\s\n]+/);
    const paymentUrl = stripeUrlMatch ? stripeUrlMatch[0] : null;
    // Strip the payment URL from the preview text so the email isn't a raw URL dump
    const bodyForPreview = paymentUrl ? body.replace(paymentUrl, '').trim() : body;
    const preview = bodyForPreview.length > 300 ? bodyForPreview.slice(0, 300) + '…' : bodyForPreview;

    // 4. Send email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to:   [recipient.email],
        subject: `New message from ${senderName} — ${listingTitle}`,
        html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @media only screen and (max-width: 480px) {
      .email-card { padding: 24px 20px !important; }
      .email-wrap { padding: 24px 12px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f7f3eb;font-family:system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3eb;padding:40px 20px" class="email-wrap">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:28px;text-align:center">
              <span style="font-family:Georgia,serif;font-size:1.6rem;font-weight:500;color:#2d4a38">Ecovilla Rentals</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;padding:36px 40px;border:1px solid #ebe2d3" class="email-card">

              <p style="margin:0 0 6px;font-size:.8rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#6e6a63">New Message</p>
              <h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:1.6rem;font-weight:500;color:#2d4a38;line-height:1.2">
                ${senderName} sent you a message
              </h1>
              <p style="margin:0 0 24px;font-size:.9rem;color:#6e6a63;line-height:1.6">
                Re: <strong style="color:#2a2520">${listingTitle}</strong>
              </p>

              ${paymentUrl ? `
              <!-- Payment link CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8ee;border:1px solid #f5cfa0;border-radius:12px;padding:20px;margin-bottom:24px">
                <tr>
                  <td>
                    <p style="margin:0 0 4px;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#c06e3a">Secure Payment Link</p>
                    <p style="margin:0 0 16px;font-size:.875rem;color:#5a4a3a;line-height:1.5">Your host has sent a payment link for this booking. Click below to complete your payment.</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#c06e3a;border-radius:8px;padding:13px 28px">
                          <a href="${paymentUrl}" style="color:#ffffff;font-size:.9rem;font-weight:700;text-decoration:none;font-family:system-ui,sans-serif">
                            Pay Now &#8594;
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>` : ''}

              <!-- Message preview box -->
              ${preview ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3eb;border-radius:10px;padding:20px;margin-bottom:28px">
                <tr>
                  <td style="font-size:.9rem;line-height:1.7;color:#2a2520;border-left:3px solid #c06e3a;padding-left:16px;word-break:break-word">
                    ${preview.replace(/\n/g, '<br>')}
                  </td>
                </tr>
              </table>` : ''}

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2d4a38;border-radius:8px;padding:13px 28px">
                    <a href="${dashboardUrl}" style="color:#ffffff;font-size:.9rem;font-weight:600;text-decoration:none;font-family:system-ui,sans-serif">
                      ${paymentUrl ? 'View Conversation &#8594;' : 'Reply in Dashboard &#8594;'}
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;font-size:.75rem;color:#9e9589;line-height:1.6;font-family:system-ui,sans-serif">
              You're receiving this because someone messaged you on Ecovilla Rentals.<br>
              <a href="${SITE_URL}" style="color:#c06e3a;text-decoration:none">properties.lev.cr</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error('Resend error:', errText);
      return new Response('email failed: ' + errText, { status: 500 });
    }

    return new Response('ok', { status: 200 });

  } catch (err) {
    console.error('notify-message error:', err);
    return new Response('internal error', { status: 500 });
  }
});
