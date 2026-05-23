// ============================================================
// js/auth.js  — Valle Vivo Authentication Helper
// Wraps Supabase Auth + profiles table
// ============================================================

const SUPABASE_URL = 'https://wywmdgelflstnqfgslqw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d21kZ2VsZmxzdG5xZmdzbHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTQxODIsImV4cCI6MjA5NDk3MDE4Mn0.7SAsWpGvYDV-aRaHagt_tBFiSkbNL-Vuc3gHLSs8o9E';

const SESSION_KEY = 'vv_session';

// ── Session storage helpers ──────────────────────────────────
// We write to both storages:
//   sessionStorage → cleared when the tab/browser closes (short-lived)
//   localStorage   → persists across closes (keeps user logged in)
// On read we prefer sessionStorage, fall back to localStorage.

function _saveSession(session) {
    if (!session) return;
    const raw = JSON.stringify(session);
    try { sessionStorage.setItem(SESSION_KEY, raw); } catch (_) { }
    try { localStorage.setItem(SESSION_KEY, raw); } catch (_) { }
}

function _clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { }
    try { localStorage.removeItem(SESSION_KEY); } catch (_) { }
}

function _readSession() {
    try {
        const raw =
            sessionStorage.getItem(SESSION_KEY) ||
            localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

// ── JWT helpers ──────────────────────────────────────────────

function _parseJwt(token) {
    try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(b64));
    } catch (_) {
        return {};
    }
}

// Returns true if the access_token is missing or expired (with 30s grace)
function _isExpired(session) {
    if (!session?.access_token) return true;

    // Prefer expires_at from the session object (Unix timestamp in seconds)
    // — this is what Supabase actually returns on sign-in
    if (session.expires_at) {
        return Date.now() / 1000 > session.expires_at - 30;
    }

    // Fallback: check the JWT exp claim directly
    const { exp } = _parseJwt(session.access_token);
    if (!exp) return false; // no expiry info → treat as valid
    return Date.now() / 1000 > exp - 30;
}

// ── OAuth callback handler ───────────────────────────────────
// After a Google / OAuth redirect, Supabase puts the session
// in the URL hash: #access_token=...&refresh_token=...&...
// We capture it here, save it, then clean the URL.

function _handleOAuthCallback() {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token')) return;

    try {
        // Convert hash params to a plain object
        const params = Object.fromEntries(
            hash.slice(1).split('&').map(p => p.split('=').map(decodeURIComponent))
        );

        if (params.access_token) {
            const session = {
                access_token: params.access_token,
                refresh_token: params.refresh_token || null,
                token_type: params.token_type || 'bearer',
                expires_in: parseInt(params.expires_in) || 3600,
            };
            _saveSession(session);

            // Remove the tokens from the URL so they don't linger in history
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    } catch (_) { }
}

// Run immediately on script load
_handleOAuthCallback();

// ── Low-level Supabase REST calls ────────────────────────────

const _sb = {
    async signUp({ email, password, options }) {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
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
            headers: {
                apikey: SUPABASE_ANON,
                Authorization: `Bearer ${accessToken}`,
            },
        }).catch(() => { }); // best-effort
        _clearSession();
    },

    async signInWithOAuth({ provider, options }) {
        const params = new URLSearchParams({
            provider,
            redirect_to: options?.redirectTo || window.location.origin + '/index.html',
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
        {
            headers: {
                apikey: SUPABASE_ANON,
                Authorization: `Bearer ${accessToken}`,
            },
        }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
}

// ── Public Auth API ──────────────────────────────────────────

window.Auth = {

    // ── Sign up ────────────────────────────────────────────────
    // role must be 'user' or 'host'; anything else defaults to 'user'.
    // The DB trigger handle_new_user() reads raw_user_meta_data.role.
    async signUp({ email, password, name, role }) {
        const safeRole = role === 'host' ? 'host' : 'user';
        return _sb.signUp({
            email,
            password,
            options: { data: { full_name: name, role: safeRole } },
        });
    },

    // ── Sign in ────────────────────────────────────────────────
    async signIn({ email, password }) {
        return _sb.signInWithPassword({ email, password });
    },

    // ── Sign out ───────────────────────────────────────────────
    async signOut() {
        const session = _readSession();
        await _sb.signOut(session?.access_token || '');
    },

    // ── getSession ─────────────────────────────────────────────
    // Returns the full stored session object, refreshing it first
    // if the access_token is expired (uses the refresh_token).
    // Returns null if there is no valid session.
    async getSession() {
        let session = _readSession();
        if (!session) return null;

        if (_isExpired(session)) {
            if (!session.refresh_token) {
                _clearSession();
                return null;
            }
            try {
                session = await _sb.refreshSession(session.refresh_token);
            } catch (_) {
                _clearSession();
                return null;
            }
        }

        return session;
    },

    // ── getToken ───────────────────────────────────────────────
    // Convenience: returns just the access_token string, or null.
    // Use this in data.js / admin.html for Authorization headers.
    async getToken() {
        const session = await this.getSession();
        return session?.access_token || null;
    },

    // ── getUser ────────────────────────────────────────────────
    // Returns { id, email, fullName, role, avatarUrl } from the
    // profiles table — this is the authoritative role source.
    async getUser() {
        const session = await this.getSession();
        if (!session?.access_token) return null;

        const profile = await _fetchProfile(session.access_token);
        if (!profile) return null;

        return {
            id: profile.id,
            email: profile.email,
            fullName: profile.full_name,
            role: profile.role,       // 'user' | 'host' | 'admin'
            avatarUrl: profile.avatar_url,
        };
    },

    // ── redirectByRole ─────────────────────────────────────────
    // admin | host  → admin.html
    // user          → user.html
    // (fallback)    → index.html
    redirectByRole(role) {
        if (role === 'admin' || role === 'host') {
            window.location.href = 'admin.html';
        } else if (role === 'user') {
            window.location.href = 'user.html';
        } else {
            window.location.href = 'index.html';
        }
    },
};

// Expose the raw client for OAuth in login.html
window._supabaseClient = _sb;
window.dispatchEvent(new Event('supabase:ready'));