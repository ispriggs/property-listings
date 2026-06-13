-- ============================================================
-- RLS fix: profiles table leaks every user's email (and would
-- leak stripe_account_id) to any logged-in user.
--
-- Found by tests/rls-audit.mjs:
--   FAIL  A reads B's profile (private cols) — exposed: email
--   FAIL  A harvests all profiles — 7 users' email readable
--
-- Goal:
--   * A user can read ONLY their own full profile row.
--   * Cross-user name lookups (messaging) go through a safe view
--     that exposes only id, full_name, avatar_url.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run.
-- ============================================================

-- ── 0. Drop the leaky policy ────────────────────────────────
-- Postgres combines PERMISSIVE policies with OR, so a single
-- "authenticated can read all" policy overrides every owner-only
-- one. On this project the culprit was:
--
--   profiles_select_authenticated   USING (true)   <-- the leak
--
-- It was OR'd alongside good policies (profiles_select =
-- "id = auth.uid() OR is_admin()"), so the table was wide open
-- to any logged-in user. Drop it:
drop policy if exists profiles_select_authenticated on public.profiles;
--
-- To re-inspect on a future setup:
--   select policyname, cmd, qual from pg_policies
--   where schemaname = 'public' and tablename = 'profiles';

-- ── 1. Enforce RLS and add the correct owner-only read policy ─
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ( (select auth.uid()) = id );

-- NOTE: this does not grant UPDATE/INSERT — keep your existing
-- write policies. If you don't have an owner-only UPDATE policy,
-- add one too (and never allow users to change their own `role`):
--
--   drop policy if exists profiles_update_own on public.profiles;
--   create policy profiles_update_own
--     on public.profiles for update to authenticated
--     using  ( (select auth.uid()) = id )
--     with check ( (select auth.uid()) = id );
--   -- Guard `role`/`admin_community` escalation with a trigger or
--   -- column privileges; the audit showed these are currently safe.

-- ── 2. Safe public view for cross-user name lookups ──────────
-- Owned by postgres, so it bypasses the owner-only RLS above and
-- exposes ONLY non-sensitive columns. No email / phone / stripe.
create or replace view public.public_profiles as
  select id, full_name, avatar_url
  from public.profiles;

-- Only logged-in users need this (messaging requires auth).
revoke all on public.public_profiles from anon;
grant select on public.public_profiles to authenticated;

-- ============================================================
-- After running, re-run the audit to confirm both FAILs clear:
--   node tests/rls-audit.mjs
-- App change required: js/pages/messaging.js now reads
--   public_profiles instead of profiles (see that file).
-- ============================================================
