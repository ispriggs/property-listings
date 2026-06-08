// Valle Vivo — notify-welcome Edge Function
// Triggered by a database webhook on profiles INSERT.
// Sends a welcome email to new users when they create an account.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SITE_URL       = Deno.env.get('SITE_URL') ?? 'https://properties.lev.cr';
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'Valle Vivo <noreply@properties.lev.cr>';

serve(async (req) => {
  try {
    const payload = await req.json();
    const profile = payload.record;

    if (!profile?.email) return new Response('no email', { status: 200 });

    const firstName = profile.full_name?.split(' ')[0] ?? 'there';

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [profile.email],
        subject: `Welcome to Valle Vivo, ${firstName}!`,
        html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f3eb;font-family:'DM Sans',system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3eb;padding:40px 20px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

        <tr><td style="padding-bottom:28px;text-align:center">
          <span style="font-family:Georgia,serif;font-size:1.6rem;font-weight:500;color:#2d4a38">Valle Vivo</span>
        </td></tr>

        <tr><td style="background:#ffffff;border-radius:16px;padding:36px 40px;border:1px solid #ebe2d3">

          <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:1.8rem;font-weight:500;color:#2d4a38;line-height:1.2">
            Welcome to the valley, ${firstName}.
          </h1>

          <p style="margin:0 0 16px;font-size:.95rem;color:#2a2520;line-height:1.7">
            We're glad you're here. Valle Vivo connects people with conscious communities in the heart of Costa Rica's Machuca Valley — from short-term stays to long-term homes and properties for sale.
          </p>

          <p style="margin:0 0 28px;font-size:.95rem;color:#2a2520;line-height:1.7">
            Start exploring listings, save your favourites, and reach out to hosts directly through the platform.
          </p>

          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px">
            <tr><td style="background:#f4831f;border-radius:8px;padding:13px 28px">
              <a href="${SITE_URL}/index.html" style="color:#ffffff;font-size:.9rem;font-weight:600;text-decoration:none">
                Browse Listings →
              </a>
            </td></tr>
          </table>

          <!-- Quick links -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ebe2d3;padding-top:24px">
            <tr>
              <td style="padding:8px 0">
                <a href="${SITE_URL}/index.html" style="color:#2d4a38;font-size:.875rem;font-weight:500;text-decoration:none">🏡 Browse all listings</a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0">
                <a href="${SITE_URL}/user.html" style="color:#2d4a38;font-size:.875rem;font-weight:500;text-decoration:none">👤 View your dashboard</a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0">
                <a href="${SITE_URL}/login.html" style="color:#2d4a38;font-size:.875rem;font-weight:500;text-decoration:none">🔑 Sign in anytime</a>
              </td>
            </tr>
          </table>

        </td></tr>

        <tr><td style="padding-top:24px;text-align:center;font-size:.75rem;color:#9e9589;line-height:1.6">
          Costa Rica · Machuca Valley<br>
          <a href="${SITE_URL}" style="color:#c06e3a;text-decoration:none">properties.lev.cr</a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
      }),
    });

    if (!emailRes.ok) {
      console.error('Resend error:', await emailRes.text());
      return new Response('email failed', { status: 500 });
    }

    return new Response('ok', { status: 200 });

  } catch (err) {
    console.error('notify-welcome error:', err);
    return new Response('internal error', { status: 500 });
  }
});
