// Ecovilla Rentals — notify-booking-reminder Edge Function
// Called daily by a pg_cron job.
// Finds all accepted bookings starting tomorrow and emails the guest a reminder.

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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Find all accepted bookings starting tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*, listings(title, community, contact_phone, contact_email)')
      .eq('status', 'accepted')
      .eq('start_date', tomorrowStr);

    if (error) {
      console.error('bookings query error:', error);
      return new Response('query error', { status: 500 });
    }

    if (!bookings?.length) return new Response('no reminders today', { status: 200 });

    const results = await Promise.allSettled(
      bookings.map(async (booking) => {
        const listing = booking.listings as { title: string; community: string; contact_phone?: string; contact_email?: string } | null;
        if (!listing) return;

        const { data: guest } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', booking.requester_id)
          .single();

        if (!guest?.email) return;

        const firstName = guest.full_name?.split(' ')[0] ?? 'there';
        const nights = Math.round((new Date(booking.end_date).getTime() - new Date(booking.start_date).getTime()) / 86400000);

        const communityLabels: Record<string, string> = {
          'la-ecovilla': 'La Ecovilla (LEV)',
          'san-mateo': 'Ecovilla San Mateo',
        };
        const communityName = communityLabels[listing.community] || listing.community;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [guest.email],
            subject: `Your stay at ${listing.title} is tomorrow!`,
            html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f3eb;font-family:'DM Sans',system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3eb;padding:40px 20px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

        <tr><td style="padding-bottom:28px;text-align:center">
          <span style="font-family:Georgia,serif;font-size:1.6rem;font-weight:500;color:#2d4a38">Ecovilla Rentals</span>
        </td></tr>

        <tr><td style="background:#ffffff;border-radius:16px;padding:36px 40px;border:1px solid #ebe2d3">

          <p style="margin:0 0 6px;font-size:.8rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#c06e3a">Check-in Tomorrow</p>
          <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:1.8rem;font-weight:500;color:#2d4a38;line-height:1.2">
            See you in the valley, ${firstName}!
          </h1>

          <p style="margin:0 0 24px;font-size:.95rem;color:#2a2520;line-height:1.7">
            Your stay at <strong>${listing.title}</strong> begins tomorrow. Here's a quick reminder of your details:
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3eb;border-radius:10px;padding:20px;margin-bottom:28px">
            <tr>
              <td style="padding:6px 0;font-size:.875rem;color:#6e6a63;width:130px">Property</td>
              <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">${listing.title}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Community</td>
              <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">${communityName}</td>
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
            ${listing.contact_phone ? `
            <tr>
              <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Host phone</td>
              <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">${listing.contact_phone}</td>
            </tr>` : ''}
            ${listing.contact_email ? `
            <tr>
              <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Host email</td>
              <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">${listing.contact_email}</td>
            </tr>` : ''}
          </table>

          <p style="margin:0 0 28px;font-size:.875rem;color:#6e6a63;line-height:1.6">
            If you have any questions before arrival, you can message your host directly through the platform.
          </p>

          <table cellpadding="0" cellspacing="0">
            <tr><td style="background:#2d4a38;border-radius:8px;padding:13px 28px">
              <a href="${SITE_URL}/user.html" style="color:#ffffff;font-size:.9rem;font-weight:600;text-decoration:none">
                Message Host →
              </a>
            </td></tr>
          </table>

        </td></tr>

        <tr><td style="padding-top:24px;text-align:center;font-size:.75rem;color:#9e9589;line-height:1.6">
          You're receiving this because you have an upcoming stay booked on Ecovilla Rentals.<br>
          <a href="${SITE_URL}" style="color:#c06e3a;text-decoration:none">properties.lev.cr</a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
          }),
        });
      })
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    return new Response(`sent ${sent} reminder${sent !== 1 ? 's' : ''}`, { status: 200 });

  } catch (err) {
    console.error('notify-booking-reminder error:', err);
    return new Response('internal error', { status: 500 });
  }
});
