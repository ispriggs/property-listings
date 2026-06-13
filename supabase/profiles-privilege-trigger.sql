-- ============================================================
-- profiles privilege-escalation guard
-- ------------------------------------------------------------
-- Blocks a logged-in user from changing privileged columns on
-- their own profile row (role, admin_community). Verified by
-- tests/rls-audit.mjs ("A escalates own role to admin" etc.).
--
-- Trusted backend contexts are allowed through:
--   * SQL editor / direct postgres connections  → auth.jwt() is null
--   * service-role key (edge functions, admin)   → role = service_role
--
-- This file is the source of truth for the function. The trigger
-- that calls it (BEFORE UPDATE ON public.profiles, FOR EACH ROW)
-- already exists in the database; replacing the function is enough
-- to change behavior. To (re)create the trigger from scratch, see
-- the commented block at the bottom.
-- ============================================================

create or replace function public.prevent_profile_privilege_escalation()
 returns trigger
 language plpgsql
 security definer
as $function$
begin
  -- SQL editor / direct postgres connections carry no JWT → trusted.
  if auth.jwt() is null then return new; end if;
  -- service-role key (edge functions / admin tooling) → trusted.
  if coalesce(auth.jwt()->>'role','') = 'service_role' then return new; end if;

  -- Regular authenticated users: block privilege changes.
  if new.role is distinct from old.role then
    if old.role = 'admin' or new.role not in ('user','host') then
      raise exception 'role change not allowed';
    end if;
  end if;
  if new.admin_community is distinct from old.admin_community then
    raise exception 'admin_community change not allowed';
  end if;
  return new;
end $function$;

-- ── Trigger (already present; included for clean rebuilds) ───
-- Run the query below to find the existing trigger's name:
--   select tgname from pg_trigger
--   where tgrelid = 'public.profiles'::regclass and not tgisinternal;
--
-- If recreating from scratch:
--   drop trigger if exists trg_prevent_profile_privilege_escalation on public.profiles;
--   create trigger trg_prevent_profile_privilege_escalation
--     before update on public.profiles
--     for each row execute function public.prevent_profile_privilege_escalation();
