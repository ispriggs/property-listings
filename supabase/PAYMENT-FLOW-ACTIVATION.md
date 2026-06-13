# Payment Flow Activation — Separate Charges & Transfers

This change moves from **destination charges** (Stripe auto-paid the host instantly) to
**separate charges & transfers** (everything is collected into the platform account, then
split). The code is in place but **inactive until you complete the steps below**, because it
depends on community Stripe accounts that don't exist yet.

## Fund model (per booking)

All percentage fees apply to the **rental only** (`R`) — not cleaning, not the deposit.
Guest pays `R + cleaning + 3% give-back + 3% platform + deposit` (matching the UI). After payment:

| Portion        | Amount                          | Goes to                          |
|----------------|---------------------------------|----------------------------------|
| Platform fee   | 3% of rental                    | stays in **platform** account    |
| Community      | 3% give-back + host-fee% of rental | **community** account (LEV/ESM)  |
| Host payout    | rental + cleaning − host fee     | **host** connected account       |
| Deposit        | security deposit                | held in platform, **refunded to guest 48h after checkout** |

Worked example — $1,000 rental, 7% host fee:
guest pays **$1,060** → platform keeps **$30**, community gets **$100** ($30 + $70), host gets **$930**.

## Activation checklist

1. **Run the SQL** (Supabase → SQL Editor):
   - `supabase/host-fee-pct.sql` (if not already run — adds `host_fee_pct`)
   - `supabase/booking-payout-columns.sql` (adds `deposit_cents`, `funds_distributed_at`, `deposit_released_at`)

2. **Create the two community Stripe connected accounts** (LEV and ESM) in Stripe Connect and
   complete their onboarding so they can receive transfers.

3. **Set the connected-account IDs as edge-function secrets:**
   ```
   supabase secrets set STRIPE_ACCT_LEV=acct_xxxxxxxxLEV
   supabase secrets set STRIPE_ACCT_ESM=acct_xxxxxxxxESM
   ```
   (Slugs map in `stripe-webhook`: `la-ecovilla` → `STRIPE_ACCT_LEV`, `san-mateo` → `STRIPE_ACCT_ESM`.)
   Until these are set, the webhook **leaves funds in the platform account** and logs a warning
   rather than partially distributing — nothing is lost, but no transfers happen.

4. **Deploy the functions:**
   ```
   supabase functions deploy create-checkout-session
   supabase functions deploy stripe-webhook --no-verify-jwt
   supabase functions deploy release-deposits --no-verify-jwt
   ```

5. **Schedule the deposit release:** Edge Functions → `release-deposits` → Schedule → `0 9 * * *`.

6. **Test in Stripe TEST mode first** (this code has never run live):
   - Use test connected accounts for host + both communities.
   - Run a full booking → pay → confirm in the Stripe dashboard that: platform keeps 3%,
     the community account receives give-back + host fee, the host receives `C − host fee`,
     and the deposit stays in the platform balance.
   - Force a webhook retry (resend the event) → confirm **no duplicate transfers** (idempotency).
   - Backdate a test booking's `end_date` >48h and run `release-deposits` → confirm one deposit
     refund to the guest and `deposit_released_at` set.

## Notes / assumptions

- **Deposit release = refund to the guest.** There is no damage-claim/withholding workflow; if
  you add one later, gate the refund in `release-deposits` on whether a claim is open.
- Transfers use `source_transaction` (the charge) so funds availability is guaranteed, and
  `idempotencyKey` per booking+kind so retries never double-pay.
- The host's connected account and the deposit hold mean the host no longer receives the deposit
  at booking time (it previously rode along in the destination charge).
