// ============================================================
// js/pages/messaging.js — Ecovilla Rentals In-App Messaging
// ES module — imported by user.html and host.html entry scripts
// ============================================================
import { SUPABASE_URL, SUPABASE_ANON } from '../lib/config.js';
import { Auth } from '../lib/auth.js';
import { esc } from '../lib/utils.js';

'use strict';

const REST = `${SUPABASE_URL}/rest/v1`;

// ── State ────────────────────────────────────────────────────
let _user         = null;
let _convId       = null;
let _convLocked   = false;
let _convIsHost   = false;
let _otherName    = '';
let _showArchived = false;
let _profileCache = {};
let _badgeTimer   = null;
let _threadTimer  = null;

// ── REST helpers ─────────────────────────────────────────────

async function _get(path) {
  const token = await Auth.getToken();
  const res = await fetch(`${REST}/${path}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token || SUPABASE_ANON}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function _patch(path, payload) {
  const token = await Auth.getToken();
  const res = await fetch(`${REST}/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token || SUPABASE_ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function _post(path, payload) {
  const token = await Auth.getToken();
  const res = await fetch(`${REST}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token || SUPABASE_ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── Formatting helpers ───────────────────────────────────────

function _escAndLinkify(text) {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  return String(text || '').split(urlPattern).map((part, i) => {
    if (i % 2 === 1) {
      const e = esc(part);
      return `<a href="${e}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;word-break:break-all">${e}</a>`;
    }
    return esc(part).replace(/\n/g, '<br>');
  }).join('');
}

function _fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date(), ms = now - d;
  if (ms < 60000)   return 'just now';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString();
  if (d.toDateString() === yesterday) return 'Yesterday';
  if (ms < 604800000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function _fmtDate(iso) {
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
}

// ── Profile name cache ───────────────────────────────────────

async function _cacheProfiles(ids) {
  const needed = ids.filter(id => id && !_profileCache[id]);
  if (!needed.length) return;
  try {
    const rows = await _get(`profiles?id=in.(${needed.join(',')})&select=id,full_name`);
    rows.forEach(r => { _profileCache[r.id] = r.full_name || '—'; });
  } catch (_) {}
}

// ── Init ─────────────────────────────────────────────────────

export async function init() {
  _user = await Auth.getUser();
  if (!_user) return;
  await loadConversations();
  _startBadgePolling();
}

// ── Conversation list ────────────────────────────────────────

export async function loadConversations() {
  const el = document.getElementById('msg-conv-list');
  if (!el) return;
  el.innerHTML = '<div class="msg-empty">Loading…</div>';
  try {
    let convs = await _get(
      'conversations?select=*,listing:listings(id,title,images)' +
      `&or=(host_id.eq.${_user.id},user_id.eq.${_user.id})&order=updated_at.desc`
    );
    if (!_showArchived) {
      convs = convs.filter(c => c.host_id === _user.id || !c.user_archived);
    }
    await _cacheProfiles(convs.map(c => c.host_id === _user.id ? c.user_id : c.host_id));
    _renderList(convs);

    const total = convs.reduce((s, c) => s + (c.host_id === _user.id ? (c.unread_host || 0) : (c.unread_user || 0)), 0);
    const badge = document.getElementById('msg-nav-badge');
    if (badge) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = total > 0 ? '' : 'none'; }
  } catch (err) {
    el.innerHTML = '<div class="msg-empty">Could not load messages.</div>';
    console.error('[Messaging]', err);
  }
}

function _renderList(convs) {
  const el = document.getElementById('msg-conv-list');
  if (!el) return;
  const toggle = document.getElementById('msg-archive-toggle');
  if (toggle) toggle.style.display = '';

  if (!convs.length) {
    el.innerHTML = '<div class="msg-empty"><p>No messages yet.</p><p style="font-size:.8rem;margin-top:6px">A conversation thread is created automatically when a booking request is submitted.</p></div>';
    return;
  }

  el.innerHTML = convs.map(c => {
    const isHost   = c.host_id === _user.id;
    const other    = _profileCache[isHost ? c.user_id : c.host_id] || (isHost ? 'Guest' : 'Host');
    const listing  = c.listing || {};
    const img      = (listing.images || [])[0] || 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=200&q=80';
    const preview  = c.last_message_body || 'No messages yet';
    const unread   = isHost ? (c.unread_host || 0) : (c.unread_user || 0);

    return `<div class="msg-conv-item${c.is_locked ? ' locked' : ''}" onclick="Messaging.openConversation('${c.id}')">
      <img class="msg-conv-thumb" src="${esc(img)}" alt="" loading="lazy">
      <div class="msg-conv-body">
        <div class="msg-conv-row">
          <span class="msg-conv-name">${esc(other)}</span>
          <span class="msg-conv-time">${_fmtTime(c.last_message_at || c.updated_at)}</span>
        </div>
        <div class="msg-conv-prop">${esc(listing.title || '—')}</div>
        <div class="msg-conv-preview">${c.is_locked ? '🔒 ' : ''}${esc(preview.slice(0, 70))}${preview.length > 70 ? '…' : ''}</div>
      </div>
      <div class="msg-conv-actions">
        ${unread > 0 ? `<span class="msg-unread-count">${unread}</span>` : ''}
        ${!isHost ? `<button class="msg-archive-btn" onclick="event.stopPropagation();Messaging.${c.user_archived ? 'un' : ''}archiveConversation('${c.id}')" title="${c.user_archived ? 'Unarchive' : 'Archive'}">${c.user_archived ? '↩' : '⊘'}</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Thread ───────────────────────────────────────────────────

export async function openConversation(convId) {
  _convId = convId;
  _show('msg-thread-view');
  _hide('msg-list-view');
  try {
    const convs   = await _get(`conversations?id=eq.${convId}&select=*,listing:listings(id,title,images,community)`);
    const conv    = convs[0];
    if (!conv) return;
    _convLocked = conv.is_locked;
    _convIsHost = conv.host_id === _user.id;
    await _cacheProfiles([_convIsHost ? conv.user_id : conv.host_id]);
    _otherName = _profileCache[_convIsHost ? conv.user_id : conv.host_id] || (_convIsHost ? 'Guest' : 'Host');

    const bookings = await _get(`bookings?id=eq.${conv.booking_id}&select=start_date,end_date,status`);
    const booking  = bookings[0] || {};
    const listing  = conv.listing || {};

    _setText('msg-t-title', listing.title || '—');
    _setText('msg-t-sub', 'With ' + _otherName + (booking.start_date ? '  ·  ' + _fmtDate(booking.start_date) + ' → ' + _fmtDate(booking.end_date) : ''));

    const badge = document.getElementById('msg-t-badge');
    if (badge) { badge.textContent = booking.status || ''; badge.className = 'badge ' + (booking.status || ''); }

    if (conv.is_locked) { _show('msg-locked-bar'); _hide('msg-composer'); }
    else                { _hide('msg-locked-bar'); _show('msg-composer'); }

    await _loadMessages();
    await _markRead();
    _startThreadPolling();
  } catch (err) { console.error('[Messaging] openConversation', err); }
}

async function _loadMessages() {
  const el = document.getElementById('msg-bubbles');
  if (!el || !_convId) return;
  try {
    const msgs = await _get(`messages?conversation_id=eq.${_convId}&select=*&order=created_at.asc`);
    _renderMessages(msgs);
  } catch (err) { console.error('[Messaging] _loadMessages', err); }
}

function _renderMessages(msgs) {
  const el = document.getElementById('msg-bubbles');
  if (!el) return;
  let foundUnread = false;

  if (!msgs.length) {
    el.innerHTML = '<div class="msg-empty" style="flex:1"><p>No messages yet.</p><p style="font-size:.8rem;margin-top:4px">Send the first message!</p></div>';
    return;
  }

  el.innerHTML = msgs.map(m => {
    const isMine = m.sender_id === _user.id;
    const first  = (isMine ? (_user.fullName || 'You') : _otherName).split(' ')[0];
    let unreadSep = '';
    if (!isMine && !m.is_read && !foundUnread) {
      foundUnread = true;
      unreadSep = '<div class="msg-unread-sep">New messages</div>';
    }
    return unreadSep +
      `<div class="msg-bubble ${isMine ? 'mine' : 'theirs'}">
        <div class="msg-bubble-sender">${esc(first)} · ${_fmtTime(m.created_at)}</div>
        <div class="msg-bubble-text">${_escAndLinkify(m.body)}</div>
      </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function _containsPhone(text) {
  return /(\+?\d[\d\s\-().]{6,}\d)/.test(text);
}

function _showPhoneWarning() {
  if (document.getElementById('msg-phone-warning')) return;
  const warn = document.createElement('div');
  warn.id = 'msg-phone-warning';
  warn.style.cssText = 'background:#fef9ec;border:1px solid #f4c553;border-radius:8px;padding:10px 14px;margin:8px 0;font-size:.82rem;line-height:1.45;color:#5a4a00;display:flex;gap:10px;align-items:flex-start';
  warn.innerHTML = '<span style="font-size:1rem;flex-shrink:0">⚠️</span><div><strong>Phone numbers aren\'t allowed in messages.</strong> Please remove it before sending — all communication must stay on this platform.</div>';
  const input = document.getElementById('msg-input');
  if (input?.parentNode) { input.parentNode.insertBefore(warn, input); input.focus(); }
}

export async function sendMessage() {
  if (_convLocked) return;
  const input = document.getElementById('msg-input');
  const btn   = document.getElementById('msg-send-btn');
  const body  = input ? input.value.trim() : '';
  if (!body || !_convId) return;
  if (_containsPhone(body)) { _showPhoneWarning(); return; }
  document.getElementById('msg-phone-warning')?.remove();
  if (btn) btn.disabled = true;
  try {
    await _post('messages', { conversation_id: _convId, sender_id: _user.id, body });
    if (input) { input.value = ''; input.style.height = 'auto'; }
    await _loadMessages();
  } catch (err) { console.error('[Messaging] sendMessage', err); }
  if (btn) btn.disabled = false;
}

async function _markRead() {
  if (!_convId) return;
  try {
    await _patch(`messages?conversation_id=eq.${_convId}&sender_id=neq.${_user.id}&is_read=eq.false`, { is_read: true });
    const payload = {};
    payload[_convIsHost ? 'unread_host' : 'unread_user'] = 0;
    await _patch(`conversations?id=eq.${_convId}`, payload);
  } catch (_) {}
}

export function closeThread() {
  _stopThreadPolling();
  _convId = null;
  _hide('msg-thread-view');
  _show('msg-list-view');
  loadConversations();
}

export async function archiveConversation(convId) {
  try { await _patch(`conversations?id=eq.${convId}`, { user_archived: true }); await loadConversations(); }
  catch (err) { console.error('[Messaging] archive', err); }
}

export async function unarchiveConversation(convId) {
  try { await _patch(`conversations?id=eq.${convId}`, { user_archived: false }); await loadConversations(); }
  catch (err) { console.error('[Messaging] unarchive', err); }
}

export function toggleArchived() {
  _showArchived = !_showArchived;
  const btn = document.getElementById('msg-archive-toggle');
  if (btn) btn.textContent = _showArchived ? 'Hide Archived' : 'Show Archived';
  loadConversations();
}

// ── Polling ──────────────────────────────────────────────────
function _startBadgePolling()  { clearInterval(_badgeTimer);  _badgeTimer  = setInterval(loadConversations, 30000); }
function _startThreadPolling() { clearInterval(_threadTimer); _threadTimer = setInterval(() => { _loadMessages(); _markRead(); }, 5000); }
function _stopThreadPolling()  { clearInterval(_threadTimer); _threadTimer = null; }

// ── DOM helpers ──────────────────────────────────────────────
function _show(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function _hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function _setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }

// ── Input auto-resize + enter-to-send ────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('msg-input');
  if (!input) return;
  input.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
});

// ── Public API (window global for HTML onclick handlers) ─────
export const Messaging = { init, loadConversations, openConversation, closeThread, sendMessage, archiveConversation, unarchiveConversation, toggleArchived };
window.Messaging = Messaging;
