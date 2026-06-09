/* ─── Ecovilla Rentals – Listing Detail Page ────────────────── */
'use strict';

var _ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d21kZ2VsZmxzdG5xZmdzbHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTQxODIsImV4cCI6MjA5NDk3MDE4Mn0.7SAsWpGvYDV-aRaHagt_tBFiSkbNL-Vuc3gHLSs8o9E';
var _BASE = 'https://wywmdgelflstnqfgslqw.supabase.co/rest/v1';

var _listing = null;
var _savedIds = new Set();
var _currentUser = null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"']/g, function(m) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
  });
}

function fmt(n) { return n ? '$' + Number(n).toLocaleString() : null; }

function clImg(url, w) {
  if (!url) return '';
  if (!url.includes('res.cloudinary.com')) return url;
  return url.replace('/upload/', '/upload/q_auto,f_auto,w_' + w + '/');
}

var COMMUNITY_NAMES = {
  'la-ecovilla': 'La Ecovilla (LEV)',
  'san-mateo':   'Ecovilla San Mateo (ESM)',
  'alegria-village': 'Alegría Village',
  'tacotal': 'Tacotal'
};
function communityName(id) { return COMMUNITY_NAMES[id] || id; }

function fmtAvailDate(str) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var parts = str.split('-');
  return months[parseInt(parts[1]) - 1] + ' ' + parseInt(parts[2]) + ', ' + parts[0];
}

function toCalYMD(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function showToast(msg, type) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--charcoal);color:white;padding:10px 20px;border-radius:50px;font-size:.85rem;z-index:9000;white-space:nowrap;box-shadow:var(--shadow-md);transition:opacity .3s ease';
  if (type === 'error') t.style.background = '#b34a4a';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 300); }, 2500);
}

// ── Fetch listing from Supabase ───────────────────────────────────────────────

async function fetchListing(id) {
  var headers = { apikey: _ANON, Accept: 'application/json' };
  var res = await fetch(_BASE + '/listings?id=eq.' + encodeURIComponent(id) + '&select=*&limit=1', { headers });
  if (!res.ok) throw new Error('Listing not found');
  var rows = await res.json();
  if (!rows.length) throw new Error('Listing not found');
  var row = rows[0];
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    community: row.community || '',
    type: row.property_type || 'Other',
    bedrooms: row.bedrooms ?? 0,
    bathrooms: row.bathrooms ?? 0,
    sqft: row.sqft,
    lotSize: row.lot_size,
    pricePerMonth: row.price_monthly,
    pricePerNight: row.price_nightly,
    cleaningFee: row.cleaning_fee,
    deposit: row.deposit,
    salePrice: row.sale_price,
    featured: row.featured,
    available: row.available || false,
    poa: row.poa || false,
    listingType: row.listing_type || 'rental',
    images: row.images || [],
    amenities: row.amenities || [],
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    hostName: row.host_name,
    ownerId: row.owner_id || row.host_id,
    status: row.status,
    maxGuests: row.max_guests,
    petsAllowed: row.pets_allowed,
    petFee: row.pet_fee,
    minStayNights: row.min_stay_nights,
  };
}

// ── Saved listings ────────────────────────────────────────────────────────────

async function loadSavedIds() {
  try {
    var session = await Auth.getSession();
    if (!session) return;
    var res = await fetch(_BASE + '/saved_listings?select=listing_id', {
      headers: { apikey: _ANON, Authorization: 'Bearer ' + session.access_token, Accept: 'application/json' }
    });
    if (!res.ok) return;
    var rows = await res.json();
    _savedIds = new Set(rows.map(function(r) { return r.listing_id; }));
  } catch(e) {}
}

async function toggleSaved() {
  var session = await Auth.getSession();
  if (!session) {
    if (_listing) sessionStorage.setItem('pendingSaveListing', _listing.id);
    window.location.href = 'login.html';
    return;
  }
  if (!_listing) return;
  var token = session.access_token;
  var isSaved = _savedIds.has(_listing.id);
  try {
    if (isSaved) {
      var res = await fetch(_BASE + '/saved_listings?listing_id=eq.' + _listing.id, {
        method: 'DELETE',
        headers: { apikey: _ANON, Authorization: 'Bearer ' + token }
      });
      if (!res.ok) throw new Error();
      _savedIds.delete(_listing.id);
    } else {
      var payload = JSON.parse(atob(token.split('.')[1]));
      var res = await fetch(_BASE + '/saved_listings', {
        method: 'POST',
        headers: { apikey: _ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: payload.sub, listing_id: _listing.id })
      });
      if (!res.ok) throw new Error();
      _savedIds.add(_listing.id);
    }
    updateHeartButtons();
    showToast(isSaved ? 'Removed from saved' : 'Saved to favourites ♥');
  } catch(e) {
    showToast('Could not update saved listing', 'error');
  }
}

function updateHeartButtons() {
  if (!_listing) return;
  var saved = _savedIds.has(_listing.id);
  ['lp-heart-btn', 'fn-heart'].forEach(function(id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('saved', saved);
    var icon = btn.querySelector('svg, i');
    if (icon && icon.tagName === 'I') {
      icon.style.fill = saved ? 'currentColor' : '';
    } else if (icon) {
      icon.style.fill = saved ? 'currentColor' : 'none';
    }
  });
  var sheetSave = document.getElementById('fn-sheet-save');
  if (sheetSave) sheetSave.textContent = saved ? '♥ Unsave Listing' : '♡ Save Listing';
}

// ── Share ─────────────────────────────────────────────────────────────────────

function shareListing() {
  if (!_listing) return;
  var url = window.location.origin + '/listing.html?id=' + encodeURIComponent(_listing.id);
  var data = { title: _listing.title, text: _listing.title + ' — Ecovilla Rentals', url: url };
  if (navigator.share && /mobile|android|iphone|ipad/i.test(navigator.userAgent)) {
    navigator.share(data).catch(function() {});
  } else {
    navigator.clipboard.writeText(url).then(function() {
      showToast('Link copied — ready to share!');
    }).catch(function() {
      showToast('Copy this link: ' + url);
    });
  }
}

// ── Gallery ───────────────────────────────────────────────────────────────────

function buildGallery(imgs) {
  var count = imgs.length;
  if (!count) return '';

  // Mobile: swipeable carousel
  var mobileHTML = '<div class="mobile-gallery"><div class="mobile-gallery-track" id="mob-gallery-track">';
  for (var m = 0; m < count; m++) {
    mobileHTML += '<img src="' + esc(clImg(imgs[m], 800)) + '" class="mobile-gallery-img"' +
      (m > 0 ? ' loading="lazy"' : '') + ' alt="" data-index="' + m + '">';
  }
  mobileHTML += '</div>';
  if (count > 1) {
    mobileHTML += '<div class="mobile-gallery-dots" id="mob-gallery-dots">';
    for (var d = 0; d < Math.min(count, 10); d++) {
      mobileHTML += '<span class="mob-dot' + (d === 0 ? ' active' : '') + '"></span>';
    }
    mobileHTML += '</div>';
  }
  mobileHTML += '</div>';

  // Desktop: mosaic
  var visible = Math.min(count, 5);
  var desktopHTML = '<div class="photo-mosaic photo-mosaic-' + visible + '">';
  for (var i = 0; i < visible; i++) {
    var isFirst = i === 0;
    var isLast = i === visible - 1;
    desktopHTML += '<div class="mosaic-cell' + (isFirst ? ' mosaic-main' : '') + '">';
    desktopHTML += '<img src="' + esc(clImg(imgs[i], i === 0 ? 1200 : 700)) + '" class="mosaic-img" alt=""' +
      (i > 0 ? ' loading="lazy"' : '') + ' onclick="openLightbox(' + i + ')">';
    if (isLast && count > visible) {
      desktopHTML += '<button class="mosaic-show-all" onclick="event.stopPropagation();openLightbox(' + i + ')">Show all ' + count + ' photos</button>';
    }
    desktopHTML += '</div>';
  }
  desktopHTML += '</div>';

  return mobileHTML + desktopHTML;
}

function initMobileCarousel() {
  var track = document.getElementById('mob-gallery-track');
  if (!track) return;
  var _touchStartX = 0, _swiped = false;
  track.addEventListener('touchstart', function(e) {
    _touchStartX = e.touches[0].clientX; _swiped = false;
  }, { passive: true });
  track.addEventListener('touchmove', function(e) {
    if (Math.abs(e.touches[0].clientX - _touchStartX) > 8) _swiped = true;
  }, { passive: true });
  track.addEventListener('click', function() {
    if (_swiped) return;
    var idx = Math.round(track.scrollLeft / track.offsetWidth);
    openLightbox(idx);
  });
  var dots = document.querySelectorAll('#mob-gallery-dots .mob-dot');
  if (dots.length) {
    track.addEventListener('scroll', function() {
      var idx = Math.round(track.scrollLeft / track.offsetWidth);
      dots.forEach(function(d, i) { d.classList.toggle('active', i === idx); });
    }, { passive: true });
  }
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

var _lbImgs = [];
var _lbIdx = 0;
var _lbTouchX = 0;

function openLightbox(idx) {
  if (!_listing || !_listing.images.length) return;
  _lbImgs = _listing.images;
  _lbIdx = idx || 0;
  var lb = _getLightbox();
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  _updateLightbox();
}

function _getLightbox() {
  var lb = document.getElementById('photo-lightbox');
  if (lb && lb.dataset.ready) return lb;
  lb.dataset.ready = '1';
  lb.className = 'photo-lightbox';
  lb.innerHTML =
    '<div class="lightbox-header">' +
      '<span class="lightbox-counter" id="lightbox-counter"></span>' +
      '<button class="lightbox-close" aria-label="Close" onclick="closeLightbox()">&#215;</button>' +
    '</div>' +
    '<div class="lightbox-body">' +
      '<button class="lightbox-nav prev" aria-label="Previous" onclick="lightboxStep(-1)">&#8249;</button>' +
      '<div class="lightbox-img-wrap"><img id="lightbox-img" class="lightbox-img" alt=""></div>' +
      '<button class="lightbox-nav next" aria-label="Next" onclick="lightboxStep(1)">&#8250;</button>' +
    '</div>';
  lb.addEventListener('click', function(e) { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', function(e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxStep(-1);
    if (e.key === 'ArrowRight') lightboxStep(1);
  });
  lb.addEventListener('touchstart', function(e) { _lbTouchX = e.changedTouches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - _lbTouchX;
    if (Math.abs(dx) > 50) lightboxStep(dx < 0 ? 1 : -1);
  });
  return lb;
}

function _updateLightbox() {
  var img = document.getElementById('lightbox-img');
  var counter = document.getElementById('lightbox-counter');
  var lb = document.getElementById('photo-lightbox');
  if (img) img.src = clImg(_lbImgs[_lbIdx], 1400);
  if (counter) counter.textContent = (_lbIdx + 1) + ' / ' + _lbImgs.length;
  var prev = lb && lb.querySelector('.lightbox-nav.prev');
  var next = lb && lb.querySelector('.lightbox-nav.next');
  if (prev) prev.style.visibility = _lbIdx === 0 ? 'hidden' : '';
  if (next) next.style.visibility = _lbIdx === _lbImgs.length - 1 ? 'hidden' : '';
}

function lightboxStep(dir) {
  _lbIdx = Math.max(0, Math.min(_lbImgs.length - 1, _lbIdx + dir));
  _updateLightbox();
}

function closeLightbox() {
  var lb = document.getElementById('photo-lightbox');
  if (lb) lb.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Availability Calendar ─────────────────────────────────────────────────────

var calState = {
  listingId: null, minStay: 1,
  availWindows: [], bookedRanges: [], blockedRanges: [],
  checkIn: null, checkOut: null,
  viewYear: new Date().getFullYear(), viewMonth: new Date().getMonth()
};

function toggleAvailability() {
  var wrap = document.getElementById('availability-calendar-wrap');
  var btn = document.getElementById('check-availability-btn');
  if (!wrap) return;
  var isOpen = wrap.style.display !== 'none';
  if (isOpen) {
    wrap.style.display = 'none';
    if (btn) btn.innerHTML = '<i data-lucide="calendar" width="15" height="15" style="margin-right:6px"></i>Check Availability';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } else {
    wrap.style.display = 'block';
    if (btn) btn.innerHTML = '<i data-lucide="calendar-x" width="15" height="15" style="margin-right:6px"></i>Hide Availability';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (calState.listingId !== _listing.id) {
      loadPublicAvailability(_listing.id);
    }
    setTimeout(function() {
      wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  }
}

async function loadPublicAvailability(listingId) {
  var wrap = document.getElementById('availability-calendar-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<p style="color:var(--stone);font-size:.875rem;padding:16px 0">Loading availability…</p>';
  try {
    var headers = { apikey: _ANON, Accept: 'application/json' };
    var results = await Promise.all([
      fetch(_BASE + '/availability?listing_id=eq.' + listingId + '&order=start_date.asc&select=*', { headers }),
      fetch(_BASE + '/bookings?listing_id=eq.' + listingId + '&status=eq.accepted&select=start_date,end_date', { headers }),
      fetch(_BASE + '/blocked_dates?listing_id=eq.' + listingId + '&select=start_date,end_date', { headers }),
    ]);
    if (!results[0].ok) throw new Error('Could not load availability');
    var windows = await results[0].json();
    var booked = await results[1].json();
    var blocked = results[2].ok ? await results[2].json() : [];
    var now = new Date();
    calState.listingId = listingId;
    var dbMinStay = (_listing && _listing.minStayNights) || 1;
    var isLEV = _listing && _listing.community === 'la-ecovilla';
    calState.minStay = isLEV ? Math.max(dbMinStay, 7) : dbMinStay;
    calState.availWindows = windows;
    calState.bookedRanges = booked;
    calState.blockedRanges = blocked;
    calState.checkIn = null; calState.checkOut = null;
    calState.viewYear = now.getFullYear(); calState.viewMonth = now.getMonth();
    renderCalendar();
  } catch(err) {
    var wrap = document.getElementById('availability-calendar-wrap');
    if (wrap) wrap.innerHTML = '<p style="color:#b34a4a;font-size:.875rem;padding:16px 0">Could not load availability.</p>';
  }
}

function renderCalendar() {
  var wrap = document.getElementById('availability-calendar-wrap');
  if (!wrap) return;
  if (!calState.availWindows.length) {
    wrap.innerHTML = '<p style="color:var(--stone);font-size:.875rem;padding:16px 0;text-align:center">No availability windows set for this listing yet.</p>';
    return;
  }
  var year = calState.viewYear, month = calState.viewMonth;
  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var html = '<div class="cal-wrap">';
  if (calState.minStay > 1) html += '<p style="font-size:.78rem;color:var(--stone);margin-bottom:10px;text-align:center">⏱ Minimum stay: ' + calState.minStay + ' night' + (calState.minStay !== 1 ? 's' : '') + '</p>';
  html += '<div class="cal-header">';
  html += '<button class="cal-nav" onclick="calPrev()"' + (canGoPrev() ? '' : ' disabled') + '>&#8249;</button>';
  html += '<span class="cal-month-label">' + monthNames[month] + ' ' + year + '</span>';
  html += '<button class="cal-nav" onclick="calNext()">&#8250;</button>';
  html += '</div><div class="cal-grid">';
  var dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  dayNames.forEach(function(d) { html += '<div class="cal-day-name">' + d + '</div>'; });
  var first = new Date(year, month, 1).getDay();
  for (var i = 0; i < first; i++) html += '<div class="cal-day empty"></div>';
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var today = toCalYMD(new Date());
  for (var d = 1; d <= daysInMonth; d++) {
    var date = new Date(year, month, d);
    var ymd = toCalYMD(date);
    var state = getDayState(date, ymd, today);
    var cls = 'cal-day ' + state;
    var clickable = ['available','checkout-only','checkin'].indexOf(state) !== -1;
    html += '<div class="' + cls + '"' + (clickable ? ' onclick="calSelectDay(\'' + ymd + '\')"' : '') + '>' + d + '</div>';
  }
  html += '</div>';

  if (calState.checkIn) {
    html += '<div class="cal-selection">';
    html += '<div class="cal-sel-item"><span>Check-in</span><strong>' + fmtAvailDate(calState.checkIn) + '</strong></div>';
    if (calState.checkOut) {
      var nights = Math.round((new Date(calState.checkOut) - new Date(calState.checkIn)) / 86400000);
      var rate = _listing && _listing.pricePerNight;
      var cleaning = _listing && _listing.cleaningFee;
      var total = rate ? (rate * nights + (cleaning || 0)) : null;
      html += '<div class="cal-sel-item"><span>Check-out</span><strong>' + fmtAvailDate(calState.checkOut) + '</strong></div>';
      html += '<div class="cal-sel-item"><span>Nights</span><strong>' + nights + '</strong></div>';
      if (total) html += '<div class="cal-sel-item"><span>Total</span><strong>$' + Number(total).toLocaleString() + '</strong></div>';
      html += '</div>';
      html += '<textarea id="booking-message" placeholder="Message to host (optional)" style="width:100%;margin:12px 0 8px;padding:10px;border:1px solid var(--parchment);border-radius:8px;font-family:inherit;font-size:.85rem;resize:vertical;min-height:70px"></textarea>';
      html += '<button onclick="submitBookingRequest()" style="width:100%;padding:14px;border-radius:12px;font-size:.95rem;font-weight:600;background:var(--clay);color:white;border:none;cursor:pointer;font-family:inherit">Request Booking</button>';
    } else {
      html += '<div class="cal-sel-item"><span>Check-out</span><strong style="color:var(--stone)">Select a date</strong></div></div>';
    }
  }
  html += '</div>';
  wrap.innerHTML = html;
}

function getDayState(date, ymd, today) {
  if (ymd < today) return 'past';
  if (calState.checkIn && ymd === calState.checkIn) return 'checkin';
  if (calState.checkOut && ymd === calState.checkOut) return 'checkout';
  if (calState.checkIn && calState.checkOut && ymd > calState.checkIn && ymd < calState.checkOut) return 'inrange';
  var isBooked = calState.bookedRanges.some(function(b) { return ymd >= b.start_date && ymd < b.end_date; });
  var isBlocked = calState.blockedRanges.some(function(b) { return ymd >= b.start_date && ymd < b.end_date; });
  if (isBooked || isBlocked) return 'booked';
  var isCheckout = calState.bookedRanges.some(function(b) { return ymd === b.end_date; });
  if (isCheckout) return 'checkout-only';
  var isAvail = calState.availWindows.some(function(w) { return ymd >= w.start_date && ymd < w.end_date; });
  if (!isAvail) return 'unavailable';
  if (calState.checkIn && !calState.checkOut) {
    var diff = Math.round((date - new Date(calState.checkIn)) / 86400000);
    if (diff > 0 && diff < calState.minStay) return 'minstay';
  }
  return 'available';
}

function canGoPrev() {
  var now = new Date();
  return !(calState.viewYear === now.getFullYear() && calState.viewMonth === now.getMonth());
}
function calPrev() {
  if (!canGoPrev()) return;
  if (calState.viewMonth === 0) { calState.viewMonth = 11; calState.viewYear--; }
  else calState.viewMonth--;
  renderCalendar();
}
function calNext() {
  if (calState.viewMonth === 11) { calState.viewMonth = 0; calState.viewYear++; }
  else calState.viewMonth++;
  renderCalendar();
}
function calSelectDay(ymd) {
  if (!calState.checkIn || (calState.checkIn && calState.checkOut)) {
    calState.checkIn = ymd; calState.checkOut = null;
  } else if (ymd <= calState.checkIn) {
    calState.checkIn = ymd; calState.checkOut = null;
  } else {
    var cursor = new Date(calState.checkIn);
    cursor.setDate(cursor.getDate() + 1);
    var hasBlock = false;
    while (toCalYMD(cursor) < ymd) {
      var cymd = toCalYMD(cursor);
      var blocked = calState.bookedRanges.some(function(b) { return cymd >= b.start_date && cymd < b.end_date; });
      var avail = calState.availWindows.some(function(w) { return cymd >= w.start_date && cymd < w.end_date; });
      if (blocked || !avail) { hasBlock = true; break; }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (hasBlock) { calState.checkIn = ymd; calState.checkOut = null; }
    else calState.checkOut = ymd;
  }
  renderCalendar();
}

async function submitBookingRequest() {
  if (_listing && _currentUser && _listing.ownerId === _currentUser.id) {
    showToast('You cannot book your own listing.', 'error'); return;
  }
  var session = await Auth.getSession();
  if (!session) {
    sessionStorage.setItem('pendingBooking', JSON.stringify({
      listingId: calState.listingId, checkIn: calState.checkIn, checkOut: calState.checkOut
    }));
    window.location.href = 'login.html';
    return;
  }
  var msgEl = document.getElementById('booking-message');
  var message = msgEl ? msgEl.value.trim() : '';
  var token = session.access_token;
  var payload = JSON.parse(atob(token.split('.')[1]));
  var requesterId = payload.sub;
  var submitBtn = document.querySelector('button[onclick="submitBookingRequest()"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }
  try {
    var res = await fetch(_BASE + '/bookings', {
      method: 'POST',
      headers: { apikey: _ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ listing_id: calState.listingId, requester_id: requesterId, start_date: calState.checkIn, end_date: calState.checkOut, message: message || null, status: 'pending' })
    });
    if (!res.ok) throw new Error(await res.text());
    var bookingRows = await res.json();
    var booking = Array.isArray(bookingRows) ? bookingRows[0] : bookingRows;
    var listingRes = await fetch(_BASE + '/listings?id=eq.' + calState.listingId + '&select=owner_id', {
      headers: { apikey: _ANON, Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
    var listingRows = listingRes.ok ? await listingRes.json() : [];
    var hostId = listingRows[0] ? listingRows[0].owner_id : null;
    if (hostId && booking) {
      var existingConvRes = await fetch(_BASE + '/conversations?listing_id=eq.' + calState.listingId + '&user_id=eq.' + requesterId + '&select=id&limit=1',
        { headers: { apikey: _ANON, Authorization: 'Bearer ' + token, Accept: 'application/json' } });
      var existingConvs = existingConvRes.ok ? await existingConvRes.json() : [];
      var convId = existingConvs[0] ? existingConvs[0].id : null;
      if (!convId) {
        var convRes = await fetch(_BASE + '/conversations', {
          method: 'POST',
          headers: { apikey: _ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ listing_id: calState.listingId, host_id: hostId, user_id: requesterId, booking_id: booking.id })
        });
        if (convRes.ok) { var convRows = await convRes.json(); convId = (Array.isArray(convRows) ? convRows[0] : convRows).id; }
      }
      if (convId && message) {
        await fetch(_BASE + '/messages', {
          method: 'POST',
          headers: { apikey: _ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ conversation_id: convId, sender_id: requesterId, body: message })
        });
      }
    }
    var wrap = document.getElementById('availability-calendar-wrap');
    if (wrap) {
      wrap.innerHTML = '<div style="text-align:center;padding:28px 16px"><div style="font-size:2.5rem;margin-bottom:12px">🌿</div>' +
        '<h3 style="font-family:var(--font-display,serif);font-size:1.4rem;margin-bottom:8px">Request Sent!</h3>' +
        '<p style="color:var(--stone);font-size:.875rem;line-height:1.6">Your booking request for <strong>' +
        fmtAvailDate(calState.checkIn) + ' → ' + fmtAvailDate(calState.checkOut) +
        '</strong> has been sent to the host. You\'ll receive a response shortly.</p></div>';
    }
  } catch(err) {
    showToast('Could not send booking request. Please try again.', 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Request Booking'; }
  }
}

// ── Render listing page ───────────────────────────────────────────────────────

function renderListing(listing) {
  var isSale = listing.listingType === 'sale';
  document.title = listing.title + ' | Ecovilla Rentals';

  // Gallery
  var imgs = listing.images.filter(Boolean);
  if (!imgs.length) imgs = ['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80'];
  document.getElementById('lp-gallery').innerHTML = buildGallery(imgs);
  initMobileCarousel();
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Certified badge
  if (listing.featured) {
    document.getElementById('lp-cert-badge').innerHTML =
      '<span class="badge badge-featured" style="margin-bottom:8px;display:inline-flex"><i data-lucide="star" width="10" height="10" style="fill:currentColor;margin-right:3px"></i>Certified</span>';
  }

  // Title
  document.getElementById('lp-title').textContent = listing.title;

  // Specs
  var specs = [
    { icon: 'map-pin', label: communityName(listing.community) },
    { icon: 'bed-double', label: listing.bedrooms + ' bed' + (listing.bedrooms !== 1 ? 's' : '') },
    { icon: 'bath', label: listing.bathrooms + ' bath' + (listing.bathrooms !== 1 ? 's' : '') },
    listing.type ? { icon: 'home', label: listing.type } : null,
    isSale && listing.sqft ? { icon: 'ruler', label: Number(listing.sqft).toLocaleString() + ' sqft' } : null,
    listing.maxGuests ? { icon: 'users', label: listing.maxGuests + ' guest' + (listing.maxGuests !== 1 ? 's' : '') } : null,
    listing.petsAllowed ? { icon: 'paw-print', label: 'Pets welcome' } : null,
  ].filter(Boolean);
  document.getElementById('lp-specs').innerHTML = specs.map(function(s) {
    return '<span class="detail-spec"><i data-lucide="' + s.icon + '" width="14" height="14"></i> ' + esc(s.label) + '</span>';
  }).join('');

  // Status badge
  var statusHTML = isSale
    ? '<span class="status-pill status-available" style="display:inline-block;margin-bottom:8px">For Sale</span>'
    : listing.status === 'active'
      ? '<span class="status-pill status-available" style="display:inline-block;margin-bottom:8px">Available</span>'
      : '<span class="status-pill status-unavailable" style="display:inline-block;margin-bottom:8px">Currently Unavailable</span>';
  document.getElementById('lp-status-badge').innerHTML = statusHTML;

  // Pricing
  var pricingHTML = '';
  if (isSale) {
    pricingHTML = '<div class="detail-pricing"><div class="price-item"><label>Asking Price</label><div class="value">' +
      (listing.salePrice ? fmt(listing.salePrice) : '<span style="color:var(--clay);font-style:italic">Price on request</span>') +
      '</div></div></div>';
  } else if (listing.pricePerMonth || listing.pricePerNight) {
    pricingHTML = '<div class="detail-pricing">' +
      (listing.pricePerNight ? '<div class="price-item"><label>Per night</label><div class="value">' + fmt(listing.pricePerNight) + '</div></div>' : '') +
      (listing.pricePerMonth ? '<div class="price-item"><label>Per month</label><div class="value">' + fmt(listing.pricePerMonth) + '</div></div>' : '') +
      (listing.cleaningFee ? '<div class="price-item"><label>Cleaning fee</label><div class="value">' + fmt(listing.cleaningFee) + '</div></div>' : '') +
      '</div>';
  } else {
    pricingHTML = '<div class="detail-pricing"><div class="price-item" style="grid-column:1/-1"><label>Pricing</label><div class="value" style="color:var(--clay);font-style:italic">Price on application</div></div></div>';
  }
  document.getElementById('lp-pricing').innerHTML = pricingHTML;

  // Description
  if (listing.description) {
    document.getElementById('lp-description').innerHTML =
      '<p class="detail-description" style="margin-top:20px">' + esc(listing.description) + '</p>';
  }

  // Amenities
  if (listing.amenities && listing.amenities.length) {
    document.getElementById('lp-amenities').innerHTML =
      '<div style="margin-top:24px"><div class="label-sm" style="color:var(--stone);margin-bottom:14px">Amenities & Features</div>' +
      '<div class="amenity-grid">' +
      listing.amenities.map(function(a) { return '<div class="amenity-item"><i data-lucide="check" width="14" height="14"></i>' + esc(a) + '</div>'; }).join('') +
      '</div></div>';
  }

  // Availability (rental only)
  if (!isSale) {
    document.getElementById('lp-avail-section').innerHTML =
      '<div style="margin-top:28px;margin-bottom:24px">' +
      '<button class="btn btn-secondary btn-full" id="check-availability-btn" onclick="toggleAvailability()">' +
      '<i data-lucide="calendar" width="15" height="15" style="margin-right:6px"></i>Check Availability' +
      '</button>' +
      '<div id="availability-calendar-wrap" style="display:none;margin-top:16px;padding-bottom:40px"></div>' +
      '</div>';
  }


  // Heart state
  updateHeartButtons();

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Header scroll hide/show ───────────────────────────────────────────────────

function initHeaderScroll() {
  var header = document.getElementById('site-header');
  if (!header) return;
  var lastY = 0;
  window.addEventListener('scroll', function() {
    var y = window.scrollY;
    if (window.innerWidth <= 768) {
      if (y > lastY && y > 80) header.classList.add('header-hide');
      else header.classList.remove('header-hide');
    }
    header.classList.toggle('scrolled', y > 10);
    lastY = y;
  }, { passive: true });
}

// ── Mobile nav toggle ─────────────────────────────────────────────────────────

function initMobileNav() {
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('mobile-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', function() {
    var open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
}

// ── Floating nav ──────────────────────────────────────────────────────────────

function initFloatNav() {
  var fnBack  = document.getElementById('fn-back');
  var fnHeart = document.getElementById('fn-heart');
  var fnShare = document.getElementById('fn-share');

  if (fnBack)  fnBack.addEventListener('click', function() {
    if (history.length > 1) history.back(); else window.location.href = 'index.html';
  });
  if (fnHeart) fnHeart.addEventListener('click', toggleSaved);
  if (fnShare) fnShare.addEventListener('click', shareListing);

  var fn = document.getElementById('float-nav');
  if (fn) setTimeout(function() { fn.classList.add('fn-visible'); }, 300);
}

// ── Heart + Share button wiring ───────────────────────────────────────────────

function initActionButtons() {
  var heartBtn = document.getElementById('lp-heart-btn');
  var shareBtn = document.getElementById('lp-share-btn');
  var backBtn = document.getElementById('lp-back-btn');

  if (heartBtn) heartBtn.addEventListener('click', toggleSaved);
  if (shareBtn) shareBtn.addEventListener('click', shareListing);
  if (backBtn) backBtn.addEventListener('click', function() {
    if (history.length > 1) history.back(); else window.location.href = 'index.html';
  });
}

// ── Error state ───────────────────────────────────────────────────────────────

function showError(msg) {
  document.getElementById('auth-loading').style.display = 'none';
  document.getElementById('lp-main').style.display = 'block';
  document.querySelector('.lp-layout').innerHTML =
    '<div style="text-align:center;padding:80px 24px">' +
    '<div style="font-size:3rem;margin-bottom:16px">🌿</div>' +
    '<h2 style="font-family:var(--font-display,serif);margin-bottom:12px">' + esc(msg) + '</h2>' +
    '<a href="index.html" class="btn btn-primary">Browse all listings</a>' +
    '</div>';
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function() {
  initHeaderScroll();
  initMobileNav();
  initActionButtons();
  initFloatNav();

  var params = new URLSearchParams(window.location.search);
  var id = params.get('id');
  if (!id) { showError('No listing specified.'); return; }

  // Load user + saved IDs in parallel with listing fetch
  var userPromise = Auth.getUser().then(function(u) { _currentUser = u || null; }).catch(function() {});
  var savedPromise = loadSavedIds();
  var listingPromise = fetchListing(id);

  try {
    _listing = await listingPromise;
    await Promise.all([userPromise, savedPromise]);

    // Update login button if user is logged in
    if (_currentUser) {
      var loginBtn = document.getElementById('hdr-login-btn');
      if (loginBtn) {
        loginBtn.textContent = 'Dashboard';
        loginBtn.href = _currentUser.role === 'user' ? 'user.html' : _currentUser.role === 'host' ? 'host.html' : 'admin.html';
      }
    }

    renderListing(_listing);
    document.getElementById('auth-loading').style.display = 'none';
    document.getElementById('lp-main').style.display = 'block';

    // Handle pending booking restore (from login redirect)
    var pending = sessionStorage.getItem('pendingBooking');
    var redirect = params.get('redirect');
    if (pending && redirect === 'booking') {
      try {
        var pb = JSON.parse(pending);
        if (pb.listingId === id) {
          sessionStorage.removeItem('pendingBooking');
          toggleAvailability();
          setTimeout(function() {
            loadPublicAvailability(id).then(function() {
              calState.checkIn = pb.checkIn;
              calState.checkOut = pb.checkOut;
              renderCalendar();
            });
          }, 400);
        }
      } catch(e) {}
    }

    // Handle pending save (from login redirect)
    var pendingSave = sessionStorage.getItem('pendingSaveListing');
    if (pendingSave === id) {
      sessionStorage.removeItem('pendingSaveListing');
      await toggleSaved();
      window.location.href = 'user.html?panel=saved';
    }

  } catch(err) {
    showError('Listing not found');
  }
});
