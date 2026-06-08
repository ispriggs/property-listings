// ============================================================
// js/messaging.js — Ecovilla Rentals In-App Messaging
// Requires auth.js to be loaded first (uses Auth.getUser/getToken)
// ============================================================

(function () {
    'use strict';

    var SB_URL  = typeof SUPABASE_URL  !== 'undefined' ? SUPABASE_URL  : 'https://wywmdgelflstnqfgslqw.supabase.co';
    var SB_ANON = typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d21kZ2VsZmxzdG5xZmdzbHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTQxODIsImV4cCI6MjA5NDk3MDE4Mn0.7SAsWpGvYDV-aRaHagt_tBFiSkbNL-Vuc3gHLSs8o9E';

    // ── State ────────────────────────────────────────────────
    var _user          = null;   // Auth.getUser() result
    var _convId        = null;   // currently open conversation id
    var _convLocked    = false;
    var _convIsHost    = false;  // true if current user is host_id in the open conversation
    var _otherName     = '';     // other party name for open thread
    var _showArchived  = false;
    var _profileCache  = {};     // uuid → full_name
    var _badgeTimer    = null;
    var _threadTimer   = null;

    // ── REST helpers ─────────────────────────────────────────

    async function _get(path) {
        var token = await Auth.getToken();
        var res = await fetch(SB_URL + '/rest/v1/' + path, {
            headers: {
                apikey: SB_ANON,
                Authorization: 'Bearer ' + (token || SB_ANON),
                Accept: 'application/json',
            }
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }

    async function _patch(path, payload) {
        var token = await Auth.getToken();
        var res = await fetch(SB_URL + '/rest/v1/' + path, {
            method: 'PATCH',
            headers: {
                apikey: SB_ANON,
                Authorization: 'Bearer ' + (token || SB_ANON),
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
    }

    async function _post(path, payload) {
        var token = await Auth.getToken();
        var res = await fetch(SB_URL + '/rest/v1/' + path, {
            method: 'POST',
            headers: {
                apikey: SB_ANON,
                Authorization: 'Bearer ' + (token || SB_ANON),
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
    }

    // ── Formatting helpers ───────────────────────────────────

    function _esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Escape text but turn URLs into clickable links and newlines into <br>
    function _escAndLinkify(text) {
        var urlPattern = /(https?:\/\/[^\s]+)/g;
        var parts = String(text || '').split(urlPattern);
        return parts.map(function (part, i) {
            if (i % 2 === 1) {
                var escaped = _esc(part);
                return '<a href="' + escaped + '" target="_blank" rel="noopener noreferrer" ' +
                    'style="color:inherit;text-decoration:underline;word-break:break-all">' + escaped + '</a>';
            }
            return _esc(part).replace(/\n/g, '<br>');
        }).join('');
    }

    function _fmtTime(iso) {
        if (!iso) return '';
        var d   = new Date(iso);
        var now = new Date();
        var ms  = now - d;
        if (ms < 60000)     return 'just now';
        if (ms < 3600000)   return Math.floor(ms / 60000) + 'm ago';
        var today = now.toDateString();
        var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString();
        if (d.toDateString() === today)     return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (d.toDateString() === yesterday) return 'Yesterday';
        if (ms < 604800000) return d.toLocaleDateString([], { weekday: 'short' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    function _fmtDate(iso) {
        if (!iso) return '';
        return new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // ── Profile name cache ───────────────────────────────────

    async function _cacheProfiles(ids) {
        var needed = ids.filter(function (id) { return id && !_profileCache[id]; });
        if (!needed.length) return;
        try {
            var rows = await _get('profiles?id=in.(' + needed.join(',') + ')&select=id,full_name');
            rows.forEach(function (r) { _profileCache[r.id] = r.full_name || '—'; });
        } catch (_) { /* silently fall back to id */ }
    }

    // ── Init ─────────────────────────────────────────────────

    async function init() {
        _user = await Auth.getUser();
        if (!_user) return;
        await loadConversations();
        _startBadgePolling();
    }

    // ── Conversation list ────────────────────────────────────

    async function loadConversations() {
        var el = document.getElementById('msg-conv-list');
        if (!el) return;
        el.innerHTML = '<div class="msg-empty">Loading…</div>';

        try {
            // Fetch conversations where user is on EITHER side (host or guest)
            var convs = await _get(
                'conversations?select=*,listing:listings(id,title,images)' +
                '&or=(host_id.eq.' + _user.id + ',user_id.eq.' + _user.id + ')' +
                '&order=updated_at.desc'
            );

            // Hide archived conversations where user is the guest side (unless showing archived)
            if (!_showArchived) {
                convs = convs.filter(function (c) {
                    return c.host_id === _user.id || !c.user_archived;
                });
            }

            // Cache the "other party" profile for each conversation
            var ids = convs.map(function (c) {
                return c.host_id === _user.id ? c.user_id : c.host_id;
            });
            await _cacheProfiles(ids);

            _renderList(convs);

            // Badge: sum unread from the correct side of each conversation
            var total = convs.reduce(function (s, c) {
                return s + (c.host_id === _user.id ? (c.unread_host || 0) : (c.unread_user || 0));
            }, 0);
            var badge = document.getElementById('msg-nav-badge');
            if (badge) {
                badge.textContent = total > 99 ? '99+' : total;
                badge.style.display = total > 0 ? '' : 'none';
            }
        } catch (err) {
            el.innerHTML = '<div class="msg-empty">Could not load messages.</div>';
            console.error('[Messaging]', err);
        }
    }

    function _renderList(convs) {
        var el = document.getElementById('msg-conv-list');
        if (!el) return;

        var toggle = document.getElementById('msg-archive-toggle');
        if (toggle) toggle.style.display = '';

        if (!convs.length) {
            el.innerHTML = '<div class="msg-empty">' +
                '<p>No messages yet.</p>' +
                '<p style="font-size:.8rem;margin-top:6px">A conversation thread is created automatically when a booking request is submitted.</p>' +
                '</div>';
            return;
        }

        el.innerHTML = convs.map(function (c) {
            var isHostInConv = c.host_id === _user.id;
            var otherName = _profileCache[isHostInConv ? c.user_id : c.host_id] || (isHostInConv ? 'Guest' : 'Host');
            var listing   = c.listing || {};
            var img       = (listing.images || [])[0] || 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=200&q=80';
            var preview   = c.last_message_body || 'No messages yet';
            var unread    = isHostInConv ? (c.unread_host || 0) : (c.unread_user || 0);
            var locked    = c.is_locked;
            var archived  = c.user_archived;

            return '<div class="msg-conv-item' + (locked ? ' locked' : '') + '" onclick="Messaging.openConversation(\'' + c.id + '\')">' +
                '<img class="msg-conv-thumb" src="' + _esc(img) + '" alt="" loading="lazy">' +
                '<div class="msg-conv-body">' +
                    '<div class="msg-conv-row">' +
                        '<span class="msg-conv-name">' + _esc(otherName) + '</span>' +
                        '<span class="msg-conv-time">' + _fmtTime(c.last_message_at || c.updated_at) + '</span>' +
                    '</div>' +
                    '<div class="msg-conv-prop">' + _esc(listing.title || '—') + '</div>' +
                    '<div class="msg-conv-preview">' + (locked ? '🔒 ' : '') + _esc(preview.slice(0, 70)) + (preview.length > 70 ? '…' : '') + '</div>' +
                '</div>' +
                '<div class="msg-conv-actions">' +
                    (unread > 0 ? '<span class="msg-unread-count">' + unread + '</span>' : '') +
                    (!isHostInConv ? '<button class="msg-archive-btn" onclick="event.stopPropagation();Messaging.' + (archived ? 'un' : '') + 'archiveConversation(\'' + c.id + '\')" title="' + (archived ? 'Unarchive' : 'Archive') + '">' + (archived ? '↩' : '⊘') + '</button>' : '') +
                '</div>' +
            '</div>';
        }).join('');
    }

    // ── Thread ───────────────────────────────────────────────

    async function openConversation(convId) {
        _convId = convId;
        _show('msg-thread-view');
        _hide('msg-list-view');

        try {
            var convs = await _get('conversations?id=eq.' + convId + '&select=*,listing:listings(id,title,images,community)');
            var conv  = convs[0];
            if (!conv) return;

            _convLocked  = conv.is_locked;
            _convIsHost  = conv.host_id === _user.id; // per-conversation, not per-role

            await _cacheProfiles([_convIsHost ? conv.user_id : conv.host_id]);
            _otherName = _profileCache[_convIsHost ? conv.user_id : conv.host_id] || (_convIsHost ? 'Guest' : 'Host');

            // Booking details
            var bookings = await _get('bookings?id=eq.' + conv.booking_id + '&select=start_date,end_date,status');
            var booking  = bookings[0] || {};

            // Update header
            var listing = conv.listing || {};
            _setText('msg-t-title', listing.title || '—');
            _setText('msg-t-sub', 'With ' + _otherName + (booking.start_date
                ? '  ·  ' + _fmtDate(booking.start_date) + ' → ' + _fmtDate(booking.end_date)
                : ''));

            var badge = document.getElementById('msg-t-badge');
            if (badge) {
                badge.textContent = booking.status || '';
                badge.className   = 'badge ' + (booking.status || '');
            }

            // Locked state
            if (conv.is_locked) {
                _show('msg-locked-bar');
                _hide('msg-composer');
            } else {
                _hide('msg-locked-bar');
                _show('msg-composer');
            }

            await _loadMessages();
            await _markRead();
            _startThreadPolling();
        } catch (err) {
            console.error('[Messaging] openConversation', err);
        }
    }

    async function _loadMessages() {
        var el = document.getElementById('msg-bubbles');
        if (!el || !_convId) return;
        try {
            var msgs = await _get('messages?conversation_id=eq.' + _convId + '&select=*&order=created_at.asc');
            _renderMessages(msgs);
        } catch (err) {
            console.error('[Messaging] _loadMessages', err);
        }
    }

    function _renderMessages(msgs) {
        var el = document.getElementById('msg-bubbles');
        if (!el) return;
        var myId = _user.id;
        var foundUnread = false;

        if (!msgs.length) {
            el.innerHTML = '<div class="msg-empty" style="flex:1"><p>No messages yet.</p><p style="font-size:.8rem;margin-top:4px">Send the first message!</p></div>';
            return;
        }

        el.innerHTML = msgs.map(function (m) {
            var isMine  = m.sender_id === myId;
            var first   = (isMine ? (_user.fullName || 'You') : _otherName).split(' ')[0];
            var unreadSep = '';

            if (!isMine && !m.is_read && !foundUnread) {
                foundUnread = true;
                unreadSep = '<div class="msg-unread-sep">New messages</div>';
            }

            return unreadSep +
                '<div class="msg-bubble ' + (isMine ? 'mine' : 'theirs') + '">' +
                    '<div class="msg-bubble-sender">' + _esc(first) + ' · ' + _fmtTime(m.created_at) + '</div>' +
                    '<div class="msg-bubble-text">' + _escAndLinkify(m.body) + '</div>' +
                '</div>';
        }).join('');

        el.scrollTop = el.scrollHeight;
    }

    async function sendMessage() {
        if (_convLocked) return;
        var input = document.getElementById('msg-input');
        var btn   = document.getElementById('msg-send-btn');
        var body  = input ? input.value.trim() : '';
        if (!body || !_convId) return;

        if (btn) btn.disabled = true;
        try {
            await _post('messages', {
                conversation_id: _convId,
                sender_id: _user.id,
                body: body,
            });
            if (input) { input.value = ''; input.style.height = 'auto'; }
            await _loadMessages();
        } catch (err) {
            console.error('[Messaging] sendMessage', err);
        }
        if (btn) btn.disabled = false;
    }

    async function _markRead() {
        if (!_convId) return;
        try {
            await _patch(
                'messages?conversation_id=eq.' + _convId + '&sender_id=neq.' + _user.id + '&is_read=eq.false',
                { is_read: true }
            );
            var payload = {};
            payload[_convIsHost ? 'unread_host' : 'unread_user'] = 0;
            await _patch('conversations?id=eq.' + _convId, payload);
        } catch (_) { /* best effort */ }
    }

    function closeThread() {
        _stopThreadPolling();
        _convId = null;
        _hide('msg-thread-view');
        _show('msg-list-view');
        loadConversations();
    }

    // ── Archive ──────────────────────────────────────────────

    async function archiveConversation(convId) {
        try {
            await _patch('conversations?id=eq.' + convId, { user_archived: true });
            await loadConversations();
        } catch (err) { console.error('[Messaging] archive', err); }
    }

    async function unarchiveConversation(convId) {
        try {
            await _patch('conversations?id=eq.' + convId, { user_archived: false });
            await loadConversations();
        } catch (err) { console.error('[Messaging] unarchive', err); }
    }

    function toggleArchived() {
        _showArchived = !_showArchived;
        var btn = document.getElementById('msg-archive-toggle');
        if (btn) btn.textContent = _showArchived ? 'Hide Archived' : 'Show Archived';
        loadConversations();
    }

    // ── Polling ──────────────────────────────────────────────

    function _startBadgePolling() {
        clearInterval(_badgeTimer);
        _badgeTimer = setInterval(loadConversations, 30000);
    }

    function _startThreadPolling() {
        clearInterval(_threadTimer);
        _threadTimer = setInterval(function () {
            _loadMessages();
            _markRead();
        }, 5000);
    }

    function _stopThreadPolling() {
        clearInterval(_threadTimer);
        _threadTimer = null;
    }

    // ── DOM helpers ──────────────────────────────────────────

    function _show(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = '';
    }
    function _hide(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }
    function _setText(id, txt) {
        var el = document.getElementById(id);
        if (el) el.textContent = txt;
    }

    // ── Textarea auto-resize + enter-to-send ─────────────────

    function _initInput() {
        var input = document.getElementById('msg-input');
        if (!input) return;
        input.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                window.Messaging && window.Messaging.sendMessage();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', _initInput);

    // ── Public API ───────────────────────────────────────────

    window.Messaging = {
        init: init,
        loadConversations: loadConversations,
        openConversation: openConversation,
        closeThread: closeThread,
        sendMessage: sendMessage,
        archiveConversation: archiveConversation,
        unarchiveConversation: unarchiveConversation,
        toggleArchived: toggleArchived,
    };

})();
