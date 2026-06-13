-- ============================================================
-- Per-property Host Fee + community-admin write access
-- ------------------------------------------------------------
-- Fee model (June 2026):
--   * Guests always pay 3% community give-back + 3% platform fee.
--   * Each property has a Host Fee % (paid by the host, deducted
--     from payout, contributed to that community's fund).
--   * The Host Fee % is set per-property by the Community Admin.
--   * Defaults: existing/new La Ecovilla = 7%, San Mateo = 0%.
--
-- Run in: Supabase Dashboard -> SQL Editor -> New Query -> Run.
-- ============================================================

-- ── 1. Column ───────────────────────────────────────────────
alter table public.listings
  add column if not exists host_fee_pct numeric(5,2);

comment on column public.listings.host_fee_pct is
  'Host fee percentage paid by the host (to the community fund). Set per-property by the community admin. Never shown to guests.';

-- ── 2. Backfill existing rows by community ──────────────────
update public.listings set host_fee_pct = 7 where community = 'la-ecovilla' and host_fee_pct is null;
update public.listings set host_fee_pct = 0 where community = 'san-mateo'   and host_fee_pct is null;
update public.listings set host_fee_pct = 0 where host_fee_pct is null;  -- any other community

-- ── 3. Default new rows by community ────────────────────────
-- Hosts do not set this field; it defaults from the community on
-- insert and is editable afterwards only by the community admin.
create or replace function public.set_default_host_fee()
 returns trigger
 language plpgsql
as $function$
begin
  if new.host_fee_pct is null then
    new.host_fee_pct := case new.community
      when 'la-ecovilla' then 7
      else 0
    end;
  end if;
  return new;
end $function$;

drop trigger if exists trg_set_default_host_fee on public.listings;
create trigger trg_set_default_host_fee
  before insert on public.listings
  for each row execute function public.set_default_host_fee();

-- ── 4. Community-admin write access to listings ─────────────
-- Lets a community admin update listings in THEIR community (master
-- admins — no admin_community — can update any). This is what makes
-- the Certify toggle and the Host Fee editor actually persist; without
-- it those writes silently affect zero rows under RLS.
-- NOTE: this grants update on the whole row within the admin's
-- community (RLS is row-level, not column-level). Community admins are
-- trusted staff; if you later want to limit them to only featured +
-- host_fee_pct, that requires column GRANTs.
drop policy if exists listings_update_community_admin on public.listings;
create policy listings_update_community_admin
  on public.listings
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and (p.admin_community is null or p.admin_community = listings.community)
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and (p.admin_community is null or p.admin_community = listings.community)
    )
  );
