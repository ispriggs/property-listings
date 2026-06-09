// ============================================================
// js/lib/auth.js — Ecovilla Rentals Authentication
// ES module: import { Auth } from './auth.js'
// ============================================================
import { SUPABASE_URL, SUPABASE_ANON, SITE_URL } from './config.js';

const SESSION_KEY = 'vv_session';

// ── Session storage helpers ──────────────────────────────────
function _saveSession(session) {
  if (!session) return;
  const raw = JSON.stringify(session);
  try { sessionStorage.setItem(SESSION_KEY, raw); } catch (_) {}
  try { localStorage.setItem(SESSION_KEY, raw); } catch (_) {}
}

function _clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
}

function _readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

// ── JWT helpers ──────────────────────────────────────────────
function _parseJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch (_) { return {}; }
}

function _isExpired(session) {
  if (!session?.access_token) return true;
  if (session.expires_at) return Date.now() / 1000 > session.expires_at - 30;
  const { exp } = _parseJwt(session.access_token);
  if (!exp) return false;
  return Date.now() / 1000 > exp - 30;
}

// ── OAuth callback handler ───────────────────────────────────
function _handleOAuthCallback() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return;
  try {
    const params = Object.fromEntries(
      hash.slice(1).split('&').map(p => p.split('=').map(decodeURIComponent))
    );
    if (params.access_token) {
      _saveSession({
        access_token:  params.access_token,
        refresh_token: params.refresh_token || null,
        token_type:    params.token_type || 'bearer',
        expires_in:    parseInt(params.expires_in) || 3600,
      });
      window._authCallbackType = params.type || null;
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch (_) {}
}

_handleOAuthCallback();

// ── Low-level Supabase REST calls ────────────────────────────
const _sb = {
  async signUp({ email, password, options }) {
    const redirectTo = encodeURIComponent(SITE_URL + '/pages/login.html');
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup?redirect_to=${redirectTo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
      body: JSON.stringify({ email, password, data: options?.data || {} }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error_description || json.msg || 'Sign-up failed');
    return json;
  },

  async signInWithPassword({ email, password }) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error_description || json.msg || 'Sign-in failed');
    _saveSession(json);
    return json;
  },

  async refreshSession(refreshToken) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error_description || json.msg || 'Refresh failed');
    _saveSession(json);
    return json;
  },

  async signOut(accessToken) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
    _clearSession();
  },

  async signInWithOAuth({ provider, options }) {
    const params = new URLSearchParams({
      provider,
      redirect_to: options?.redirectTo || SITE_URL + '/index.html',
    });
    window.location.href = `${SUPABASE_URL}/auth/v1/authorize?${params}`;
  },
};

// ── Profile fetch ────────────────────────────────────────────
async function _fetchProfile(accessToken) {
  const userId = _parseJwt(accessToken).sub;
  if (!userId) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// ── Public Auth API ──────────────────────────────────────────
export const Auth = {
  async signUp({ email, password, name, role }) {
    const safeRole = role === 'host' ? 'host' : 'user';
    return _sb.signUp({ email, password, options: { data: { full_name: name, role: safeRole } } });
  },

  async signIn({ email, password }) {
    return _sb.signInWithPassword({ email, password });
  },

  async signOut() {
    const session = _readSession();
    await _sb.signOut(session?.access_token || '');
  },

  async signInWithOAuth({ provider, options }) {
    return _sb.signInWithOAuth({ provider, options });
  },

  async getSession() {
    let session = _readSession();
    if (!session) return null;
    if (_isExpired(session)) {
      if (!session.refresh_token) { _clearSession(); return null; }
      try { session = await _sb.refreshSession(session.refresh_token); }
      catch (_) { _clearSession(); return null; }
    }
    return session;
  },

  async getToken() {
    const session = await this.getSession();
    return session?.access_token || null;
  },

  async getUser() {
    const session = await this.getSession();
    if (!session?.access_token) return null;
    const profile = await _fetchProfile(session.access_token);
    if (!profile) return null;
    return {
      id:             profile.id,
      email:          profile.email,
      fullName:       profile.full_name,
      role:           profile.role,
      avatarUrl:      profile.avatar_url,
      adminCommunity: profile.admin_community || null,
    };
  },

  // Called from pages/login.html — dashboard pages are siblings in pages/
  redirectByRole(role) {
    if (role === 'admin')     window.location.href = 'admin.html';
    else if (role === 'host') window.location.href = 'host.html';
    else if (role === 'user') window.location.href = 'user.html';
    else                      window.location.href = '../index.html';
  },
};

// ── Backward-compat globals (for HTML inline scripts) ────────
window.Auth = Auth;

// ── Service worker registration ──────────────────────────────
// Use absolute path so this works from any page depth.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

window.dispatchEvent(new Event('supabase:ready'));
