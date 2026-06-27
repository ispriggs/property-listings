// ============================================================
// js/pages/login.js — Login / Sign-up page logic
// Extracted from pages/login.html inline scripts
// ============================================================
import { SUPABASE_URL, SUPABASE_ANON } from '../lib/config.js';
import { Auth } from '../lib/auth.js';
import { isPasskeySupported, signInWithPasskey, registerPasskey } from '../lib/passkeys.js';

// ── Tab switching ────────────────────────────────────────────

function switchTab(tab) {
  document.getElementById('form-login').style.display   = tab === 'login'  ? 'block' : 'none';
  document.getElementById('form-signup').style.display  = tab === 'signup' ? 'block' : 'none';
  document.getElementById('form-success').style.display = 'none';
  document.getElementById('form-forgot').style.display  = 'none';
  document.getElementById('auth-tabs').style.display    = 'flex';
  document.getElementById('tab-login').classList.toggle('active',  tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  clearAlert();
}

function showForgotPassword() {
  document.getElementById('form-login').style.display  = 'none';
  document.getElementById('form-forgot').style.display = 'block';
  document.getElementById('auth-tabs').style.display   = 'none';
  clearAlert();
}

// ── Alert helpers ────────────────────────────────────────────

function showAlert(msg, type = 'error') {
  const el = document.getElementById('alert');
  el.textContent = msg;
  el.className = `alert visible ${type}`;
}

function clearAlert() {
  document.getElementById('alert').className = 'alert';
}

function fieldError(id, msg) {
  const el    = document.getElementById(id);
  const input = document.getElementById(id.replace('-error', ''));
  if (el)    { el.textContent = msg; el.classList.toggle('visible', !!msg); }
  if (input) { input.classList.toggle('error', !!msg); }
}

function clearErrors(ids) { ids.forEach(id => fieldError(id, '')); }

function setLoading(btnId, spinnerId, textId, loading, label) {
  document.getElementById(btnId).disabled = loading;
  document.getElementById(spinnerId).classList.toggle('visible', loading);
  document.getElementById(textId).textContent = loading ? '' : (label || 'Submit');
}

function showForm() {
  document.getElementById('panel-loading').style.display = 'none';
  document.getElementById('form-box').style.display      = 'block';
}

// ── Auth handlers ────────────────────────────────────────────

async function handleLogin() {
  clearErrors(['login-email-error', 'login-password-error']);
  clearAlert();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email)    { fieldError('login-email-error', 'Email is required'); return; }
  if (!password) { fieldError('login-password-error', 'Password is required'); return; }
  setLoading('login-btn', 'login-spinner', 'login-btn-text', true, 'Sign In');
  try {
    await Auth.signIn({ email, password });
    const user = await Auth.getUser();
    if (!user) throw new Error('Could not load your profile. Please try again.');

    const pending = sessionStorage.getItem('pendingBooking');
    if (pending && user.role === 'user') {
      window.location.href = '../index.html?redirect=booking';
      return;
    }
    const pendingSave = sessionStorage.getItem('pendingSaveListing');
    if (pendingSave && user.role === 'user') {
      window.location.href = '../index.html?listing=' + encodeURIComponent(pendingSave);
      return;
    }
    // Normal login → optionally offer a passkey before redirecting.
    maybeOfferPasskey(function () { Auth.redirectByRole(user.role); });
  } catch (err) {
    showAlert(friendlyError(err.message));
    setLoading('login-btn', 'login-spinner', 'login-btn-text', false, 'Sign In');
  }
}

// ── Passkeys ─────────────────────────────────────────────────

let _pendingRedirect = null;

function passkeyFriendlyError(err) {
  const msg = (err && (err.message || err.name)) || '';
  if (/NotAllowed|AbortError/i.test(msg)) return 'Passkey sign-in was cancelled.';
  if (/no.*credential|not found|no passkey/i.test(msg))
    return 'No passkey found on this device. Sign in with your email, then add one from your profile.';
  return 'Could not sign in with a passkey. Try your email and password instead.';
}

async function handlePasskeyLogin() {
  clearAlert();
  const btn = document.getElementById('passkey-btn');
  btn.disabled = true;
  try {
    const user = await signInWithPasskey();
    if (!user) throw new Error('Could not load your profile. Please try again.');

    const pending = sessionStorage.getItem('pendingBooking');
    if (pending && user.role === 'user') { window.location.href = '../index.html?redirect=booking'; return; }
    const pendingSave = sessionStorage.getItem('pendingSaveListing');
    if (pendingSave && user.role === 'user') { window.location.href = '../index.html?listing=' + encodeURIComponent(pendingSave); return; }
    Auth.redirectByRole(user.role);
  } catch (err) {
    btn.disabled = false;
    if (err && err.name === 'NotAllowedError') return; // user dismissed the prompt — stay silent
    showAlert(passkeyFriendlyError(err));
  }
}

// After a password login, offer to enrol a passkey (once per browser).
function maybeOfferPasskey(redirect) {
  if (!isPasskeySupported() || localStorage.getItem('pk_nudge_dismissed') === '1') {
    redirect();
    return;
  }
  _pendingRedirect = redirect;
  document.getElementById('form-login').style.display   = 'none';
  document.getElementById('form-signup').style.display  = 'none';
  document.getElementById('auth-tabs').style.display    = 'none';
  document.getElementById('form-passkey-nudge').style.display = 'block';
  clearAlert();
}

function _finishNudge() {
  localStorage.setItem('pk_nudge_dismissed', '1');
  if (_pendingRedirect) _pendingRedirect();
}

async function handleNudgeAdd() {
  setLoading('nudge-add-btn', 'nudge-spinner', 'nudge-add-text', true, 'Add a passkey');
  try {
    await registerPasskey();
    _finishNudge();
  } catch (err) {
    setLoading('nudge-add-btn', 'nudge-spinner', 'nudge-add-text', false, 'Add a passkey');
    if (err && err.name === 'NotAllowedError') return; // cancelled — let them retry or skip
    showAlert('Could not set up the passkey. You can add one later from your profile.');
  }
}

// ── Password rules (match Supabase: 8+ chars, upper, lower, digit) ──

function passwordChecks(pw) {
  return {
    len:   pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /[0-9]/.test(pw),
  };
}

// Returns an error string if the password fails any rule, else ''.
function passwordError(pw) {
  const c = passwordChecks(pw);
  const missing = [];
  if (!c.len)   missing.push('8 characters');
  if (!c.upper) missing.push('an uppercase letter');
  if (!c.lower) missing.push('a lowercase letter');
  if (!c.digit) missing.push('a number');
  if (!missing.length) return '';
  return 'Password needs ' + missing.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
}

// Live-update the requirements checklist as the user types.
function updatePwReqs() {
  const pw = document.getElementById('signup-password').value;
  const c = passwordChecks(pw);
  document.querySelectorAll('#pw-reqs li').forEach(li => {
    li.classList.toggle('met', !!c[li.dataset.req]);
  });
}

async function handleSignup() {
  clearErrors(['signup-name-error', 'signup-email-error', 'signup-password-error']);
  clearAlert();
  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const roleEl   = document.querySelector('input[name="role"]:checked');
  const role     = roleEl ? roleEl.value : 'user';
  let valid = true;
  if (!name)              { fieldError('signup-name-error', 'Name is required'); valid = false; }
  if (!email)             { fieldError('signup-email-error', 'Email is required'); valid = false; }
  if (!password)          { fieldError('signup-password-error', 'Password is required'); valid = false; }
  else {
    const issue = passwordError(password);
    if (issue) { fieldError('signup-password-error', issue); valid = false; }
  }
  if (!valid) return;
  setLoading('signup-btn', 'signup-spinner', 'signup-btn-text', true, 'Create Account');
  try {
    await Auth.signUp({ email, password, name, role });
    document.getElementById('success-email').textContent = email;
    document.getElementById('form-signup').style.display  = 'none';
    document.getElementById('form-success').style.display = 'block';
  } catch (err) {
    showAlert(friendlyError(err.message));
    setLoading('signup-btn', 'signup-spinner', 'signup-btn-text', false, 'Create Account');
  }
}

async function handleGoogleLogin() {
  try {
    await Auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://properties.lev.cr/pages/login.html' },
    });
  } catch (err) {
    showAlert('Google sign-in failed. Please try email instead.');
  }
}

async function handleResetRequest() {
  const email  = document.getElementById('reset-email').value.trim();
  const errEl  = document.getElementById('reset-email-error');
  errEl.textContent = ''; errEl.classList.remove('visible');
  if (!email) { errEl.textContent = 'Email is required'; errEl.classList.add('visible'); return; }
  setLoading('reset-btn', 'reset-spinner', 'reset-btn-text', true, 'Send Reset Link');

  fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=` +
    encodeURIComponent('https://properties.lev.cr/pages/reset-password.html'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ email }),
  }).catch(() => {});

  document.getElementById('form-forgot').style.display = 'none';
  document.getElementById('auth-tabs').style.display   = 'flex';
  switchTab('login');
  showAlert('If that email is registered, a reset link is on its way.', 'success');
}

let _resendCooldown = null;

async function handleResend() {
  const email  = document.getElementById('success-email').textContent.trim();
  if (!email) return;
  const btn    = document.getElementById('resend-btn');
  const status = document.getElementById('resend-status');
  btn.disabled = true;
  status.style.color = 'var(--stone)';
  status.textContent = 'Sending…';
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
      body: JSON.stringify({ type: 'signup', email }),
    });
    if (!res.ok) throw new Error((await res.json()).msg || 'Failed');
    status.style.color = '#2e7d32';
    status.textContent = 'Email resent — check your inbox.';
  } catch (err) {
    status.style.color = '#c0392b';
    status.textContent = 'Could not resend. Please try again shortly.';
    btn.disabled = false;
    return;
  }
  let secs = 60;
  _resendCooldown = setInterval(() => {
    secs--;
    btn.textContent = `Resend again in ${secs}s`;
    if (secs <= 0) {
      clearInterval(_resendCooldown);
      btn.disabled = false;
      btn.textContent = 'Resend confirmation email';
      status.textContent = '';
    }
  }, 1000);
}

function selectRole(role) {
  document.getElementById('role-guest-opt').classList.toggle('selected', role === 'user');
  document.getElementById('role-host-opt').classList.toggle('selected', role === 'host');
}

function friendlyError(msg) {
  if (!msg)                                return 'An unexpected error occurred.';
  if (msg.includes('Invalid login'))       return 'Incorrect email or password. Please try again.';
  if (msg.includes('Email not confirmed')) return 'Please confirm your email before signing in.';
  if (msg.includes('already registered')) return 'An account with this email already exists. Try signing in.';
  if (msg.includes('Password should') || msg.toLowerCase().includes('weak'))
    return 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.';
  return 'Something went wrong. Please try again.';
}

// ── Session check ────────────────────────────────────────────

async function checkSession() {
  try {
    const session = await Auth.getSession();
    if (session) {
      try {
        const user = await Auth.getUser();
        if (user) { Auth.redirectByRole(user.role); return; }
      } catch (_) {}
      await Auth.signOut();
    }
  } catch (_) {}
  showForm();
  if (window._authCallbackType === 'signup') {
    switchTab('login');
    showAlert('Email confirmed! You can now sign in.', 'success');
  }
}

// ── Wire up event listeners ──────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  document.getElementById('tab-login')?.addEventListener('click', () => switchTab('login'));
  document.getElementById('tab-signup')?.addEventListener('click', () => switchTab('signup'));

  // Login form
  document.getElementById('login-btn')?.addEventListener('click', handleLogin);
  document.getElementById('login-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

  // Signup form
  document.getElementById('signup-btn')?.addEventListener('click', handleSignup);
  document.getElementById('signup-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleSignup(); });
  document.getElementById('signup-password')?.addEventListener('input', updatePwReqs);

  // Google OAuth
  document.getElementById('google-btn')?.addEventListener('click', handleGoogleLogin);

  // Passkeys
  if (isPasskeySupported()) {
    const pkBtn = document.getElementById('passkey-btn');
    const pkDivider = document.getElementById('login-alt-divider');
    if (pkDivider) pkDivider.style.display = '';
    if (pkBtn) { pkBtn.style.display = ''; pkBtn.addEventListener('click', handlePasskeyLogin); }
  }
  document.getElementById('nudge-add-btn')?.addEventListener('click', handleNudgeAdd);
  document.getElementById('nudge-skip-btn')?.addEventListener('click', _finishNudge);

  // Reset password
  document.getElementById('reset-btn')?.addEventListener('click', handleResetRequest);

  // Resend confirmation
  document.getElementById('resend-btn')?.addEventListener('click', handleResend);

  // "Forgot password?" link
  document.querySelector('[data-action="forgot"]')?.addEventListener('click', e => { e.preventDefault(); showForgotPassword(); });

  // Back to sign-in links
  document.querySelectorAll('[data-action="login"]').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); switchTab('login'); })
  );
  // Sign-up links
  document.querySelectorAll('[data-action="signup"]').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); switchTab('signup'); })
  );

  // Role selector
  document.querySelectorAll('input[name="role"]').forEach(input =>
    input.addEventListener('change', () => selectRole(input.value))
  );

  // Check URL params
  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'signup') switchTab('signup');

  if (window._authCallbackType === 'signup') {
    const loadingMsg = document.querySelector('#panel-loading p');
    if (loadingMsg) loadingMsg.textContent = 'Email confirmed — signing you in…';
  }

  checkSession();
});
