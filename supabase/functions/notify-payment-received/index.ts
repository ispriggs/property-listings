// Ecovilla Rentals — notify-payment-received Edge Function
// Triggered by a database webhook on bookings UPDATE.
// Sends an email to the HOST when a guest completes payment.

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
function fmtMoney(n: number) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

serve(async (req) => {
  try {
    const payload    = await req.json();
    const booking    = payload.record;
    const oldBooking = payload.old_record;

    if (!booking || !oldBooking) return new Response('no record', { status: 400 });

    // Only fire when payment_status changes to 'paid'
    if (booking.payment_status !== 'paid' || oldBooking.payment_status === 'paid') {
      return new Response('not a payment', { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: listing } = await supabase
      .from('listings')
      .select('title, owner_id, lot_id, community')
      .eq('id', booking.listing_id)
      .single();

    if (!listing) return new Response('listing not found', { status: 200 });

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', [listing.owner_id, booking.requester_id]);

    const host  = profiles?.find((p) => p.id === listing.owner_id);
    const guest = profiles?.find((p) => p.id === booking.requester_id);

    if (!host?.email) return new Response('no host email', { status: 200 });

    const guestName  = guest?.full_name || guest?.email || 'Your guest';
    const nights     = Math.round((new Date(booking.end_date).getTime() - new Date(booking.start_date).getTime()) / 86400000);
    // payment_amount, commission_amount, deposit_cents are all stored in cents
    const grossAmount   = booking.payment_amount    ? fmtMoney(booking.payment_amount    / 100) : null;
    const feesAmount    = booking.commission_amount ? fmtMoney(booking.commission_amount / 100) : null;
    const depositAmount = booking.deposit_cents     ? fmtMoney(booking.deposit_cents     / 100) : null;
    // Host earnings = guest total − fees − refundable deposit
    const hostPayout = (booking.payment_amount && booking.commission_amount != null)
      ? fmtMoney((booking.payment_amount - booking.commission_amount - (booking.deposit_cents ?? 0)) / 100)
      : null;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [host.email],
        subject: `Payment received for ${listing.title} ✓`,
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

              <p style="margin:0 0 6px;font-size:.8rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#2d4a38">Payment Received</p>
              <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:1.6rem;font-weight:500;color:#2d4a38;line-height:1.2">
                You've been paid!
              </h1>

              <p style="margin:0 0 24px;font-size:.95rem;color:#2a2520;line-height:1.6">
                <strong>${guestName}</strong> has completed payment for their stay at <strong>${listing.title}</strong>.
              </p>

              <!-- Details box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3eb;border-radius:10px;padding:20px;margin-bottom:28px">
                <tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63;width:140px">Check-in</td>
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
                ${grossAmount ? `
                <tr><td colspan="2" style="padding-top:12px;border-top:1px solid #ebe2d3"></td></tr>
                <tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Guest total paid</td>
                  <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">${grossAmount}</td>
                </tr>
                ${feesAmount ? `<tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Platform &amp; community fees</td>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">&#8722; ${feesAmount}</td>
                </tr>` : ''}
                ${depositAmount ? `<tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Security deposit (held)</td>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">&#8722; ${depositAmount}</td>
                </tr>` : ''}
                ${hostPayout ? `<tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Your payout</td>
                  <td style="padding:6px 0;font-size:1rem;font-weight:700;color:#2d4a38">${hostPayout}</td>
                </tr>` : ''}` : ''}
              </table>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2d4a38;border-radius:8px;padding:13px 28px">
                    <a href="${SITE_URL}/pages/host.html" style="color:#ffffff;font-size:.9rem;font-weight:600;text-decoration:none;font-family:system-ui,sans-serif">
                      View Billing &#8594;
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
      console.error('Resend error:', await emailRes.text());
      return new Response('email failed', { status: 500 });
    }

    // Send guest payment confirmation if we have their email
    if (guest?.email) {
      // Build the map link from the stored lot id against the canonical site URL,
      // so it's always valid regardless of where the host created the listing.
      const communityParam = listing.community === 'la-ecovilla' ? '&community=le' : '';
      const lotMapUrl = listing.lot_id
        ? `${SITE_URL}/pages/map.html?lot=${encodeURIComponent(listing.lot_id)}${communityParam}`
        : null;
      const locationBlock = lotMapUrl ? `
              <tr>
                <td colspan="2" style="padding-top:12px;border-top:1px solid #ebe2d3"></td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:.875rem;color:#6e6a63;width:110px;vertical-align:top">Location</td>
                <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">
                  <a href="${lotMapUrl}" style="color:#c06e3a;text-decoration:underline">View your property on the map &#8594;</a>
                </td>
              </tr>` : '';

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [guest.email],
          subject: `Payment confirmed — ${listing.title}`,
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

              <p style="margin:0 0 6px;font-size:.8rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#2d4a38">Payment Confirmed</p>
              <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:1.6rem;font-weight:500;color:#2d4a38;line-height:1.2">
                Thank you &#8212; you're all set!
              </h1>

              <p style="margin:0 0 24px;font-size:.95rem;color:#2a2520;line-height:1.6">
                Hi ${guest.full_name?.split(' ')[0] ?? 'there'}, your payment for <strong>${listing.title}</strong> has been received. Here are your stay details:
              </p>

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
                ${grossAmount ? `
                <tr><td colspan="2" style="padding-top:12px;border-top:1px solid #ebe2d3"></td></tr>
                <tr>
                  <td style="padding:6px 0;font-size:.875rem;color:#6e6a63">Total paid</td>
                  <td style="padding:6px 0;font-size:.875rem;font-weight:600;color:#2a2520">${grossAmount}</td>
                </tr>` : ''}
                ${locationBlock}
              </table>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2d4a38;border-radius:8px;padding:13px 28px">
                    <a href="${SITE_URL}/pages/user.html" style="color:#ffffff;font-size:.9rem;font-weight:600;text-decoration:none;font-family:system-ui,sans-serif">
                      View My Stays &#8594;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;font-size:.75rem;color:#9e9589;line-height:1.6;font-family:system-ui,sans-serif">
              You're receiving this because you made a booking on Ecovilla Rentals.<br>
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
    }

    return new Response('ok', { status: 200 });

  } catch (err) {
    console.error('notify-payment-received error:', err);
    return new Response('internal error', { status: 500 });
  }
});
