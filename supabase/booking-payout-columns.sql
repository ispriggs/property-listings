-- ============================================================
-- Booking payout-tracking columns
-- ------------------------------------------------------------
-- Supports the "separate charges & transfers" payment flow:
--   * funds_distributed_at — set once host + community transfers are made
--     (idempotency guard so webhook retries don't double-pay)
--   * deposit_cents        — security deposit held in the platform account
--   * deposit_released_at  — set once the 48h-after-checkout refund is issued
--
-- Run in: Supabase Dashboard -> SQL Editor -> New Query -> Run.
-- ============================================================

alter table public.bookings
  add column if not exists deposit_cents        integer,
  add column if not exists funds_distributed_at timestamptz,
  add column if not exists deposit_released_at  timestamptz;

comment on column public.bookings.deposit_cents is
  'Security deposit (in cents) held in the platform Stripe account until 48h after checkout.';
comment on column public.bookings.funds_distributed_at is
  'When host + community Stripe transfers were created for this booking (idempotency guard).';
comment on column public.bookings.deposit_released_at is
  'When the held security deposit was refunded to the guest (48h after checkout).';
