-- ============================================================
-- Community payout ledger
-- ------------------------------------------------------------
-- Records when a community's funds (3% give-back + host fee) for a
-- PAID booking have been paid out to the community (LEV/ESM) via Wise.
-- One row per booking that has been paid out. The admin payout ledger
-- joins this against paid bookings to show owed-vs-paid.
--
-- Read/written only by admins, scoped to their community (master admins
-- — no admin_community — can manage all). Kept separate from the bookings
-- table so admins never get write access to payment-sensitive booking rows.
--
-- Run in: Supabase Dashboard -> SQL Editor -> New Query -> Run.
-- ============================================================

create table if not exists public.community_payouts (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings(id) on delete cascade,
  community    text not null,
  amount_cents integer not null,
  paid_at      timestamptz not null default now(),
  paid_by      uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  unique (booking_id)
);

comment on table public.community_payouts is
  'One row per booking whose community funds were paid out (via Wise). Drives the admin payout ledger (owed vs paid).';

alter table public.community_payouts enable row level security;

-- Admin (master or matching community) — read.
drop policy if exists community_payouts_select on public.community_payouts;
create policy community_payouts_select
  on public.community_payouts for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and (p.admin_community is null or p.admin_community = community_payouts.community)
    )
  );

-- Admin (master or matching community) — mark as paid.
drop policy if exists community_payouts_insert on public.community_payouts;
create policy community_payouts_insert
  on public.community_payouts for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and (p.admin_community is null or p.admin_community = community_payouts.community)
    )
  );

-- Admin (master or matching community) — undo a payout mark.
drop policy if exists community_payouts_delete on public.community_payouts;
create policy community_payouts_delete
  on public.community_payouts for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and (p.admin_community is null or p.admin_community = community_payouts.community)
    )
  );
