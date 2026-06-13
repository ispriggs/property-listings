// ============================================================
// tests/rls-audit.mjs — Hostile-user RLS audit
// ------------------------------------------------------------
// Signs in as two REAL users (A = attacker, B = victim) and tries
// to access / mutate data that Row Level Security should forbid.
// Every probe asserts the *denied* outcome; a leak or a successful
// write is reported as FAIL. All write probes capture originals and
// auto-revert, so this is safe to run against production.
//
// Run:   node tests/rls-audit.mjs
//
// Accounts (two options):
//   1. Auto-create throwaway users (default) — requires the Supabase
//      project to have "Confirm email" DISABLED, otherwise signup
//      returns no session and the script can't get a JWT.
//   2. Bring your own — set these env vars and they're used instead:
//        RLS_USER_A_EMAIL  RLS_USER_A_PASSWORD
//        RLS_USER_B_EMAIL  RLS_USER_B_PASSWORD
//
// Optional:
//   SEED_BOOKINGS=1   also seed a victim booking (fires ONE host
//                     notification email to a throwaway address).
//
// Exit code: 1 if any probe FAILs, else 0.
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Read SUPABASE_URL / SUPABASE_ANON straight from the app's config.js so this
// stays a single source of truth (config.js is browser ESM; Node's CJS loader
// can't import it directly under "type":"commonjs", so we parse it as text).
const _cfg = readFileSync(fileURLToPath(new URL('../js/lib/config.js', import.meta.url)), 'utf8');
const _grab = name => {
  const m = _cfg.match(new RegExp(`${name}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`));
  if (!m) throw new Error(`Could not find ${name} in js/lib/config.js`);
  return m[1];
};
const SUPABASE_URL  = _grab('SUPABASE_URL');
const SUPABASE_ANON = _grab('SUPABASE_ANON');

const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH = `${SUPABASE_URL}/auth/v1`;

// ── Console helpers ──────────────────────────────────────────
const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m' };
const results = [];
const cleanups = [];

function record(status, name, detail = '') {
  results.push({ status, name, detail });
  const col = status === 'PASS' ? C.green : status === 'FAIL' ? C.red : status === 'WARN' ? C.yellow : C.dim;
  console.log(`  ${col}${status.padEnd(4)}${C.reset} ${name}${detail ? `${C.dim} — ${detail}${C.reset}` : ''}`);
}
const section = t => console.log(`\n${C.bold}${C.cyan}${t}${C.reset}`);
const snippet = obj => JSON.stringify(obj).slice(0, 140);

// ── Low-level REST + Auth ────────────────────────────────────
async function rest(method, path, { token, body, prefer } = {}) {
  const headers = { apikey: SUPABASE_ANON, Accept: 'application/json' };
  if (token)  headers.Authorization = `Bearer ${token}`;
  if (body)   headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res  = await fetch(`${REST}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}

function decodeSub(jwt) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub;
}

async function signIn(email, password) {
  const res  = await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.msg || `sign-in failed: ${email}`);
  return { token: json.access_token, id: decodeSub(json.access_token), email };
}

async function signUp(email, password, role) {
  const res  = await fetch(`${AUTH}/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ email, password, data: { full_name: `RLS Audit ${role}`, role } }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.msg || `signup failed: ${email}`);
  const token = json.access_token;
  if (!token) {
    const err = new Error('Signup returned no session — "Confirm email" is enabled on this project.');
    err.code = 'SIGNUP_NO_SESSION';
    throw err;
  }
  return { token, id: decodeSub(token), email };
}

// Provision a pre-confirmed user with the service-role key (admin API).
// The service role is used ONLY to create/delete the user — never for probes.
async function adminCreateUser(serviceRole, email, password, role) {
  const res = await fetch(`${AUTH}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `RLS Audit ${role}`, role } }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.msg || json.error_description || `admin createUser failed: ${email}`);
  return json.id;
}

async function adminDeleteUser(serviceRole, id) {
  await fetch(`${AUTH}/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
  }).catch(() => {});
}

// ── Assertions ───────────────────────────────────────────────
// A forbidden READ passes when the query returns zero rows.
function assertNoRows(name, r) {
  if (!Array.isArray(r.json)) { record('WARN', name, `status ${r.status}: ${snippet(r.json ?? r.text)}`); return; }
  if (r.json.length === 0)    { record('PASS', name, 'no rows'); return; }
  record('FAIL', name, `leaked ${r.json.length} row(s): ${snippet(r.json[0])}`);
}

// A forbidden WRITE passes when blocked (401/403) or affects zero rows.
// Returns the created/affected rows so the caller can revert.
function assertWriteDenied(name, r) {
  if (r.status === 401 || r.status === 403)            { record('PASS', name, `blocked (${r.status})`); return []; }
  if (Array.isArray(r.json) && r.json.length === 0)    { record('PASS', name, 'no rows affected'); return []; }
  if (r.status >= 400)                                 { record('PASS', name, `rejected (${r.status})`); return []; }
  const rows = Array.isArray(r.json) ? r.json : r.json ? [r.json] : [];
  record('FAIL', name, `SUCCEEDED: ${snippet(rows[0] ?? r.text)}`);
  return rows;
}

// ── Account setup ────────────────────────────────────────────
async function getAccounts() {
  // 1. Bring-your-own existing accounts.
  if (process.env.RLS_USER_A_EMAIL && process.env.RLS_USER_B_EMAIL) {
    console.log(`${C.dim}Using accounts from env vars.${C.reset}`);
    const A = await signIn(process.env.RLS_USER_A_EMAIL, process.env.RLS_USER_A_PASSWORD);
    const B = await signIn(process.env.RLS_USER_B_EMAIL, process.env.RLS_USER_B_PASSWORD);
    return { A, B, provisioned: false };
  }

  const ts  = Date.now();
  const pwd = `Rls!Audit-${ts}`;
  const emailA = `rls-audit-a-${ts}@example.com`;
  const emailB = `rls-audit-b-${ts}@example.com`;

  // 2. Service-role provisioning (pre-confirmed, fully cleaned up afterwards).
  const svc = process.env.SUPABASE_SERVICE_ROLE;
  if (svc) {
    console.log(`${C.dim}Provisioning two confirmed throwaway users via service-role admin API…${C.reset}`);
    const idA = await adminCreateUser(svc, emailA, pwd, 'host');
    const idB = await adminCreateUser(svc, emailB, pwd, 'user');
    cleanups.push(() => adminDeleteUser(svc, idA));
    cleanups.push(() => adminDeleteUser(svc, idB));
    const A = await signIn(emailA, pwd);
    const B = await signIn(emailB, pwd);
    return { A, B, provisioned: 'service' };
  }

  // 3. Plain signup (only works if email confirmation is OFF).
  console.log(`${C.dim}Auto-creating two throwaway users via signup…${C.reset}`);
  const A = await signUp(emailA, pwd, 'host');
  const B = await signUp(emailB, pwd, 'user');
  return { A, B, provisioned: 'signup' };
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log(`${C.bold}Hostile-user RLS audit${C.reset}  ${C.dim}→ ${SUPABASE_URL}${C.reset}`);
  const { A, B, provisioned } = await getAccounts();
  console.log(`${C.dim}A (attacker) = ${A.email}  ${A.id}${C.reset}`);
  console.log(`${C.dim}B (victim)   = ${B.email}  ${B.id}${C.reset}`);

  // Recon: find a public listing (any), and one A does NOT own.
  const pub      = await rest('GET', 'listings?select=id,owner_id,status&status=eq.active&limit=20', { token: A.token });
  const listings = Array.isArray(pub.json) ? pub.json : [];
  const anyListing      = listings[0]?.id ?? null;
  const foreignListing  = listings.find(l => l.owner_id && l.owner_id !== A.id) ?? null;

  // ── Seed victim data (side-effect-free) ────────────────────
  let seededSavedListingId = anyListing;
  if (anyListing) {
    const r = await rest('POST', 'saved_listings', {
      token: B.token, prefer: 'return=representation',
      body: { user_id: B.id, listing_id: anyListing },
    });
    if (Array.isArray(r.json) && r.json[0]) {
      cleanups.push(() => rest('DELETE', `saved_listings?listing_id=eq.${anyListing}&user_id=eq.${B.id}`, { token: B.token }));
    }
  }

  let seededBookingId = null;
  if (process.env.SEED_BOOKINGS === '1' && anyListing) {
    const start = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const end   = new Date(Date.now() + 33 * 864e5).toISOString().slice(0, 10);
    const r = await rest('POST', 'bookings', {
      token: B.token, prefer: 'return=representation',
      body: { listing_id: anyListing, requester_id: B.id, start_date: start, end_date: end, status: 'pending' },
    });
    if (Array.isArray(r.json) && r.json[0]?.id) {
      seededBookingId = r.json[0].id;
      cleanups.push(() => rest('DELETE', `bookings?id=eq.${seededBookingId}`, { token: B.token }));
    }
  }

  // ════════════════════════════════════════════════════════════
  section('1. Cross-user READS (A reading B\'s private data)');

  assertNoRows("A reads B's saved_listings",
    await rest('GET', `saved_listings?user_id=eq.${B.id}&select=*`, { token: A.token }));

  assertNoRows("A reads B's bookings (requester_id=B)",
    await rest('GET', `bookings?requester_id=eq.${B.id}&select=*`, { token: A.token }));

  assertNoRows("A reads B's conversations",
    await rest('GET', `conversations?or=(host_id.eq.${B.id},user_id.eq.${B.id})&host_id=neq.${A.id}&user_id=neq.${A.id}&select=*`, { token: A.token }));

  assertNoRows("A reads B's messages (sender_id=B)",
    await rest('GET', `messages?sender_id=eq.${B.id}&select=*`, { token: A.token }));

  assertNoRows("A reads B's host_compliance",
    await rest('GET', `host_compliance?user_id=eq.${B.id}&select=*`, { token: A.token }));

  assertNoRows("A reads B's community_compliance",
    await rest('GET', `community_compliance?user_id=eq.${B.id}&select=*`, { token: A.token }));

  // Profile privacy: reading B's row at all, and sensitive columns specifically.
  {
    const r = await rest('GET', `profiles?id=eq.${B.id}&select=id,email,phone,stripe_account_id,role`, { token: A.token });
    const row = Array.isArray(r.json) ? r.json[0] : null;
    if (!row) record('PASS', "A reads B's profile (private cols)", 'no row');
    else {
      const leaked = ['email', 'phone', 'stripe_account_id'].filter(k => row[k] != null);
      if (leaked.length) record('FAIL', "A reads B's profile (private cols)", `exposed: ${leaked.join(', ')} = ${snippet(leaked.reduce((o,k)=>(o[k]=row[k],o),{}))}`);
      else record('WARN', "A reads B's profile (private cols)", 'row visible but private cols null (inconclusive on throwaway)');
    }
  }

  // Mass profile harvest.
  {
    const r = await rest('GET', 'profiles?select=id,email,stripe_account_id&limit=500', { token: A.token });
    const rows = Array.isArray(r.json) ? r.json : [];
    const others = rows.filter(p => p.id !== A.id && (p.email != null || p.stripe_account_id != null));
    if (others.length) record('FAIL', 'A harvests all profiles', `${others.length} other users' email/stripe readable, e.g. ${snippet(others[0])}`);
    else record('PASS', 'A harvests all profiles', `only own row exposed (${rows.length} total visible)`);
  }

  // ════════════════════════════════════════════════════════════
  section('2. Privilege escalation & spoofed WRITES');

  // 2a. Self role escalation — the critical one.
  {
    const before = await rest('GET', `profiles?id=eq.${A.id}&select=role,admin_community`, { token: A.token });
    const origRole = before.json?.[0]?.role ?? null;
    const origComm = before.json?.[0]?.admin_community ?? null;

    const r = await rest('PATCH', `profiles?id=eq.${A.id}`, {
      token: A.token, prefer: 'return=representation', body: { role: 'admin' },
    });
    const check = await rest('GET', `profiles?id=eq.${A.id}&select=role`, { token: A.token });
    const nowAdmin = check.json?.[0]?.role === 'admin';
    if (nowAdmin && origRole !== 'admin') {
      record('FAIL', 'A escalates own role to admin', `role changed ${origRole} → admin`);
      await rest('PATCH', `profiles?id=eq.${A.id}`, { token: A.token, body: { role: origRole } }); // revert
    } else {
      record('PASS', 'A escalates own role to admin', 'role unchanged');
    }

    const rc = await rest('PATCH', `profiles?id=eq.${A.id}`, {
      token: A.token, prefer: 'return=representation', body: { admin_community: 'la-ecovilla' },
    });
    const checkC = await rest('GET', `profiles?id=eq.${A.id}&select=admin_community`, { token: A.token });
    if (checkC.json?.[0]?.admin_community === 'la-ecovilla' && origComm !== 'la-ecovilla') {
      record('FAIL', 'A grants self admin_community', 'admin_community now la-ecovilla');
      await rest('PATCH', `profiles?id=eq.${A.id}`, { token: A.token, body: { admin_community: origComm } });
    } else {
      record('PASS', 'A grants self admin_community', 'unchanged');
    }
  }

  // 2b. Edit B's profile.
  {
    const before = await rest('GET', `profiles?id=eq.${B.id}&select=full_name`, { token: B.token });
    const orig   = before.json?.[0]?.full_name ?? null;
    const r = await rest('PATCH', `profiles?id=eq.${B.id}`, {
      token: A.token, prefer: 'return=representation', body: { full_name: '__RLS_AUDIT_TAMPER__' },
    });
    const rows = assertWriteDenied("A edits B's profile name", r);
    if (rows.length) await rest('PATCH', `profiles?id=eq.${B.id}`, { token: B.token, body: { full_name: orig } });
  }

  // 2c. Spoof a saved_listing as B.
  if (anyListing) {
    const r = await rest('POST', 'saved_listings', {
      token: A.token, prefer: 'return=representation',
      body: { user_id: B.id, listing_id: anyListing },
    });
    const rows = assertWriteDenied('A inserts saved_listing as B', r);
    if (rows.length) await rest('DELETE', `saved_listings?listing_id=eq.${anyListing}&user_id=eq.${B.id}`, { token: B.token });
  }

  // 2d. Spoof a booking as B (no email: insert is expected to be DENIED).
  if (anyListing) {
    const start = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const end   = new Date(Date.now() + 63 * 864e5).toISOString().slice(0, 10);
    const r = await rest('POST', 'bookings', {
      token: A.token, prefer: 'return=representation',
      body: { listing_id: anyListing, requester_id: B.id, start_date: start, end_date: end, status: 'accepted' },
    });
    const rows = assertWriteDenied('A inserts booking as B (status=accepted)', r);
    if (rows[0]?.id) await rest('DELETE', `bookings?id=eq.${rows[0].id}`, { token: B.token });
  }

  // 2e. Tamper with a listing A does not own.
  if (foreignListing) {
    const orig = foreignListing.status;
    const r = await rest('PATCH', `listings?id=eq.${foreignListing.id}`, {
      token: A.token, prefer: 'return=representation', body: { status: 'archived' },
    });
    const rows = assertWriteDenied("A archives a foreign listing", r);
    if (rows.length) await rest('PATCH', `listings?id=eq.${foreignListing.id}`, { token: A.token, body: { status: orig } });
  } else {
    record('SKIP', "A archives a foreign listing", 'no foreign active listing found for recon');
  }

  // 2f. Accept B's seeded booking (status change A shouldn't control).
  if (seededBookingId) {
    const r = await rest('PATCH', `bookings?id=eq.${seededBookingId}`, {
      token: A.token, prefer: 'return=representation', body: { status: 'accepted' },
    });
    const rows = assertWriteDenied("A accepts B's booking", r);
    if (rows.length) await rest('PATCH', `bookings?id=eq.${seededBookingId}`, { token: B.token, body: { status: 'pending' } });
  }

  // ════════════════════════════════════════════════════════════
  section('3. Anonymous access (bare anon key, no login)');

  assertNoRows('Anon reads bookings',  await rest('GET', 'bookings?select=*&limit=5'));
  assertNoRows('Anon reads messages',  await rest('GET', 'messages?select=*&limit=5'));
  assertNoRows('Anon reads saved_listings', await rest('GET', 'saved_listings?select=*&limit=5'));
  assertNoRows('Anon reads draft listings', await rest('GET', 'listings?status=eq.draft&select=id,title&limit=5'));

  {
    const r = await rest('GET', 'profiles?select=id,email,stripe_account_id&limit=5');
    const rows = Array.isArray(r.json) ? r.json : [];
    const leaky = rows.filter(p => p.email != null || p.stripe_account_id != null);
    if (leaky.length) record('FAIL', 'Anon harvests profiles', `${leaky.length} rows with email/stripe: ${snippet(leaky[0])}`);
    else record('PASS', 'Anon harvests profiles', `${rows.length} rows, no email/stripe`);
  }

  assertWriteDenied('Anon inserts a booking',
    await rest('POST', 'bookings', {
      prefer: 'return=representation',
      body: { listing_id: anyListing, requester_id: B.id, start_date: '2099-01-01', end_date: '2099-01-03', status: 'pending' },
    }));

  // ── Cleanup ────────────────────────────────────────────────
  section('Cleanup');
  for (const fn of cleanups.reverse()) {
    try { await fn(); } catch (e) { console.log(`  ${C.yellow}WARN${C.reset} cleanup step failed — ${e.message}`); }
  }
  record('PASS', 'Cleanup complete', `${cleanups.length} step(s)`);
  if (provisioned === 'signup') console.log(`  ${C.dim}Note: throwaway auth users (${A.email}, ${B.email}) remain unconfirmed in auth.users — delete manually if desired (needs service role).${C.reset}`);

  // ── Summary ────────────────────────────────────────────────
  const n = s => results.filter(r => r.status === s).length;
  const fails = n('FAIL');
  console.log(`\n${C.bold}Summary${C.reset}  ${C.green}${n('PASS')} pass${C.reset}  ${C.red}${fails} fail${C.reset}  ${C.yellow}${n('WARN')} warn${C.reset}  ${C.dim}${n('SKIP')} skip${C.reset}`);
  if (fails) {
    console.log(`\n${C.red}${C.bold}✗ RLS gaps found.${C.reset} Each FAIL above is data a logged-in user could read or write that they should not.`);
  } else {
    console.log(`\n${C.green}${C.bold}✓ No RLS gaps detected by these probes.${C.reset} (Absence of evidence isn't proof — extend probes as you add tables.)`);
  }
  process.exitCode = fails ? 1 : 0;
}

main().catch(async (e) => {
  console.error(`\n${C.red}Audit aborted:${C.reset} ${e.message}`);
  if (e.code === 'SIGNUP_NO_SESSION') {
    console.error(`${C.dim}Fix: provide a service-role key (SUPABASE_SERVICE_ROLE=…) to auto-provision confirmed users,`);
    console.error(`or two existing logins (RLS_USER_A_EMAIL / _PASSWORD, RLS_USER_B_EMAIL / _PASSWORD).${C.reset}`);
  }
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* best effort */ } }
  process.exitCode = 2;
});
