// Ecovilla Rentals — notify-booking-request Edge Function
// Triggered by a database webhook on bookings INSERT.
// Sends an email to the HOST when a guest makes a new booking request.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SITE_URL       = Deno.env.get('SITE_URL') ?? 'https://properties.lev.cr';
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'Ecovilla Rentals <noreply@properties.lev.cr>';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(str: string) {
  const d = new Date(str + 'T00:00:00');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

serve(async (req) => {
  try {
    const payload = await req.json();
    const booking = payload.record;
    if (!booking) return new Response('no record', { status: 400 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch listing + owner
    const { data: listing } = await supabase
      .from('listings')
      .select('title, owner_id')
      .eq('id', booking.listing_id)
      .single();

    if (!listing) return new Response('listing not found', { status: 200 });

    // Fetch host + guest profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', [listing.owner_id, booking.requester_id]);

    const host  = profiles?.find((p) => p.id === listing.owner_id);
    const guest = profiles?.find((p) => p.id === booking.requester_id);

    if (!host?.email) return new Response('no host email', { status: 200 });

    const guestName = guest?.full_name || guest?.email || 'A guest';
    const nights    = Math.round((new Date(booking.end_date).getTime() - new Date(booking.start_date).getTime()) / 86400000);

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [host.email],
        subject: `New booking request for ${listing.title}`,
        html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f7f3eb;font-family:system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3eb;padding:40px 20px">
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
            <td style="background:#ffffff;border-radius:16px;padding:36px 40px;border:1px solid #ebe2d3">

              <p style="margin:0 0 6px;font-size:.8rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#6e6a63">Booking Request</p>
              <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:1.6rem;font-weight:500;color:#2d4a38;line-height:1.2">
                New request for ${listing.title}
              </h1>

              <p style="margin:0 0 24px;font-size:.95rem;color:#2a2520;line-height:1.6">
                <strong>${guestName}</strong> would like to book your property.
              </p>

              <!-- Details box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3eb;border-radius:10px;padding:20px;margin-bottom:28px">
                <tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63;width:110px">Check-in</td>
                  <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">${fmtDate(booking.start_date)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Check-out</td>
                  <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">${fmtDate(booking.end_date)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Duration</td>
                  <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">${nights} night${nights !== 1 ? 's' : ''}</td>
                </tr>
                ${booking.message ? `
                <tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63;vertical-align:top">Message</td>
                  <td style="padding:6px 0;font-size:.875rem;color:#2a2520;font-style:italic">"${booking.message}"</td>
                </tr>` : ''}
              </table>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2d4a38;border-radius:8px;padding:13px 28px">
                    <a href="${SITE_URL}/pages/host.html" style="color:#ffffff;font-size:.9rem;font-weight:600;text-decoration:none;font-family:system-ui,sans-serif">
                      Review Request &#8594;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;font-size:.75rem;color:#9e9589;line-height:1.6;font-family:system-ui,sans-serif">
              You're receiving this because you have a listing on Ecovilla Rentals.<br>
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
    console.error('notify-booking-request error:', err);
    return new Response('internal error', { status: 500 });
  }
});
