// ============================================================
// js/api/db.js — Low-level Supabase PostgREST helpers
//
// These are the ONLY functions allowed to call fetch() against
// the Supabase REST endpoint. All domain API files import from
// here. Page code must never import SUPABASE_URL or touch REST.
// ============================================================
import { SUPABASE_URL, SUPABASE_ANON } from '../lib/config.js';
import { Auth } from '../lib/auth.js';

export const REST = `${SUPABASE_URL}/rest/v1`;

function _hdrs(token, extra = {}) {
  return {
    apikey:        SUPABASE_ANON,
    Authorization: `Bearer ${token || SUPABASE_ANON}`,
    Accept:        'application/json',
    ...extra,
  };
}

export async function dbGet(path) {
  const token = await Auth.getToken();
  const res   = await fetch(`${REST}/${path}`, { headers: _hdrs(token) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function dbPost(path, payload, prefer = 'return=representation') {
  const token = await Auth.getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${REST}/${path}`, {
    method:  'POST',
    headers: _hdrs(token, { 'Content-Type': 'application/json', Prefer: prefer }),
    body:    JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  if (prefer === 'return=minimal') return null;
  return res.json();
}

export async function dbPatch(path, payload, prefer = 'return=minimal') {
  const token = await Auth.getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${REST}/${path}`, {
    method:  'PATCH',
    headers: _hdrs(token, { 'Content-Type': 'application/json', Prefer: prefer }),
    body:    JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  if (prefer === 'return=minimal') return null;
  return res.json();
}

export async function dbDelete(path) {
  const token = await Auth.getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${REST}/${path}`, {
    method:  'DELETE',
    headers: _hdrs(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return true;
}

// Extracts the authenticated user's id from the JWT without an extra network call.
export async function getUserId() {
  const token = await Auth.getToken();
  if (!token) return null;
  try { return JSON.parse(atob(token.split('.')[1])).sub; } catch (_) { return null; }
}
