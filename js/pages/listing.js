// ============================================================
// js/pages/listing.js — Listing Detail Page
// ES module
// ============================================================
import { Auth } from '../lib/auth.js';
import { ListingsAPI } from '../lib/api.js';
import { SavedAPI } from '../api/saved.js';
import { AvailabilityAPI } from '../api/availability.js';
import { BookingsAPI } from '../api/bookings.js';
import { ConversationsAPI } from '../api/conversations.js';
import { esc, fmt, clImg, fmtAvailDate, toCalYMD, showToast } from '../lib/utils.js';
import { initNav } from '../components/nav.js';

'use strict';

let _listing     = null;
let _savedIds    = new Set();
let _currentUser = null;

// ── Saved listings ────────────────────────────────────────────────────────────

async function loadSavedIds() {
  try {
    _savedIds = await SavedAPI.getIds();
  } catch (_) {}
}

async function toggleSaved() {
  const session = await Auth.getSession();
  if (!session) {
    if (_listing) sessionStorage.setItem('pendingSaveListing', _listing.id);
    window.location.href = 'login.html';
    return;
  }
  if (!_listing) return;
  const isSaved = _savedIds.has(_listing.id);
  try {
    if (isSaved) {
      await SavedAPI.remove(_listing.id);
      _savedIds.delete(_listing.id);
    } else {
      await SavedAPI.save(_listing.id);
      _savedIds.add(_listing.id);
    }
    updateHeartButtons();
    showToast(isSaved ? 'Removed from saved' : 'Saved to favourites ♥');
  } catch (_) { showToast('Could not update saved listing', 'error'); }
}

function updateHeartButtons() {
  if (!_listing) return;
  const saved = _savedIds.has(_listing.id);
  ['lp-heart-btn', 'fn-heart'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('saved', saved);
    const icon = btn.querySelector('svg, i');
    if (icon && icon.tagName === 'I') icon.style.fill = saved ? 'currentColor' : '';
    else if (icon)                    icon.style.fill = saved ? 'currentColor' : 'none';
  });
  const sheetSave = document.getElementById('fn-sheet-save');
  if (sheetSave) sheetSave.textContent = saved ? '♥ Unsave Listing' : '♡ Save Listing';
}

// ── Share ─────────────────────────────────────────────────────────────────────

function shareListing() {
  if (!_listing) return;
  const url  = window.location.origin + '/pages/listing.html?id=' + encodeURIComponent(_listing.id);
  const data = { title: _listing.title, text: _listing.title + ' — Ecovilla Rentals', url };
  if (navigator.share && /mobile|android|iphone|ipad/i.test(navigator.userAgent)) {
    navigator.share(data).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(() => showToast('Link copied — ready to share!'))
      .catch(() => showToast('Copy this link: ' + url));
  }
}

// ── Gallery ───────────────────────────────────────────────────────────────────

function buildGallery(imgs) {
  const count = imgs.length;
  if (!count) return '';

  let mobileHTML = '<div class="mobile-gallery"><div class="mobile-gallery-track" id="mob-gallery-track">';
  for (let m = 0; m < count; m++) {
    mobileHTML += `<img src="${esc(clImg(imgs[m], 800))}" class="mobile-gallery-img"${m > 0 ? ' loading="lazy"' : ''} alt="" data-index="${m}">`;
  }
  mobileHTML += '</div>';
  if (count > 1) {
    mobileHTML += '<div class="mobile-gallery-dots" id="mob-gallery-dots">';
    for (let d = 0; d < Math.min(count, 10); d++) {
      mobileHTML += `<span class="mob-dot${d === 0 ? ' active' : ''}"></span>`;
    }
    mobileHTML += '</div>';
  }
  mobileHTML += '</div>';

  const visible = Math.min(count, 5);
  let desktopHTML = `<div class="photo-mosaic photo-mosaic-${visible}">`;
  for (let i = 0; i < visible; i++) {
    desktopHTML += `<div class="mosaic-cell${i === 0 ? ' mosaic-main' : ''}">`;
    desktopHTML += `<img src="${esc(clImg(imgs[i], i === 0 ? 1200 : 700))}" class="mosaic-img" alt=""${i > 0 ? ' loading="lazy"' : ''} onclick="openLightbox(${i})">`;
    if (i === visible - 1 && count > visible) {
      desktopHTML += `<button class="mosaic-show-all" onclick="event.stopPropagation();openLightbox(${i})">Show all ${count} photos</button>`;
    }
    desktopHTML += '</div>';
  }
  desktopHTML += '</div>';
  return mobileHTML + desktopHTML;
}

function initMobileCarousel() {
  const track = document.getElementById('mob-gallery-track');
  if (!track) return;
  let _touchStartX = 0, _swiped = false;
  track.addEventListener('touchstart', e => { _touchStartX = e.touches[0].clientX; _swiped = false; }, { passive: true });
  track.addEventListener('touchmove', e => { if (Math.abs(e.touches[0].clientX - _touchStartX) > 8) _swiped = true; }, { passive: true });
  track.addEventListener('click', () => { if (!_swiped) openLightbox(Math.round(track.scrollLeft / track.offsetWidth)); });
  const dots = document.querySelectorAll('#mob-gallery-dots .mob-dot');
  if (dots.length) {
    track.addEventListener('scroll', () => {
      const idx = Math.round(track.scrollLeft / track.offsetWidth);
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    }, { passive: true });
  }
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

let _lbImgs = [], _lbIdx = 0, _lbTouchX = 0;

function openLightbox(idx) {
  if (!_listing?.images?.length) return;
  _lbImgs = _listing.images;
  _lbIdx  = idx || 0;
  const lb = _getLightbox();
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  _updateLightbox();
}

function _getLightbox() {
  const lb = document.getElementById('photo-lightbox');
  if (lb?.dataset.ready) return lb;
  lb.dataset.ready = '1';
  lb.className = 'photo-lightbox';
  lb.innerHTML =
    '<div class="lightbox-header"><span class="lightbox-counter" id="lightbox-counter"></span><button class="lightbox-close" aria-label="Close" onclick="closeLightbox()">&#215;</button></div>' +
    '<div class="lightbox-body"><button class="lightbox-nav prev" aria-label="Previous" onclick="lightboxStep(-1)">&#8249;</button><div class="lightbox-img-wrap"><img id="lightbox-img" class="lightbox-img" alt=""></div><button class="lightbox-nav next" aria-label="Next" onclick="lightboxStep(1)">&#8250;</button></div>';
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape')      closeLightbox();
    if (e.key === 'ArrowLeft')   lightboxStep(-1);
    if (e.key === 'ArrowRight')  lightboxStep(1);
  });
  lb.addEventListener('touchstart', e => { _lbTouchX = e.changedTouches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - _lbTouchX; if (Math.abs(dx) > 50) lightboxStep(dx < 0 ? 1 : -1); });
  return lb;
}

function _updateLightbox() {
  const img     = document.getElementById('lightbox-img');
  const counter = document.getElementById('lightbox-counter');
  const lb      = document.getElementById('photo-lightbox');
  if (img)     img.src = clImg(_lbImgs[_lbIdx], 1400);
  if (counter) counter.textContent = `${_lbIdx + 1} / ${_lbImgs.length}`;
  if (lb) {
    const prev = lb.querySelector('.lightbox-nav.prev');
    const next = lb.querySelector('.lightbox-nav.next');
    if (prev) prev.style.visibility = _lbIdx === 0 ? 'hidden' : '';
    if (next) next.style.visibility = _lbIdx === _lbImgs.length - 1 ? 'hidden' : '';
  }
}

function lightboxStep(dir) {
  _lbIdx = Math.max(0, Math.min(_lbImgs.length - 1, _lbIdx + dir));
  _updateLightbox();
}

function closeLightbox() {
  document.getElementById('photo-lightbox')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Availability Calendar ─────────────────────────────────────────────────────

const calState = {
  listingId: null, minStay: 1, availWindows: [], bookedRanges: [], blockedRanges: [],
  checkIn: null, checkOut: null,
  viewYear: new Date().getFullYear(), viewMonth: new Date().getMonth(),
};

function toggleAvailability() {
  const wrap = document.getElementById('availability-calendar-wrap');
  const btn  = document.getElementById('check-availability-btn');
  if (!wrap) return;
  const isOpen = wrap.style.display !== 'none';
  if (isOpen) {
    wrap.style.display = 'none';
    if (btn) { btn.innerHTML = '<i data-lucide="calendar" width="15" height="15" style="margin-right:6px"></i>Check Availability'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  } else {
    wrap.style.display = 'block';
    if (btn) { btn.innerHTML = '<i data-lucide="calendar-x" width="15" height="15" style="margin-right:6px"></i>Hide Availability'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    if (calState.listingId !== _listing.id) loadPublicAvailability(_listing.id);
    setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
  }
}

async function loadPublicAvailability(listingId) {
  const wrap = document.getElementById('availability-calendar-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<p style="color:var(--stone);font-size:.875rem;padding:16px 0">Loading availability…</p>';
  try {
    const { windows, booked, blocked } = await AvailabilityAPI.getForListing(listingId);
    const now = new Date();
    calState.listingId = listingId;
    const dbMin = _listing?.minStayNights || 1;
    calState.minStay = _listing?.community === 'la-ecovilla' ? Math.max(dbMin, 7) : dbMin;
    calState.availWindows = windows; calState.bookedRanges = booked; calState.blockedRanges = blocked;
    calState.checkIn = null; calState.checkOut = null;
    calState.viewYear = now.getFullYear(); calState.viewMonth = now.getMonth();
    renderCalendar();
  } catch (_) {
    const w = document.getElementById('availability-calendar-wrap');
    if (w) w.innerHTML = '<p style="color:#b34a4a;font-size:.875rem;padding:16px 0">Could not load availability.</p>';
  }
}

function renderCalendar() {
  const wrap = document.getElementById('availability-calendar-wrap');
  if (!wrap) return;
  if (!calState.availWindows.length) {
    wrap.innerHTML = '<p style="color:var(--stone);font-size:.875rem;padding:16px 0;text-align:center">No availability windows set for this listing yet.</p>';
    return;
  }
  const { viewYear: year, viewMonth: month } = calState;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  let html = '<div class="cal-wrap">';
  if (calState.minStay > 1) html += `<p style="font-size:.78rem;color:var(--stone);margin-bottom:10px;text-align:center">⏱ Minimum stay: ${calState.minStay} night${calState.minStay !== 1 ? 's' : ''}</p>`;
  html += `<div class="cal-header"><button class="cal-nav" onclick="calPrev()"${canGoPrev() ? '' : ' disabled'}>&#8249;</button><span class="cal-month-label">${monthNames[month]} ${year}</span><button class="cal-nav" onclick="calNext()">&#8250;</button></div><div class="cal-grid">`;
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => { html += `<div class="cal-day-name">${d}</div>`; });
  const first       = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today       = toCalYMD(new Date());
  for (let i = 0; i < first; i++) html += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const date  = new Date(year, month, d);
    const ymd   = toCalYMD(date);
    const state = getDayState(date, ymd, today);
    const clickable = ['available','checkout-only','checkin'].includes(state);
    html += `<div class="cal-day ${state}"${clickable ? ` onclick="calSelectDay('${ymd}')"` : ''}>${d}</div>`;
  }
  html += '</div>';
  if (calState.checkIn) {
    html += '<div class="cal-selection">';
    html += `<div class="cal-sel-item"><span>CHECK-IN</span><strong>${fmtAvailDate(calState.checkIn)}</strong></div>`;
    if (calState.checkOut) {
      const nights      = Math.round((new Date(calState.checkOut) - new Date(calState.checkIn)) / 86400000);
      const rate        = _listing?.priceNightly;
      const monthly     = _listing?.priceMonthly;
      const cleaning    = _listing?.cleaningFee || 0;
      // Calendar-based monthly pricing: step forward by real calendar months from
      // check-in, then bill leftover days at nightly rate. Leftover ≥ 27 days rounds
      // up to the next month (e.g. Jan 1 → Feb 28 = 1 month + 27 days → 2 months).
      let months = 0, leftover = nights;
      if (nights >= 28 && monthly) {
        let _d = new Date(calState.checkIn);
        const _end = new Date(calState.checkOut);
        while (true) {
          const _next = new Date(_d);
          _next.setMonth(_next.getMonth() + 1);
          if (_next <= _end) { months++; _d = _next; } else { break; }
        }
        leftover = Math.round((_end - _d) / 86400000);
        if (leftover >= 27) { months++; leftover = 0; }
      }

      const fmt = n => '$' + Number(n).toLocaleString();
      let nightlyTotal = null;
      let baseRow = '';

      if (months > 0 && monthly) {
        const leftoverRate = rate || Math.round(monthly / 30);
        const leftoverCost = leftover > 0 ? leftoverRate * leftover : 0;
        nightlyTotal = months * monthly + leftoverCost;
        baseRow = `<div class="cal-fee-row"><span>${months} month${months !== 1 ? 's' : ''} · ${fmt(monthly)}/mo</span><span>${fmt(months * monthly)}</span></div>`;
        if (leftover > 0) baseRow += `<div class="cal-fee-row"><span>${leftover} extra night${leftover !== 1 ? 's' : ''} × ${fmt(leftoverRate)}</span><span>${fmt(leftoverCost)}</span></div>`;
      } else if (rate) {
        nightlyTotal = rate * nights;
        baseRow = `<div class="cal-fee-row"><span>${nights} night${nights !== 1 ? 's' : ''} × ${fmt(rate)}</span><span>${fmt(nightlyTotal)}</span></div>`;
      } else if (monthly) {
        nightlyTotal = Math.round(monthly * nights / 30);
        baseRow = `<div class="cal-fee-row"><span>${nights} nights · ${fmt(monthly)}/mo</span><span>${fmt(nightlyTotal)}</span></div>`;
      }

      const communityFee = nightlyTotal != null ? Math.round((nightlyTotal + cleaning) * 0.02) : null;
      const platformFee  = nightlyTotal != null ? Math.round((nightlyTotal + cleaning) * 0.03) : null;
      const grandTotal   = nightlyTotal != null ? nightlyTotal + cleaning + communityFee + platformFee : null;
      html += `<div class="cal-sel-item"><span>CHECK-OUT</span><strong>${fmtAvailDate(calState.checkOut)}</strong></div>`;
      html += '</div>';
      if (grandTotal != null) {
        html += `<div class="cal-fee-breakdown">
          <div class="cal-fee-row cal-fee-duration"><span>Duration</span><strong>${nights} night${nights !== 1 ? 's' : ''}</strong></div>
          ${baseRow}
          ${cleaning ? `<div class="cal-fee-row"><span>Cleaning fee</span><span>$${Number(cleaning).toLocaleString()}</span></div>` : ''}
          <div class="cal-fee-row"><span>Community give back (2%)</span><span>$${Number(communityFee).toLocaleString()}</span></div>
          <div class="cal-fee-row"><span>Ecovilla Rentals platform fee (3%)</span><span>$${Number(platformFee).toLocaleString()}</span></div>
          <div class="cal-fee-row cal-fee-total"><span>Total</span><strong>$${Number(grandTotal).toLocaleString()} USD</strong></div>
        </div>`;
      }
      html += `<textarea id="booking-message" placeholder="Message to host (optional)" style="width:100%;margin:12px 0 8px;padding:10px;border:1px solid var(--parchment);border-radius:8px;font-family:inherit;font-size:.85rem;resize:vertical;min-height:70px"></textarea>`;
      html += '<button onclick="submitBookingRequest()" style="width:100%;padding:14px;border-radius:12px;font-size:.95rem;font-weight:600;background:var(--clay);color:white;border:none;cursor:pointer;font-family:inherit">Request Booking</button>';
    } else {
      html += '<div class="cal-sel-item"><span>CHECK-OUT</span><strong style="color:var(--stone)">Select a date</strong></div></div>';
    }
  }
  html += '</div>';
  wrap.innerHTML = html;
}

function getDayState(date, ymd, today) {
  if (ymd < today) return 'past';
  if (calState.checkIn  && ymd === calState.checkIn)  return 'checkin';
  if (calState.checkOut && ymd === calState.checkOut) return 'checkout';
  if (calState.checkIn && calState.checkOut && ymd > calState.checkIn && ymd < calState.checkOut) return 'inrange';
  if (calState.bookedRanges.some(b  => ymd >= b.start_date && ymd < b.end_date)) return 'booked';
  if (calState.blockedRanges.some(b => ymd >= b.start_date && ymd < b.end_date)) return 'booked';
  if (calState.bookedRanges.some(b  => ymd === b.end_date))  return 'checkout-only';
  if (!calState.availWindows.some(w => ymd >= w.start_date && ymd < w.end_date)) return 'unavailable';
  if (calState.checkIn && !calState.checkOut) {
    const diff = Math.round((date - new Date(calState.checkIn)) / 86400000);
    if (diff > 0 && diff < calState.minStay) return 'minstay';
  }
  return 'available';
}

function canGoPrev() { const now = new Date(); return !(calState.viewYear === now.getFullYear() && calState.viewMonth === now.getMonth()); }
function calPrev() { if (!canGoPrev()) return; if (calState.viewMonth === 0) { calState.viewMonth = 11; calState.viewYear--; } else calState.viewMonth--; renderCalendar(); }
function calNext() { if (calState.viewMonth === 11) { calState.viewMonth = 0; calState.viewYear++; } else calState.viewMonth++; renderCalendar(); }

function calSelectDay(ymd) {
  if (!calState.checkIn || (calState.checkIn && calState.checkOut)) { calState.checkIn = ymd; calState.checkOut = null; renderCalendar(); return; }
  if (ymd <= calState.checkIn) { calState.checkIn = ymd; calState.checkOut = null; renderCalendar(); return; }
  let valid = true;
  const cursor = new Date(calState.checkIn); cursor.setDate(cursor.getDate() + 1);
  while (toCalYMD(cursor) < ymd) {
    const cymd = toCalYMD(cursor);
    if (calState.bookedRanges.some(b => cymd >= b.start_date && cymd < b.end_date) || !calState.availWindows.some(w => cymd >= w.start_date && cymd < w.end_date)) { valid = false; break; }
    cursor.setDate(cursor.getDate() + 1);
  }
  calState.checkOut = valid ? ymd : null;
  if (!valid) calState.checkIn = ymd;
  renderCalendar();
}

async function submitBookingRequest() {
  if (_listing && _currentUser && _listing.ownerId === _currentUser.id) { showToast('You cannot book your own listing.', 'error'); return; }
  const session = await Auth.getSession();
  if (!session) {
    sessionStorage.setItem('pendingBooking', JSON.stringify({ listingId: calState.listingId, checkIn: calState.checkIn, checkOut: calState.checkOut }));
    window.location.href = 'login.html';
    return;
  }
  const msgEl   = document.getElementById('booking-message');
  const message = msgEl?.value.trim() || '';
  const submitBtn = document.querySelector('button[onclick="submitBookingRequest()"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }
  try {
    const booking = await BookingsAPI.create({
      listingId: calState.listingId,
      checkIn:   calState.checkIn,
      checkOut:  calState.checkOut,
      message:   message || null,
    });
    const hostId = await BookingsAPI.getHostId(calState.listingId);
    if (hostId && booking) {
      const convId = await ConversationsAPI.findOrCreate(calState.listingId, hostId, booking.id);
      if (convId && message) await ConversationsAPI.sendMessage(convId, message);
    }
    const wrap = document.getElementById('availability-calendar-wrap');
    if (wrap) wrap.innerHTML = `<div style="text-align:center;padding:28px 16px"><div style="font-size:2.5rem;margin-bottom:12px">🌿</div><h3 style="font-family:var(--font-display,serif);font-size:1.4rem;margin-bottom:8px">Request Sent!</h3><p style="color:var(--stone);font-size:.875rem;line-height:1.6">Your booking request for <strong>${fmtAvailDate(calState.checkIn)} → ${fmtAvailDate(calState.checkOut)}</strong> has been sent to the host. You'll receive a response shortly.</p></div>`;
  } catch (err) {
    showToast('Could not send booking request. Please try again.', 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Request Booking'; }
  }
}

// ── Render listing page ───────────────────────────────────────────────────────

const COMMUNITY_NAMES = { 'la-ecovilla': 'La Ecovilla (LEV)', 'san-mateo': 'Ecovilla San Mateo (ESM)', 'alegria-village': 'Alegría Village', 'tacotal': 'Tacotal' };
const communityName = id => COMMUNITY_NAMES[id] || id;

function renderListing(listing) {
  const isSale = listing.listingType === 'sale';
  document.title = listing.title + ' | Ecovilla Rentals';

  const imgs = listing.images.filter(Boolean);
  if (!imgs.length) imgs.push('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80');
  document.getElementById('lp-gallery').innerHTML = buildGallery(imgs);
  initMobileCarousel();

  if (listing.featured) document.getElementById('lp-cert-badge').innerHTML = '<span class="badge badge-featured" style="margin-bottom:8px;display:inline-flex"><i data-lucide="star" width="10" height="10" style="fill:currentColor;margin-right:3px"></i>Certified</span>';
  document.getElementById('lp-title').textContent = listing.title;

  const specs = [
    { icon: 'map-pin',    label: communityName(listing.community) },
    { icon: 'bed-double', label: listing.bedrooms  + ' bed'  + (listing.bedrooms  !== 1 ? 's' : '') },
    { icon: 'bath',       label: listing.bathrooms + ' bath' + (listing.bathrooms !== 1 ? 's' : '') },
    listing.type      ? { icon: 'home',      label: listing.type } : null,
    listing.maxGuests ? { icon: 'users',     label: listing.maxGuests + ' guest' + (listing.maxGuests !== 1 ? 's' : '') } : null,
    listing.petsAllowed ? { icon: 'paw-print', label: 'Pets welcome' } : null,
  ].filter(Boolean);
  document.getElementById('lp-specs').innerHTML = specs.map(s => `<span class="detail-spec"><i data-lucide="${s.icon}" width="14" height="14"></i> ${esc(s.label)}</span>`).join('');

  const statusHTML = isSale
    ? '<span class="status-pill status-available" style="display:inline-block;margin-bottom:8px">For Sale</span>'
    : listing.status === 'active'
      ? '<span class="status-pill status-available" style="display:inline-block;margin-bottom:8px">Available</span>'
      : '<span class="status-pill status-unavailable" style="display:inline-block;margin-bottom:8px">Currently Unavailable</span>';
  document.getElementById('lp-status-badge').innerHTML = statusHTML;

  let pricingHTML = '';
  if (isSale) {
    pricingHTML = `<div class="detail-pricing"><div class="price-item"><label>Asking Price</label><div class="value">${listing.salePrice ? fmt(listing.salePrice) : '<span style="color:var(--clay);font-style:italic">Price on request</span>'}</div></div></div>`;
  } else if (listing.priceMonthly || listing.priceNightly) {
    pricingHTML = '<div class="detail-pricing">' +
      (listing.priceNightly ? `<div class="price-item"><label>Per night</label><div class="value">${fmt(listing.priceNightly)}</div></div>` : '') +
      (listing.priceMonthly ? `<div class="price-item"><label>Per month</label><div class="value">${fmt(listing.priceMonthly)}</div></div>` : '') +
      (listing.cleaningFee   ? `<div class="price-item"><label>Cleaning fee</label><div class="value">${fmt(listing.cleaningFee)}</div></div>` : '') +
      '</div>';
  } else {
    pricingHTML = '<div class="detail-pricing"><div class="price-item" style="grid-column:1/-1"><label>Pricing</label><div class="value" style="color:var(--clay);font-style:italic">Price on application</div></div></div>';
  }
  document.getElementById('lp-pricing').innerHTML = pricingHTML;

  if (listing.description) document.getElementById('lp-description').innerHTML = `<p class="detail-description" style="margin-top:20px">${esc(listing.description)}</p>`;

  if (listing.amenities?.length) {
    document.getElementById('lp-amenities').innerHTML =
      '<div style="margin-top:24px"><div class="label-sm" style="color:var(--stone);margin-bottom:14px">Amenities & Features</div>' +
      `<div class="amenity-grid">${listing.amenities.map(a => `<div class="amenity-item"><i data-lucide="check" width="14" height="14"></i>${esc(a)}</div>`).join('')}</div></div>`;
  }

  if (!isSale) {
    document.getElementById('lp-avail-section').innerHTML =
      '<div style="margin-top:28px;margin-bottom:24px"><button class="btn btn-secondary btn-full" id="check-availability-btn" onclick="toggleAvailability()"><i data-lucide="calendar" width="15" height="15" style="margin-right:6px"></i>Check Availability</button><div id="availability-calendar-wrap" style="display:none;margin-top:16px;padding-bottom:40px"></div></div>';
  }

  updateHeartButtons();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Float nav + action buttons ────────────────────────────────────────────────

function initFloatNav() {
  const fnBack  = document.getElementById('fn-back');
  const fnHeart = document.getElementById('fn-heart');
  const fnShare = document.getElementById('fn-share');
  if (fnBack)  fnBack.addEventListener('click', () => { if (history.length > 1) history.back(); else window.location.href = '../index.html'; });
  if (fnHeart) fnHeart.addEventListener('click', toggleSaved);
  if (fnShare) fnShare.addEventListener('click', shareListing);
  const fn = document.getElementById('float-nav');
  if (fn) setTimeout(() => fn.classList.add('fn-visible'), 300);
}

function initActionButtons() {
  document.getElementById('lp-heart-btn')?.addEventListener('click', toggleSaved);
  document.getElementById('lp-share-btn')?.addEventListener('click', shareListing);
  document.getElementById('lp-back-btn')?.addEventListener('click', () => { if (history.length > 1) history.back(); else window.location.href = '../index.html'; });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initNav();
  initActionButtons();
  initFloatNav();

  const params = new URLSearchParams(window.location.search);
  const id     = params.get('id');
  if (!id) { showError('No listing specified.'); return; }

  const userPromise    = Auth.getUser().then(u => { _currentUser = u || null; }).catch(() => {});
  const savedPromise   = loadSavedIds();
  const listingPromise = ListingsAPI.getById(id);

  try {
    _listing = await listingPromise;
    await Promise.all([userPromise, savedPromise]);

    if (_currentUser) {
      const loginBtn = document.getElementById('hdr-login-btn');
      if (loginBtn) {
        loginBtn.textContent = 'Dashboard';
        loginBtn.href = _currentUser.role === 'user' ? 'user.html' : _currentUser.role === 'host' ? 'host.html' : 'admin.html';
      }
    }

    renderListing(_listing);
    document.getElementById('auth-loading').style.display = 'none';
    document.getElementById('lp-main').style.display      = 'block';

    const pending  = sessionStorage.getItem('pendingBooking');
    const redirect = params.get('redirect');
    if (pending && redirect === 'booking') {
      try {
        const pb = JSON.parse(pending);
        if (pb.listingId === id) {
          sessionStorage.removeItem('pendingBooking');
          toggleAvailability();
          setTimeout(() => {
            loadPublicAvailability(id).then(() => { calState.checkIn = pb.checkIn; calState.checkOut = pb.checkOut; renderCalendar(); });
          }, 400);
        }
      } catch (_) {}
    }

    const pendingSave = sessionStorage.getItem('pendingSaveListing');
    if (pendingSave === id) {
      sessionStorage.removeItem('pendingSaveListing');
      await toggleSaved();
      window.location.href = 'user.html?panel=saved';
    }
  } catch (_) { showError('Listing not found'); }
});

function showError(msg) {
  document.getElementById('auth-loading').style.display = 'none';
  document.getElementById('lp-main').style.display      = 'block';
  document.querySelector('.lp-layout').innerHTML =
    `<div style="text-align:center;padding:80px 24px"><div style="font-size:3rem;margin-bottom:16px">🌿</div><h2 style="font-family:var(--font-display,serif);margin-bottom:12px">${esc(msg)}</h2><a href="../index.html" class="btn btn-primary">Browse all listings</a></div>`;
}

// ── Window globals for HTML onclick handlers ─────────────────────────────────
Object.assign(window, { openLightbox, lightboxStep, closeLightbox, toggleAvailability, calPrev, calNext, calSelectDay, submitBookingRequest });
