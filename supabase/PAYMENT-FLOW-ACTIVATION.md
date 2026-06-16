# Payment Flow Activation — Separate Charges & Transfers

This change moves from **destination charges** (Stripe auto-paid the host instantly) to
**separate charges & transfers** (everything is collected into the platform account, then
split). The **host** payout is transferred to the host's Stripe connected account; the
**community** funds stay in the platform account and are paid to LEV/ESM **manually via Wise**
(their Costa Rica accounts can't receive Stripe transfers). The code is in place but
**inactive until you complete the steps below**.

## Fund model (per booking)

All percentage fees apply to the **rental only** (`R`) — not cleaning, not the deposit.
Guest pays `R + cleaning + 3% give-back + 6% platform + deposit` (matching the UI). After payment:

| Portion        | Amount                          | Goes to                          |
|----------------|---------------------------------|----------------------------------|
| Host payout    | rental + cleaning − host fee     | **host** connected account (Stripe transfer) |
| Platform fee   | 6% of rental                    | stays in **platform** account    |
| Community      | 3% give-back + host-fee% of rental | **retained in platform** → paid to LEV/ESM manually via Wise |
| Deposit        | security deposit                | held in platform, **refunded to guest 48h after checkout** |

Worked example — $1,000 rental, 7% host fee:
guest pays **$1,090** → host gets **$930** (Stripe). Platform **retains $160** = $60 platform fee
+ $100 community ($30 give-back + $70 host fee). You then pay LEV/ESM the **$100** via Wise.

## Activation checklist

1. **Run the SQL** (Supabase → SQL Editor):
   - `supabase/host-fee-pct.sql` (if not already run — adds `host_fee_pct`)
   - `supabase/booking-payout-columns.sql` (adds `deposit_cents`, `funds_distributed_at`, `deposit_released_at`)

2. **Set the edge-function secrets** (no community Stripe accounts needed — LEV/ESM are paid via Wise):
   ```
   supabase secrets set STRIPE_SECRET_KEY=sk_...
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   supabase secrets set SITE_URL=https://properties.lev.cr
   ```

3. **Deploy the functions:**
   ```
   supabase functions deploy create-checkout-session
   supabase functions deploy stripe-webhook --no-verify-jwt
   supabase functions deploy release-deposits --no-verify-jwt
   ```

4. **Add the Stripe webhook endpoint** (Stripe Dashboard → Developers → Webhooks) pointing at the
   deployed `stripe-webhook` URL, subscribed to **`checkout.session.completed`**. Copy its signing
   secret into `STRIPE_WEBHOOK_SECRET`.

5. **Schedule the deposit release:** Edge Functions → `release-deposits` → Schedule → `0 9 * * *`.

6. **Test in Stripe TEST mode first** (this code has never run live):
   - Use a test connected account for the **host** (communities need none).
   - Run a full booking → pay → confirm in the Stripe dashboard that: the **host** receives
     `rental + cleaning − host fee`, and the platform balance **retains** the platform fee +
     community funds + deposit.
   - Force a webhook retry (resend the event) → confirm **no duplicate host transfer** (idempotency).
   - Backdate a test booking's `end_date` >48h and run `release-deposits` → confirm one deposit
     refund to the guest and `deposit_released_at` set.
   - Use the admin community report to read the **community funds owed**, then pay LEV/ESM via Wise.

## Notes / assumptions

- **Deposit release = refund to the guest.** There is no damage-claim/withholding workflow; if
  you add one later, gate the refund in `release-deposits` on whether a claim is open.
- Transfers use `source_transaction` (the charge) so funds availability is guaranteed, and
  `idempotencyKey` per booking+kind so retries never double-pay.
- The host's connected account and the deposit hold mean the host no longer receives the deposit
  at booking time (it previously rode along in the destination charge).
