---
name: project-fee-structure
description: Valle Vivo platform fee structure per community — governs how booking fees are split
metadata:
  type: project
---

# Fee Structure by Community

## La Ecovilla (LEV)
- Host fee: none (HOA charges hosts separately outside the platform)
- Guest community giveback: 2%
- Guest platform fee: 4%
- Guest total: 6%
- Platform revenue per booking: 4% of booking value

## Ecovilla San Mateo
- Host fee: 3% → goes directly to San Mateo HOA/community fund (NOT platform revenue)
- Guest community giveback: 2%
- Guest platform fee: 4%
- Guest total: 6%
- Platform revenue per booking: 4% of booking value
- HOA fund revenue per booking: 3% (host side) + 2% (guest giveback) = 5% tracked separately

**Why:** HOA already charges LEV hosts separately. San Mateo HOA is funded through the platform fee instead. Community giveback is separate from platform revenue in both cases.

**How to apply:** When building checkout/Stripe sessions, fee splits must be calculated per community. Reporting must distinguish platform revenue vs. community fund vs. giveback separately.
