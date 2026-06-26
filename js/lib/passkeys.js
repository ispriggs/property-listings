// ============================================================
// js/lib/passkeys.js — Passkey (WebAuthn) support
//
// Supabase passkeys live in the official @supabase/supabase-js SDK
// (the SDK runs the browser WebAuthn ceremony for us). This project
// otherwise talks to Supabase over raw REST, so we lazy-load the SDK
// only when a passkey action is taken, and bridge the resulting
// session back into the app's own `vv_session` storage via Auth.
//
// Requires: Supabase Dashboard → Authentication → Passkeys enabled,
// with Relying Party ID + Origins configured for this domain.
// ============================================================
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';
import { Auth } from './auth.js';

// Pinned to the first version that ships the passkeys API (beta).
const SDK_URL = 'https://esm.sh/@supabase/supabase-js@2.105.0';

let _clientPromise = null;

// Lazily create a Supabase client with the experimental passkey API on.
// persistSession/autoRefreshToken are off: the app owns the session, we
// only drive the SDK transiently for each passkey operation.
function _getClient() {
  if (!_clientPromise) {
    _clientPromise = import(SDK_URL).then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: {
          persistSession:   false,
          autoRefreshToken: false,
          experimental:     { passkey: true },
        },
      })
    );
  }
  return _clientPromise;
}

// True when the current browser/device can do WebAuthn.
export function isPasskeySupported() {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential !== 'undefined'
    && !!(navigator.credentials && navigator.credentials.create);
}

// Convert an SDK session into the shape Auth._saveSession expects.
function _toAppSession(s) {
  return {
    access_token:  s.access_token,
    refresh_token: s.refresh_token || null,
    token_type:    s.token_type || 'bearer',
    expires_in:    s.expires_in || 3600,
    expires_at:    s.expires_at || null,
  };
}

// Hand the app's current session to the SDK so authenticated passkey
// operations (register / list / delete) act as the signed-in user.
async function _syncSessionToSdk(supabase) {
  const session = await Auth.getSession();
  if (!session?.access_token) throw new Error('You need to be signed in to manage passkeys.');
  await supabase.auth.setSession({
    access_token:  session.access_token,
    refresh_token: session.refresh_token || '',
  });
}

// ── Public API ───────────────────────────────────────────────

// Passwordless login. Uses discoverable credentials, so no email needed.
// On success the SDK session is bridged into the app and the user profile
// is returned (or null if the profile can't be loaded).
export async function signInWithPasskey() {
  const supabase = await _getClient();
  const { data, error } = await supabase.auth.signInWithPasskey();
  if (error) throw error;
  if (!data?.session) throw new Error('Passkey sign-in did not return a session.');
  Auth.setSession(_toAppSession(data.session));
  return Auth.getUser();
}

// Enroll a new passkey for the signed-in user.
export async function registerPasskey() {
  const supabase = await _getClient();
  await _syncSessionToSdk(supabase);
  const { data, error } = await supabase.auth.registerPasskey();
  if (error) throw error;
  return data;
}

// List the signed-in user's registered passkeys.
export async function listPasskeys() {
  const supabase = await _getClient();
  await _syncSessionToSdk(supabase);
  const { data, error } = await supabase.auth.passkey.list();
  if (error) throw error;
  return data || [];
}

// Remove a passkey by id.
export async function deletePasskey(passkeyId) {
  const supabase = await _getClient();
  await _syncSessionToSdk(supabase);
  const { error } = await supabase.auth.passkey.delete({ passkeyId });
  if (error) throw error;
}

// Rename a passkey's friendly name.
export async function renamePasskey(passkeyId, friendlyName) {
  const supabase = await _getClient();
  await _syncSessionToSdk(supabase);
  const { error } = await supabase.auth.passkey.update({ passkeyId, friendlyName });
  if (error) throw error;
}
