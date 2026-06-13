---
name: project-fee-structure
description: Ecovilla Rentals platform fee structure — fixed guest fees + per-property host fee
metadata:
  type: project
---

# Fee Structure (updated 13 June 2026)

Replaces the old per-community model (guest 2%+4%; flat/host commission).

## Guest fees — identical for ALL communities (LEV + ESM)
- 3% Community Give-Back Fee
- 3% Platform Fee
- Both fees are calculated on the **rental subtotal only** (cleaning and deposit excluded).
- Guest total: rental + cleaning + 6% of rental + deposit.
- These are the ONLY fees a guest sees or pays.

## Host fee — per property
- Stored in `listings.host_fee_pct` (numeric).
- Set/edited by the **Community Admin** per property (admin.html → Certify Listings table).
- Paid by the host (deducted from payout); goes to that property's **community / HOA fund**, NOT platform revenue.
- Varies by property. **Never shown to guests.**
- Defaults (backfill + insert trigger, by community): **La Ecovilla = 7%**, **San Mateo = 0%**, any other community = 0%.

**Why:** Guest fees are now uniform (3%+3%); host contribution became a flexible per-property lever the community admin controls, funding the community rather than the platform.

**How to apply:**
- Guest calculators in `js/pages/main.js` and `js/pages/listing.js` both charge 3% give-back + 3% platform — keep them in sync.
- Schema/RLS/trigger for the host fee: `supabase/host-fee-pct.sql` (column, backfill, `set_default_host_fee` trigger, `listings_update_community_admin` policy).
- **Not yet done — Stripe:** the payout split in the edge functions does NOT yet deduct/route the host fee. When implemented, the host fee must go to the community fund and be reported separately from platform revenue.
- Docs: terms.html / host-onboarding.html §4.1 & §5.1.
