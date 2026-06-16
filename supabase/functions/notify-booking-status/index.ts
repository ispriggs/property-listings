// Ecovilla Rentals — notify-booking-status Edge Function
// Triggered by a database webhook on bookings UPDATE.
// Sends an email to the GUEST when their booking is accepted or declined.

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
    const booking    = payload.record;
    const oldBooking = payload.old_record;

    if (!booking || !oldBooking) return new Response('no record', { status: 400 });

    // Only fire when status actually changed to accepted or declined
    const newStatus = booking.status;
    const oldStatus = oldBooking.status;
    if (newStatus === oldStatus) return new Response('status unchanged', { status: 200 });
    if (!['accepted', 'declined'].includes(newStatus)) return new Response('not a terminal status', { status: 200 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch listing
    const { data: listing } = await supabase
      .from('listings')
      .select('title, owner_id')
      .eq('id', booking.listing_id)
      .single();

    if (!listing) return new Response('listing not found', { status: 200 });

    // Fetch guest profile
    const { data: guest } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', booking.requester_id)
      .single();

    if (!guest?.email) return new Response('no guest email', { status: 200 });

    const guestFirstName = guest.full_name?.split(' ')[0] ?? 'there';
    const nights = Math.round((new Date(booking.end_date).getTime() - new Date(booking.start_date).getTime()) / 86400000);
    const isAccepted = newStatus === 'accepted';

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [guest.email],
        subject: isAccepted
          ? `Your booking for ${listing.title} is confirmed!`
          : `Update on your booking request for ${listing.title}`,
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

              <!-- Eyebrow label -->
              <p style="margin:0 0 6px;font-size:.8rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:${isAccepted ? '#2d4a38' : '#6e6a63'}">
                ${isAccepted ? 'Booking Confirmed' : 'Booking Update'}
              </p>

              <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:1.6rem;font-weight:500;color:#2d4a38;line-height:1.2">
                ${isAccepted
                  ? `You're booked in &#8212; see you at the valley!`
                  : `Your request wasn't accepted this time`}
              </h1>

              <p style="margin:0 0 24px;font-size:.95rem;color:#2a2520;line-height:1.6">
                Hi ${guestFirstName}, ${isAccepted
                  ? `your booking request for <strong>${listing.title}</strong> has been <strong>accepted</strong>. Here are your stay details:`
                  : `unfortunately your booking request for <strong>${listing.title}</strong> has been declined. We encourage you to browse other available listings.`}
              </p>

              ${isAccepted ? `
              <!-- Details box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3eb;border-radius:10px;padding:20px;margin-bottom:28px">
                <tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63;width:110px">Property</td>
                  <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">${listing.title}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Check-in</td>
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
              </table>` : ''}

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2d4a38;border-radius:8px;padding:13px 28px">
                    <a href="${SITE_URL}/pages/user.html" style="color:#ffffff;font-size:.9rem;font-weight:600;text-decoration:none;font-family:system-ui,sans-serif">
                      ${isAccepted ? 'View My Stays &#8594;' : 'Browse Listings &#8594;'}
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;font-size:.75rem;color:#9e9589;line-height:1.6;font-family:system-ui,sans-serif">
              You're receiving this because you made a booking request on Ecovilla Rentals.<br>
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
    console.error('notify-booking-status error:', err);
    return new Response('internal error', { status: 500 });
  }
});
