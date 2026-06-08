/**
 * Ecovilla Rentals – Main Site JavaScript
 */

'use strict';

// ─── Utilities ────────────────────────────────────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const esc = str => String(str).replace(/[&<>"']/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const COMMUNITY_NAMES = {
  'la-ecovilla': 'La Ecovilla (LEV)',
  'san-mateo': 'Ecovilla San Mateo',
  // 'alegria-village': 'Alegría Village',
  // 'tacotal': 'Tacotal',
  // 'maderal': 'Maderal',
  // 'atenas': 'Atenas',
  // 'turrubares': 'Turrubares',
  // 'orotina': 'Orotina',
};

const COMMUNITY_COLORS = {
  'la-ecovilla': '#4a7c59',
  'san-mateo': '#3a6b7c',
  // 'alegria-village': '#c06e3a',
  // 'tacotal': '#6b5b3e',
  // 'maderal': '#7c3a6b',
  // 'atenas': '#5b7c3a',
  // 'turrubares': '#3a5b7c',
  // 'orotina': '#7c6b3a',
};

var _MAIN_ANON = typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d21kZ2VsZmxzdG5xZmdzbHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTQxODIsImV4cCI6MjA5NDk3MDE4Mn0.7SAsWpGvYDV-aRaHagt_tBFiSkbNL-Vuc3gHLSs8o9E';
var _MAIN_BASE = 'https://wywmdgelflstnqfgslqw.supabase.co/rest/v1';

// ─── Saved / Favourites ───────────────────────────────────────────────────────

var savedIds = new Set();

async function loadSavedIds() {
  try {
    var session = await Auth.getSession();
    if (!session) return;
    var token = session.access_token;
    var res = await fetch(_MAIN_BASE + '/saved_listings?select=listing_id', {
      headers: { apikey: _MAIN_ANON, Authorization: 'Bearer ' + token, Accept: 'application/json' },
    });
    if (!res.ok) return;
    var rows = await res.json();
    savedIds = new Set(rows.map(function (r) { return r.listing_id; }));
  } catch (e) { /* silent — guest browsing */ }
}

async function toggleSaved(listingId, btn) {
  var session = await Auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  var token = session.access_token;
  var isSaved = savedIds.has(listingId);
  try {
    if (isSaved) {
      var res = await fetch(_MAIN_BASE + '/saved_listings?listing_id=eq.' + listingId, {
        method: 'DELETE',
        headers: { apikey: _MAIN_ANON, Authorization: 'Bearer ' + token },
      });
      if (!res.ok) throw new Error();
      savedIds.delete(listingId);
      btn.classList.remove('active');
      btn.innerHTML = '<i data-lucide="heart" aria-hidden="true" width="15" height="15"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } else {
      var payload = JSON.parse(atob(token.split('.')[1]));
      var res = await fetch(_MAIN_BASE + '/saved_listings', {
        method: 'POST',
        headers: { apikey: _MAIN_ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: payload.sub, listing_id: listingId }),
      });
      if (!res.ok) throw new Error();
      savedIds.add(listingId);
      btn.classList.add('active');
      btn.innerHTML = '<i data-lucide="heart" aria-hidden="true" width="15" height="15" style="fill:currentColor"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  } catch (e) {
    showToast('Could not update saved listings. Please try again.', 'error');
  }
}

function communityName(id) { return COMMUNITY_NAMES[id] || id; }

function fmtRentalMode(mode) {
  if (mode === 'both')       return 'Short & Long Term';
  if (mode === 'short-term') return 'Short Term';
  if (mode === 'long-term')  return 'Long Term';
  return mode;
}

// ── Gallery navigation ─────────────────────────────────────────────────────
function galleryGoTo(index) {
  var imgs = window._galleryImgs;
  if (!imgs || !imgs.length) return;
  index = (index + imgs.length) % imgs.length;
  window._galleryIndex = index;

  var mainImg = document.getElementById('gallery-main-img');
  if (mainImg) mainImg.src = imgs[index];

  var counter = document.getElementById('gallery-counter');
  if (counter) counter.textContent = (index + 1) + ' / ' + imgs.length;

  var strip = document.getElementById('gallery-strip');
  if (strip) {
    var thumbs = strip.querySelectorAll('.gallery-thumb');
    thumbs.forEach(function (t, i) { t.classList.toggle('active', i === index); });
    if (thumbs[index]) {
      thumbs[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }
}

function galleryStep(dir) {
  galleryGoTo((window._galleryIndex || 0) + dir);
}

// ── Photo Mosaic ───────────────────────────────────────────────────────────────

function buildMosaicHTML(imgs) {
  var count = imgs.length;
  if (!count) return '';
  var visible = Math.min(count, 5);
  var html = '<div class="photo-mosaic photo-mosaic-' + visible + '">';
  for (var i = 0; i < visible; i++) {
    var isFirst = i === 0;
    var isLast = i === visible - 1;
    html += '<div class="mosaic-cell' + (isFirst ? ' mosaic-main' : '') + '">';
    html += '<img src="' + esc(clImg(imgs[i], i === 0 ? 1200 : 700)) + '" class="mosaic-img" alt=""' +
      (i > 0 ? ' loading="lazy"' : '') +
      ' onclick="openLightbox(' + i + ')">';
    // "Show all X photos" on last visible cell — desktop only (CSS hides on mobile)
    if (isLast && count > visible) {
      html += '<button class="mosaic-show-all" onclick="event.stopPropagation();openLightbox(' + i + ')">Show all ' + count + ' photos</button>';
    }
    // Photo count pill on first cell — mobile only (CSS hides on desktop)
    if (isFirst && count > 1) {
      html += '<div class="mosaic-count-pill" onclick="openLightbox(0)">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
        count + ' photos</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// ── Lightbox ───────────────────────────────────────────────────────────────────

function _getLightbox() {
  var lb = document.getElementById('photo-lightbox');
  if (lb) return lb;
  lb = document.createElement('div');
  lb.id = 'photo-lightbox';
  lb.className = 'photo-lightbox';
  lb.innerHTML =
    '<div class="lightbox-header">' +
      '<span class="lightbox-counter" id="lightbox-counter"></span>' +
      '<button class="lightbox-close" aria-label="Close" onclick="closeLightbox()">&#215;</button>' +
    '</div>' +
    '<div class="lightbox-body">' +
      '<button class="lightbox-nav prev" aria-label="Previous photo" onclick="lightboxStep(-1)">&#8249;</button>' +
      '<div class="lightbox-img-wrap"><img id="lightbox-img" class="lightbox-img" alt=""></div>' +
      '<button class="lightbox-nav next" aria-label="Next photo" onclick="lightboxStep(1)">&#8250;</button>' +
    '</div>';
  document.body.appendChild(lb);

  document.addEventListener('keydown', function (e) {
    var lb2 = document.getElementById('photo-lightbox');
    if (!lb2 || !lb2.classList.contains('open')) return;
    if (e.key === 'ArrowLeft')  lightboxStep(-1);
    else if (e.key === 'ArrowRight') lightboxStep(1);
    else if (e.key === 'Escape') closeLightbox();
  });

  // Touch swipe
  var _tx = 0;
  lb.addEventListener('touchstart', function (e) { _tx = e.changedTouches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - _tx;
    if (Math.abs(dx) > 50) lightboxStep(dx < 0 ? 1 : -1);
  }, { passive: true });

  return lb;
}

function _updateLightbox() {
  var imgs = window._galleryImgs || [];
  var idx = window._galleryIndex || 0;
  var img = document.getElementById('lightbox-img');
  var counter = document.getElementById('lightbox-counter');
  var lb = document.getElementById('photo-lightbox');
  if (img) img.src = clImg(imgs[idx] || '', 1600);
  if (counter) counter.textContent = (idx + 1) + ' / ' + imgs.length;
  if (lb) {
    var prevBtn = lb.querySelector('.lightbox-nav.prev');
    var nextBtn = lb.querySelector('.lightbox-nav.next');
    var show = imgs.length > 1 ? '' : 'none';
    if (prevBtn) prevBtn.style.display = show;
    if (nextBtn) nextBtn.style.display = show;
  }
}

function openLightbox(startIndex) {
  var imgs = window._galleryImgs || [];
  if (!imgs.length) return;
  _getLightbox();
  window._galleryIndex = startIndex || 0;
  _updateLightbox();
  document.getElementById('photo-lightbox').classList.add('open');
}

function lightboxStep(dir) {
  var imgs = window._galleryImgs || [];
  window._galleryIndex = ((window._galleryIndex || 0) + dir + imgs.length) % imgs.length;
  _updateLightbox();
}

function closeLightbox() {
  var lb = document.getElementById('photo-lightbox');
  if (lb) lb.classList.remove('open');
}

function communityColor(id) { return COMMUNITY_COLORS[id] || '#9e9589'; }
function fmt(n) { return n ? '$' + Number(n).toLocaleString() : null; }

// ── Cloudinary URL helper ──────────────────────────────────────────────────────
// Inserts transformation params into Cloudinary URLs for auto format/quality
// and optional width. Non-Cloudinary URLs are passed through unchanged.
function clImg(url, w) {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  var t = 'f_auto,q_auto' + (w ? ',w_' + w : '');
  return url.replace('/upload/', '/upload/' + t + '/');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg, type, dur) {
  type = type || 'default';
  dur = dur || 3500;
  var container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  var icons = { success: '✓', error: '✕', default: 'ℹ' };
  toast.className = 'toast ' + type;
  toast.innerHTML = '<span>' + (icons[type] || icons.default) + '</span><span>' + esc(msg) + '</span>';
  container.appendChild(toast);
  setTimeout(function () {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all .3s ease';
    setTimeout(function () { toast.remove(); }, 350);
  }, dur);
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function initNav() {
  var header = $('.site-header');
  var toggle = $('.nav-menu-toggle');
  var mobileNav = $('.mobile-nav');

  if (header) {
    var _floatNav = document.getElementById('float-nav');
    var _headerHidden = false;
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      header.classList.toggle('scrolled', y > 20);
      // Hide header + show pill nav past 100px; restore below 60px (hysteresis)
      // CSS media query ensures this only has visual effect on mobile
      if (!_headerHidden && y > 100) {
        _headerHidden = true;
        header.classList.add('header-hide');
        if (_floatNav) _floatNav.classList.add('fn-visible');
      } else if (_headerHidden && y < 60) {
        _headerHidden = false;
        header.classList.remove('header-hide');
        if (_floatNav) _floatNav.classList.remove('fn-visible');
      }
    }, { passive: true });
  }

  if (toggle && mobileNav) {
    toggle.addEventListener('click', function () {
      var open = mobileNav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });
    $$('a, button', mobileNav).forEach(function (el) {
      el.addEventListener('click', function (e) {
        mobileNav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        var href = el.getAttribute('href');
        if (href && href.startsWith('#') && href.length > 1) {
          e.preventDefault();
          var target = document.querySelector(href);
          if (target) setTimeout(function () { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 0);
        }
      });
    });
  }
}

// ─── Search Tabs ──────────────────────────────────────────────────────────────

function initSearchTabs() {
  $$('.search-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.search-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var target = tab.dataset.tab;
      $$('.search-panel-content').forEach(function (p) {
        p.style.display = p.dataset.content === target ? 'block' : 'none';
      });
    });
  });
}

// ─── Scroll Animations ────────────────────────────────────────────────────────

function initScrollAnimations() {
  var els = $$('.animate-on-scroll');
  if (!els.length) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: .12 });
  els.forEach(function (el, i) {
    el.style.transitionDelay = (i * 60) + 'ms';
    io.observe(el);
  });
}

// ─── Listings State & Filters ─────────────────────────────────────────────────

var PAGE_SIZE = 9;
var currentPage = 1;
var activeFilters = {
  mode: 'all', community: '', type: '', bedroomsMin: '',
  priceMin: '', priceMax: '', sort: 'newest', search: '',
  checkIn: '', checkOut: '',
};

window.activeFilters = activeFilters;
window.currentPage = 1;

function getListings() { return window.LISTINGS || []; }

function applyFilters(listings) {
  var result = listings.slice();

  if (activeFilters.mode === 'for-sale') {
    result = result.filter(function (l) { return l.listingType === 'sale'; });
    if (activeFilters.priceMin) {
      var minS = parseFloat(activeFilters.priceMin);
      result = result.filter(function (l) { return l.salePrice && l.salePrice >= minS; });
    }
    if (activeFilters.priceMax) {
      var maxS = parseFloat(activeFilters.priceMax);
      result = result.filter(function (l) { return l.salePrice && l.salePrice <= maxS; });
    }
  } else {
    result = result.filter(function (l) { return l.listingType !== 'sale'; });
    if (activeFilters.mode === 'short-term') result = result.filter(function (l) { return l.priceNightly; });
    else if (activeFilters.mode === 'long-term') result = result.filter(function (l) { return l.priceMonthly; });
    if (activeFilters.priceMin) {
      var min = parseFloat(activeFilters.priceMin);
      result = result.filter(function (l) { var p = l.priceMonthly || l.priceNightly; return p && p >= min; });
    }
    if (activeFilters.priceMax) {
      var max = parseFloat(activeFilters.priceMax);
      result = result.filter(function (l) { var p = l.priceMonthly || l.priceNightly; return p && p <= max; });
    }
  }

  if (activeFilters.community) result = result.filter(function (l) { return l.community === activeFilters.community; });
  if (activeFilters.type) result = result.filter(function (l) { return l.type === activeFilters.type; });
  if (activeFilters.bedroomsMin) result = result.filter(function (l) { return l.bedrooms >= parseInt(activeFilters.bedroomsMin); });
  if (activeFilters.maxGuests) result = result.filter(function (l) { return !l.maxGuests || l.maxGuests >= activeFilters.maxGuests; });
  if (activeFilters.pets) result = result.filter(function (l) { return l.petsAllowed; });

  if (activeFilters.search) {
    var q = activeFilters.search.toLowerCase();
    result = result.filter(function (l) {
      return l.title.toLowerCase().includes(q) ||
        (l.description || '').toLowerCase().includes(q) ||
        communityName(l.community).toLowerCase().includes(q) ||
        (l.type || '').toLowerCase().includes(q);
    });
  }

  if (activeFilters.checkIn && activeFilters.checkOut && window.availableListingIds !== null && window.availableListingIds !== undefined) {
    result = result.filter(function (l) { return window.availableListingIds.has(l.id); });
  }

  switch (activeFilters.sort) {
    case 'price-high': result.sort(function (a, b) { return (b.priceMonthly || b.priceNightly || 0) - (a.priceMonthly || a.priceNightly || 0); }); break;
    case 'price-low': result.sort(function (a, b) { return (a.priceMonthly || a.priceNightly || 0) - (b.priceMonthly || b.priceNightly || 0); }); break;
    case 'newest': result.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }); break;
    case 'oldest': result.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); }); break;
    case 'az': result.sort(function (a, b) { return a.title.localeCompare(b.title); }); break;
    case 'za': result.sort(function (a, b) { return b.title.localeCompare(a.title); }); break;
  }
  return result;
}

// ─── Card HTML ────────────────────────────────────────────────────────────────

function cardHTML(listing, idx) {
  var community = communityName(listing.community);
  var color = communityColor(listing.community);
  var img = clImg((listing.images || [])[0] || listing.image ||
    'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80', 600);
  var beds = listing.bedrooms || 0;
  var baths = listing.bathrooms || 0;

  var priceHTML = '';
  if (listing.listingType === 'sale') {
    priceHTML = listing.salePrice
      ? '<span class="price-sale">' + fmt(listing.salePrice) + '</span>'
      : '<span class="price-poa">Price on request</span>';
  } else if (!listing.priceMonthly && !listing.priceNightly) {
    priceHTML = '<span class="price-poa">Price on request</span>';
  } else {
    priceHTML = '<div class="price-stack">';
    if (listing.priceNightly) priceHTML += '<span class="price-night">' + fmt(listing.priceNightly) + '<small style="font-size:.65em;font-weight:400;opacity:.7">/night</small></span>';
    if (listing.priceMonthly) priceHTML += '<span class="price-month">' + fmt(listing.priceMonthly) + '<small style="font-size:.65em;font-weight:400;opacity:.7">/month</small></span>';
    priceHTML += '</div>';
  }

  var badges = [];
  if (listing.listingType === 'sale') badges.push('<span class="badge badge-sale">For Sale</span>');
  if (listing.featured) badges.push('<span class="badge badge-featured"><i data-lucide="star" aria-hidden="true" width="10" height="10" style="fill:currentColor;margin-right:3px"></i>Featured</span>');
  if (listing.status === 'unavailable') badges.push('<span class="badge badge-unavailable">Unavailable</span>');
  badges.push('<span class="badge badge-type">' + esc(listing.type || 'Property') + '</span>');

  return '<article class="listing-card" data-id="' + esc(listing.id) + '" style="animation-delay:' + (idx * 60) + 'ms" role="button" tabindex="0" aria-label="' + esc(listing.title) + '">' +
    '<div class="card-img-wrap">' +
    '<img src="' + esc(img) + '" alt="' + esc(listing.title) + '" loading="lazy" onerror="this.src=\'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=60\'">' +
    '<div class="card-badge-row">' + badges.join('') + '</div>' +
    '<button class="card-wishlist' + (savedIds.has(listing.id) ? ' active' : '') + '" aria-label="Save listing" data-wishlist="' + esc(listing.id) + '"><i data-lucide="heart" aria-hidden="true" width="15" height="15"' + (savedIds.has(listing.id) ? ' style="fill:currentColor"' : '') + '></i></button>' +
    '</div>' +
    '<div class="card-body">' +
    '<div class="card-meta">' +
    '<span class="community-dot" style="background:' + color + '"></span>' +
    '<span class="community-name">' + esc(community) + '</span>' +
    '</div>' +
    '<h3 class="card-title">' + esc(listing.title) + '</h3>' +
    '<div class="card-specs">' +
    '<span class="spec-item"><i data-lucide="bed-double" class="spec-icon" aria-hidden="true" width="14" height="14"></i>' + beds + ' bed' + (beds !== 1 ? 's' : '') + '</span>' +
    '<span class="spec-item"><i data-lucide="bath" class="spec-icon" aria-hidden="true" width="14" height="14"></i>' + baths + ' bath' + (baths !== 1 ? 's' : '') + '</span>' +
    (listing.maxGuests ? '<span class="spec-item"><i data-lucide="users" class="spec-icon" aria-hidden="true" width="14" height="14"></i>' + listing.maxGuests + ' guest' + (listing.maxGuests !== 1 ? 's' : '') + '</span>' : '') +
    (listing.petsAllowed ? '<span class="spec-item"><i data-lucide="paw-print" class="spec-icon" aria-hidden="true" width="14" height="14"></i>Pets OK</span>' : '') +
    '</div>' +
    '<div class="card-footer">' + priceHTML + '<span class="btn btn-sm btn-secondary">View →</span></div>' +
    '</div>' +
    '</article>';
}

// ─── Skeleton Cards ───────────────────────────────────────────────────────────

function skeletonHTML(count) {
  count = count || 6;
  var out = '';
  for (var i = 0; i < count; i++) {
    out += '<div class="listing-card" style="pointer-events:none">' +
      '<div class="card-img-wrap skeleton" style="height:220px;border-radius:0"></div>' +
      '<div class="card-body">' +
      '<div class="skeleton" style="height:12px;width:60%;border-radius:6px;margin-bottom:12px"></div>' +
      '<div class="skeleton" style="height:20px;width:80%;border-radius:6px;margin-bottom:16px"></div>' +
      '<div class="skeleton" style="height:12px;width:50%;border-radius:6px"></div>' +
      '</div></div>';
  }
  return out;
}

// ─── Render Listings Grid ─────────────────────────────────────────────────────

function renderListings(containerId) {
  containerId = containerId || 'listings-grid';
  var grid = document.getElementById(containerId);
  var countEl = document.getElementById('listings-count');
  var paginationEl = document.getElementById('pagination');
  if (!grid) return;

  var all = getListings();
  var filtered = applyFilters(all);
  var total = filtered.length;
  var totalPages = Math.ceil(total / PAGE_SIZE);
  var pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (countEl) countEl.textContent = total + ' ' + (total === 1 ? 'listing' : 'listings') + ' found';

  if (total === 0) {
    var emptyMsg, emptyIcon, extraBtn = '';
    if (all.length === 0) {
      emptyIcon = '<i data-lucide="alert-triangle" aria-hidden="true" width="48" height="48" style="stroke:var(--clay,#c06e3a)"></i>';
      emptyMsg = 'No active listings were found in the database. Make sure your listings have status set to <strong>active</strong> in the admin panel, or check that your Supabase project is running.';
    } else if (activeFilters.mode === 'short-term') {
      emptyIcon = '<i data-lucide="search-x" aria-hidden="true" width="48" height="48" style="stroke:var(--stone,#9e9589)"></i>';
      emptyMsg = 'No short-term rentals found. Try broadening your search, or explore all rental listings.';
      extraBtn = '<button class="btn btn-primary" style="margin-left:8px" onclick="window.activeFilters.mode=\'all\';window.currentPage=1;if(typeof window._syncFilterChip===\'function\')window._syncFilterChip(\'all\');renderListings()">Show all rentals</button>';
    } else if (activeFilters.mode === 'long-term') {
      emptyIcon = '<i data-lucide="search-x" aria-hidden="true" width="48" height="48" style="stroke:var(--stone,#9e9589)"></i>';
      emptyMsg = 'No long-term rentals found. Try broadening your search, or explore all rental listings.';
      extraBtn = '<button class="btn btn-primary" style="margin-left:8px" onclick="window.activeFilters.mode=\'all\';window.currentPage=1;if(typeof window._syncFilterChip===\'function\')window._syncFilterChip(\'all\');renderListings()">Show all rentals</button>';
    } else {
      emptyIcon = '<i data-lucide="leaf" aria-hidden="true" width="48" height="48" style="stroke:var(--stone,#9e9589)"></i>';
      emptyMsg = 'Try adjusting your filters or search to discover available properties.';
    }
    grid.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1">' +
      '<div class="empty-icon">' + emptyIcon + '</div>' +
      '<h3>No listings found</h3>' +
      '<p>' + emptyMsg + '</p>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
      '<button class="btn btn-secondary" onclick="clearFilters()">Clear filters</button>' +
      extraBtn +
      '</div>' +
      '</div>';
  } else {
    grid.innerHTML = pageItems.map(function (l, i) { return cardHTML(l, i); }).join('');

    $$('.listing-card', grid).forEach(function (card) {
      var open = function () { openListingModal(card.dataset.id); };
      card.addEventListener('click', open);
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
    });

    $$('.card-wishlist', grid).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleSaved(btn.dataset.wishlist, btn);
      });
    });
  }

  if (paginationEl) {
    if (totalPages <= 1) { paginationEl.innerHTML = ''; return; }
    var html = '';
    if (currentPage > 1) html += '<button class="page-btn" data-page="' + (currentPage - 1) + '">‹</button>';
    for (var p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1) {
        html += '<button class="page-btn' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
      } else if (Math.abs(p - currentPage) === 2) {
        html += '<span style="padding:0 4px;color:var(--stone)">…</span>';
      }
    }
    if (currentPage < totalPages) html += '<button class="page-btn" data-page="' + (currentPage + 1) + '">›</button>';
    paginationEl.innerHTML = html;
    $$('.page-btn', paginationEl).forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentPage = parseInt(btn.dataset.page);
        window.currentPage = currentPage;
        renderListings(containerId);
        grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.renderListings = renderListings;

// ─── Filter Controls ──────────────────────────────────────────────────────────

function initFilters() {
  $$('.mode-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $$('.mode-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      activeFilters.mode = chip.dataset.mode;
      currentPage = 1; window.currentPage = 1;
      renderListings();
    });
  });

  [
    ['#filter-community', 'community'],
    ['#filter-type', 'type'],
    ['#filter-beds', 'bedroomsMin'],
    ['#filter-price-min', 'priceMin'],
    ['#filter-price-max', 'priceMax'],
    ['#filter-sort', 'sort'],
  ].forEach(function (pair) {
    var el = document.querySelector(pair[0]);
    if (!el) return;
    el.addEventListener('change', function () {
      activeFilters[pair[1]] = el.value;
      window.activeFilters = activeFilters;
      currentPage = 1; window.currentPage = 1;
      renderListings();
    });
  });

  var searchInput = document.getElementById('listing-search');
  if (searchInput) {
    var t;
    searchInput.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        activeFilters.search = searchInput.value.trim();
        currentPage = 1; window.currentPage = 1;
        renderListings();
      }, 280);
    });
  }

  var heroSearchBtn = document.getElementById('hero-search-btn');
  if (heroSearchBtn) {
    heroSearchBtn.addEventListener('click', async function () {
      var comm = document.getElementById('hero-community');
      var type = document.getElementById('hero-type');
      var beds = document.getElementById('st-beds');
      var price = document.getElementById('st-price');
      var checkin = document.getElementById('st-checkin');
      var checkout = document.getElementById('st-checkout');
      activeFilters.mode = 'short-term';
      if (comm && comm.value) { activeFilters.community = comm.value; var s = document.getElementById('filter-community'); if (s) s.value = comm.value; }
      if (type && type.value) { activeFilters.type = type.value; var s = document.getElementById('filter-type'); if (s) s.value = type.value; }
      if (beds && beds.value) { activeFilters.bedroomsMin = beds.value; var s = document.getElementById('filter-beds'); if (s) s.value = beds.value; }
      if (price && price.value) { activeFilters.priceMax = price.value; var s = document.getElementById('filter-price-max'); if (s) s.value = price.value; }
      activeFilters.checkIn = checkin ? checkin.value : '';
      activeFilters.checkOut = checkout ? checkout.value : '';
      if (typeof window._syncFilterChip === 'function') window._syncFilterChip('short-term');

      window.availableListingIds = null;
      if (activeFilters.checkIn && activeFilters.checkOut) {
        var grid = document.getElementById('listings-grid');
        if (grid) grid.innerHTML = skeletonHTML(3);
        try {
          var ci = activeFilters.checkIn;
          var co = activeFilters.checkOut;
          var hdrs = { apikey: _MAIN_ANON, Accept: 'application/json' };
          var responses = await Promise.all([
            fetch(_MAIN_BASE + '/availability?start_date=lte.' + ci + '&end_date=gte.' + co + '&select=listing_id', { headers: hdrs }),
            fetch(_MAIN_BASE + '/bookings?status=eq.accepted&start_date=lt.' + co + '&end_date=gt.' + ci + '&select=listing_id', { headers: hdrs }),
            fetch(_MAIN_BASE + '/blocked_dates?start_date=lt.' + co + '&end_date=gt.' + ci + '&select=listing_id', { headers: hdrs }),
          ]);
          if (responses[0].ok && responses[1].ok) {
            var availRows = await responses[0].json();
            var bookRows = await responses[1].json();
            var blockedRows = responses[2].ok ? await responses[2].json() : [];
            if (availRows.length > 0) {
              var excludedIds = new Set([
                ...bookRows.map(function (r) { return r.listing_id; }),
                ...blockedRows.map(function (r) { return r.listing_id; }),
              ]);
              window.availableListingIds = new Set(
                availRows.map(function (r) { return r.listing_id; }).filter(function (id) { return !excludedIds.has(id); })
              );
            }
          }
        } catch (e) { /* silently ignore — show all listings if availability fetch fails */ }
      }

      currentPage = 1; window.currentPage = 1;
      renderListings();
      var section = document.getElementById('listings-section');
      if (section) section.scrollIntoView({ behavior: 'smooth' });
    });
  }

  var ltSearchBtn = document.getElementById('lt-search-btn');
  if (ltSearchBtn) {
    ltSearchBtn.addEventListener('click', function () {
      var comm = document.getElementById('lt-community');
      var priceFrom = document.getElementById('lt-price-from');
      var priceTo = document.getElementById('lt-price-to');
      var beds = document.getElementById('lt-beds');
      activeFilters.mode = 'long-term';
      activeFilters.community = comm ? comm.value : '';
      activeFilters.priceMin = priceFrom ? priceFrom.value : '';
      activeFilters.priceMax = priceTo ? priceTo.value : '';
      activeFilters.bedroomsMin = beds ? beds.value : '';
      activeFilters.checkIn = '';
      activeFilters.checkOut = '';
      var fc = document.getElementById('filter-community'); if (fc && comm) fc.value = comm.value;
      var fb = document.getElementById('filter-beds'); if (fb && beds) fb.value = beds.value;
      if (typeof window._syncFilterChip === 'function') window._syncFilterChip('long-term');
      currentPage = 1; window.currentPage = 1;
      renderListings();
      var section = document.getElementById('listings-section');
      if (section) section.scrollIntoView({ behavior: 'smooth' });
    });
  }

  var allSearchBtn = document.getElementById('all-search-btn');
  if (allSearchBtn) {
    allSearchBtn.addEventListener('click', function () {
      var heroInput = document.getElementById('listing-search-hero');
      activeFilters.mode = 'all';
      activeFilters.search = heroInput ? heroInput.value.trim() : '';
      activeFilters.checkIn = '';
      activeFilters.checkOut = '';
      var mainSearch = document.getElementById('listing-search');
      if (mainSearch && heroInput) mainSearch.value = heroInput.value;
      if (typeof window._syncFilterChip === 'function') window._syncFilterChip('all');
      currentPage = 1; window.currentPage = 1;
      renderListings();
      var section = document.getElementById('listings-section');
      if (section) section.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Auto-update checkout min when checkin changes, and set today as floor
  var stCheckin = document.getElementById('st-checkin');
  var stCheckout = document.getElementById('st-checkout');
  if (stCheckin && stCheckout) {
    var today = new Date().toISOString().split('T')[0];
    stCheckin.min = today;
    stCheckout.min = today;
    stCheckin.addEventListener('change', function () {
      if (!stCheckin.value) return;
      var d = new Date(stCheckin.value + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      var nextDay = d.toISOString().split('T')[0];
      stCheckout.min = nextDay;
      if (stCheckout.value && stCheckout.value <= stCheckin.value) {
        stCheckout.value = nextDay;
      }
    });
  }
}

window.clearFilters = function () {
  activeFilters = { mode: 'all', community: '', type: '', bedroomsMin: '', priceMin: '', priceMax: '', sort: 'newest', search: '', checkIn: '', checkOut: '' };
  window.activeFilters = activeFilters;
  window.availableListingIds = null;
  $$('.mode-chip').forEach(function (c, i) { c.classList.toggle('active', i === 0); });
  ['#filter-community', '#filter-type', '#filter-beds', '#filter-price-min', '#filter-price-max'].forEach(function (sel) {
    var el = document.querySelector(sel); if (el) el.value = '';
  });
  var si = document.getElementById('listing-search'); if (si) si.value = '';
  var ci = document.getElementById('st-checkin'); if (ci) ci.value = '';
  var co = document.getElementById('st-checkout'); if (co) co.value = '';
  currentPage = 1; window.currentPage = 1;
  renderListings();
};

window.filterByCommunity = function (communityId) {
  var sel = document.getElementById('filter-community');
  if (sel) sel.value = communityId;
  activeFilters.community = communityId;
  window.activeFilters = activeFilters;
  currentPage = 1; window.currentPage = 1;
  renderListings();
  var el = document.querySelector('.filter-bar');
  if (el) {
    var h = window.innerWidth > 768 ? 70 : 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - h, behavior: 'smooth' });
  }
};

// ─── Listing Detail Modal ─────────────────────────────────────────────────────

function openListingModal(id) {
  var listing = getListings().find(function (l) { return l.id === id; });
  if (!listing) return;

  var backdrop = document.getElementById('listing-modal-backdrop');
  var body = document.getElementById('listing-modal-body');
  var titleEl = document.getElementById('listing-modal-title');
  if (!backdrop || !body) return;

  if (titleEl) titleEl.textContent = listing.title;

  // Gallery — mosaic grid + lightbox
  var imgs = (listing.images || []).filter(Boolean);
  if (!imgs.length && listing.image) imgs.push(listing.image);
  if (!imgs.length) imgs.push('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80');

  window._galleryImgs = imgs;
  window._galleryIndex = 0;
  var galleryHTML = buildMosaicHTML(imgs);

  // Specs
  var isSale = listing.listingType === 'sale';
  var specs = [
    { icon: '<i data-lucide="map-pin" aria-hidden="true"></i>', label: communityName(listing.community) },
    { icon: '<i data-lucide="bed-double" aria-hidden="true"></i>', label: (listing.bedrooms || 0) + ' bed' + (listing.bedrooms !== 1 ? 's' : '') },
    { icon: '<i data-lucide="bath" aria-hidden="true"></i>', label: (listing.bathrooms || 0) + ' bath' + (listing.bathrooms !== 1 ? 's' : '') },
    listing.type ? { icon: '<i data-lucide="home" aria-hidden="true"></i>', label: listing.type } : null,
    isSale && listing.sqft ? { icon: '<i data-lucide="ruler" aria-hidden="true"></i>', label: Number(listing.sqft).toLocaleString() + ' sqft' } : null,
    listing.maxGuests ? { icon: '<i data-lucide="users" aria-hidden="true"></i>', label: listing.maxGuests + ' guest' + (listing.maxGuests !== 1 ? 's' : '') } : null,
    listing.petsAllowed ? { icon: '<i data-lucide="paw-print" aria-hidden="true"></i>', label: 'Pets welcome' } : null,
  ].filter(Boolean);
  var specsHTML = '<div class="detail-meta-row">' +
    specs.map(function (s) { return '<span class="detail-spec">' + s.icon + ' ' + esc(s.label) + '</span>'; }).join('') +
    '</div>';

  // Pricing
  var pricingHTML = '';
  if (isSale) {
    pricingHTML = '<div class="detail-pricing">' +
      '<div class="price-item"><label>Asking Price</label><div class="value">' +
      (listing.salePrice ? fmt(listing.salePrice) : '<span style="color:var(--clay);font-style:italic">Price on request</span>') +
      '</div></div>' +
      '</div>';
  } else if (listing.priceMonthly || listing.priceNightly) {
    pricingHTML = '<div class="detail-pricing">' +
      (listing.priceNightly ? '<div class="price-item"><label>Per night</label><div class="value">' + fmt(listing.priceNightly) + '</div></div>' : '') +
      (listing.priceMonthly ? '<div class="price-item"><label>Per month</label><div class="value">' + fmt(listing.priceMonthly) + '</div></div>' : '') +
      (listing.cleaningFee  ? '<div class="price-item"><label>Cleaning fee</label><div class="value">' + fmt(listing.cleaningFee)  + '</div></div>' : '') +
      '</div>';
  } else {
    pricingHTML = '<div class="detail-pricing"><div class="price-item" style="grid-column:1/-1"><label>Pricing</label><div class="value" style="color:var(--clay);font-style:italic">Price on application</div></div></div>';
  }

  // Amenities
  var amenities = listing.amenities || [];
  var amenHTML = amenities.length ?
    '<div style="margin-bottom:24px">' +
    '<div class="label-sm" style="color:var(--stone);margin-bottom:14px">Amenities & Features</div>' +
    '<div class="amenity-grid">' +
    amenities.map(function (a) { return '<div class="amenity-item"><i data-lucide="check" aria-hidden="true"></i>' + esc(a) + '</div>'; }).join('') +
    '</div>' +
    '</div>' : '';

  // Contact
  var contactHTML = '';
  if (listing.hostName || listing.contactEmail) {
    var initials = (listing.hostName || 'H').split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    contactHTML =
      '<div class="contact-box">' +
      '<div class="contact-avatar">' + esc(initials) + '</div>' +
      '<div class="contact-info">' +
      '<h4>' + esc(listing.hostName || 'Contact Host') + '</h4>' +
      (listing.contactEmail ? '<p>' + esc(listing.contactEmail) + '</p>' : '') +
      (listing.contactPhone ? '<p>' + esc(listing.contactPhone) + '</p>' : '') +
      '</div>' +
      '<div class="contact-actions">' +
      (listing.contactEmail ? '<a href="mailto:' + esc(listing.contactEmail) + '" class="btn btn-primary btn-sm">Email</a>' : '') +
      (listing.contactPhone ? '<a href="tel:' + esc(listing.contactPhone) + '" class="btn btn-ghost btn-sm">Call</a>' : '') +
      '</div>' +
      '</div>';
  }

  var availBadge = isSale
    ? '<span class="status-pill status-available" style="margin-bottom:16px;display:inline-block">For Sale</span>'
    : listing.status === 'active'
      ? '<span class="status-pill status-available" style="margin-bottom:16px;display:inline-block"><i data-lucide="check" aria-hidden="true" width="12" height="12" style="margin-right:3px"></i>Available</span>'
      : '<span class="status-pill status-unavailable" style="margin-bottom:16px;display:inline-block">Currently Unavailable</span>';

  var availSection = isSale ? '' :
    '<div id="modal-availability-section" style="margin-top:24px;margin-bottom:24px">' +
    '<button class="btn btn-secondary btn-full" id="check-availability-btn" onclick="toggleAvailability(\'' + esc(listing.id) + '\')">' +
    '<i data-lucide="calendar" aria-hidden="true" width="15" height="15" style="margin-right:6px"></i>Check Availability' +
    '</button>' +
    '<div id="availability-calendar-wrap" style="display:none;margin-top:16px"></div>' +
    '</div>';

  body.innerHTML = galleryHTML + specsHTML + availBadge + pricingHTML +
    (listing.description ? '<p class="detail-description">' + esc(listing.description) + '</p>' : '') +
    amenHTML +
    availSection +
    contactHTML;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Reset availability state when opening a new modal
  currentAvailListingId = null;
  availabilityLoaded = false;

  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeListingModal() {
  var backdrop = document.getElementById('listing-modal-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  document.body.style.overflow = '';
}

function initModal() {
  var backdrop = document.getElementById('listing-modal-backdrop');
  var closeBtn = document.getElementById('listing-modal-close');
  if (!backdrop) return;
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeListingModal(); });
  if (closeBtn) closeBtn.addEventListener('click', closeListingModal);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeListingModal(); });
}

// ─── Featured Listings ────────────────────────────────────────────────────────

function renderFeaturedListings() {
  var container = document.getElementById('featured-listings');
  if (!container) return;
  var featured = getListings().filter(function (l) { return l.featured; }).slice(0, 4);
  var items = featured.length ? featured : getListings().slice(0, 4);
  if (!items.length) return;
  container.innerHTML = items.map(function (l, i) { return cardHTML(l, i); }).join('');
  $$('.listing-card', container).forEach(function (card) {
    card.addEventListener('click', function () { openListingModal(card.dataset.id); });
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter') openListingModal(card.dataset.id); });
  });
  $$('.card-wishlist', container).forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleSaved(btn.dataset.wishlist, btn);
    });
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.renderFeaturedListings = renderFeaturedListings;

// ═══════════════════════════════════════════════════════════════
// AVAILABILITY CALENDAR
// ═══════════════════════════════════════════════════════════════

var currentAvailListingId = null;
var availabilityLoaded = false;

var calState = {
  listingId: null,
  minStay: 1,
  availWindows: [],
  bookedRanges: [],
  blockedRanges: [],
  checkIn: null,
  checkOut: null,
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
};

// ── Toggle ────────────────────────────────────────────────────
function toggleAvailability(listingId) {
  var wrap = document.getElementById('availability-calendar-wrap');
  var btn = document.getElementById('check-availability-btn');
  if (!wrap) return;

  var isOpen = wrap.style.display !== 'none';
  if (isOpen) {
    wrap.style.display = 'none';
    btn.innerHTML = '<i data-lucide="calendar" aria-hidden="true" width="15" height="15" style="margin-right:6px"></i>Check Availability';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } else {
    wrap.style.display = 'block';
    btn.innerHTML = '<i data-lucide="calendar-x" aria-hidden="true" width="15" height="15" style="margin-right:6px"></i>Hide Availability';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (currentAvailListingId !== listingId || !availabilityLoaded) {
      currentAvailListingId = listingId;
      availabilityLoaded = false;
      loadPublicAvailability(listingId);
    }
  }
}

// ── Load from Supabase ────────────────────────────────────────
async function loadPublicAvailability(listingId) {
  var wrap = document.getElementById('availability-calendar-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<p style="color:var(--stone);font-size:.875rem;padding:16px 0">Loading availability…</p>';

  try {
    var headers = { apikey: _MAIN_ANON, Accept: 'application/json' };

    var results = await Promise.all([
      fetch(_MAIN_BASE + '/availability?listing_id=eq.' + listingId + '&order=start_date.asc&select=*', { headers }),
      fetch(_MAIN_BASE + '/bookings?listing_id=eq.' + listingId + '&status=eq.accepted&select=start_date,end_date', { headers }),
      fetch(_MAIN_BASE + '/blocked_dates?listing_id=eq.' + listingId + '&select=start_date,end_date', { headers }),
    ]);

    if (!results[0].ok) throw new Error('Could not load availability');
    if (!results[1].ok) throw new Error('Could not load bookings');

    var windows = await results[0].json();
    var booked = await results[1].json();
    var blocked = results[2].ok ? await results[2].json() : [];
    var listing = (window.LISTINGS || []).find(function (l) { return l.id === listingId; });
    var now = new Date();

    calState.listingId = listingId;
    var dbMinStay = (listing && listing.minStayNights) || 1;
    var isLEV = listing && listing.community === 'la-ecovilla';
    calState.minStay = isLEV ? Math.max(dbMinStay, 7) : dbMinStay;
    calState.availWindows = windows;
    calState.bookedRanges = booked;
    calState.blockedRanges = blocked;
    calState.checkIn = null;
    calState.checkOut = null;
    calState.viewYear = now.getFullYear();
    calState.viewMonth = now.getMonth();

    availabilityLoaded = true;
    renderCalendar();

  } catch (err) {
    var w = document.getElementById('availability-calendar-wrap');
    if (w) w.innerHTML = '<p style="color:#b91c1c;font-size:.875rem;padding:16px 0">Could not load availability. Please try again.</p>';
  }
}

// ── Render calendar ───────────────────────────────────────────
function renderCalendar() {
  var wrap = document.getElementById('availability-calendar-wrap');
  if (!wrap) return;

  if (!calState.availWindows.length) {
    wrap.innerHTML = '<p style="color:var(--stone);font-size:.875rem;padding:16px 0">No availability set for this property yet. Contact the host directly.</p>';
    return;
  }

  var year = calState.viewYear;
  var month = calState.viewMonth;
  var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var firstDay = new Date(year, month, 1);
  var lastDay = new Date(year, month + 1, 0);
  var startDow = firstDay.getDay();
  var today = new Date(); today.setHours(0, 0, 0, 0);

  var html = '<div style="font-family:var(--font-body,sans-serif);padding:4px 0">';

  // Min stay note
  if (calState.minStay > 1) {
    html += '<p style="font-size:.78rem;color:var(--stone);margin-bottom:10px;text-align:center">⏱ Minimum stay: ' + calState.minStay + ' night' + (calState.minStay !== 1 ? 's' : '') + '</p>';
  }

  // Nav header
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
    '<button onclick="calPrev()" ' + (!canGoPrev() ? 'disabled ' : '') +
    'style="border:none;background:none;cursor:' + (canGoPrev() ? 'pointer' : 'default') + ';font-size:1.2rem;padding:4px 10px;border-radius:8px;color:var(--charcoal,#2a2520);opacity:' + (canGoPrev() ? '1' : '0.3') + '">‹</button>' +
    '<span style="font-weight:600;font-size:.95rem">' + monthNames[month] + ' ' + year + '</span>' +
    '<button onclick="calNext()" style="border:none;background:none;cursor:pointer;font-size:1.2rem;padding:4px 10px;border-radius:8px;color:var(--charcoal,#2a2520)">›</button>' +
    '</div>';

  // Day headers
  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px">';
  dayNames.forEach(function (d) {
    html += '<div style="text-align:center;font-size:.7rem;font-weight:600;color:var(--stone,#9e9589);padding:4px 0">' + d + '</div>';
  });
  html += '</div>';

  // Day cells
  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">';
  for (var i = 0; i < startDow; i++) html += '<div></div>';

  for (var d = 1; d <= lastDay.getDate(); d++) {
    var date = new Date(year, month, d); date.setHours(0, 0, 0, 0);
    var ymd = toCalYMD(date);
    var state = getDayState(date, ymd, today);

    var bg = 'transparent', color = 'var(--charcoal,#2a2520)', cursor = 'default';
    var border = '1px solid transparent', fontWeight = '400', opacity = '1';

    if (state === 'past' || state === 'unavailable' || state === 'booked' || state === 'minstay') {
      color = '#bbb'; opacity = state === 'minstay' ? '0.5' : '1';
    } else if (state === 'checkin' || state === 'checkout') {
      bg = 'var(--forest,#1f3b2f)'; color = 'white'; fontWeight = '600';
      border = '1px solid var(--forest,#1f3b2f)'; cursor = 'pointer';
    } else if (state === 'inrange') {
      bg = 'rgba(31,59,47,.12)'; cursor = 'pointer';
    } else {
      // available
      border = '1px solid var(--parchment,#ede5d8)'; cursor = 'pointer';
    }

    var onclick = '';
    if (state === 'available' || state === 'checkin' || state === 'checkout' || state === 'inrange') {
      onclick = 'onclick="calSelectDay(\'' + ymd + '\')"';
    }

    html += '<div ' + onclick + ' style="text-align:center;padding:8px 2px;border-radius:8px;' +
      'font-size:.85rem;cursor:' + cursor + ';background:' + bg + ';color:' + color + ';' +
      'border:' + border + ';font-weight:' + fontWeight + ';opacity:' + opacity + ';' +
      'transition:background .15s ease;user-select:none">' + d + '</div>';
  }
  html += '</div>'; // grid

  // Selected dates summary
  if (calState.checkIn) {
    html += '<div style="margin-top:16px;padding:14px 16px;background:var(--cream,#f7f3eb);border-radius:12px;font-size:.875rem">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
      '<span style="color:var(--stone)">Check-in</span><strong>' + fmtAvailDate(calState.checkIn) + '</strong>' +
      '</div>';
    if (calState.checkOut) {
      var nights = Math.round((new Date(calState.checkOut) - new Date(calState.checkIn)) / 86400000);
      var listing = (window.LISTINGS || []).find(function (l) { return l.id === calState.listingId; });
      var fmtMoney = function(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
      var feeRows = '';
      var subtotal = 0;

      if (listing && listing.poa) {
        feeRows = '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">Price</span><span>Price on application</span></div>';
      } else if (listing) {
        if (nights >= 28 && listing.priceMonthly) {
          subtotal = Math.round(listing.priceMonthly * (nights / 30));
          var months = Math.round((nights / 30) * 10) / 10;
          feeRows += '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">' + months + ' month' + (months !== 1 ? 's' : '') + ' × ' + fmtMoney(listing.priceMonthly) + '</span><span>' + fmtMoney(subtotal) + '</span></div>';
        } else if (listing.priceNightly) {
          subtotal = nights * listing.priceNightly;
          feeRows += '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">' + nights + ' night' + (nights !== 1 ? 's' : '') + ' × ' + fmtMoney(listing.priceNightly) + '</span><span>' + fmtMoney(subtotal) + '</span></div>';
        } else if (listing.priceMonthly) {
          subtotal = Math.round(listing.priceMonthly * (nights / 30));
          var months = Math.round((nights / 30) * 10) / 10;
          feeRows += '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">' + months + ' month' + (months !== 1 ? 's' : '') + ' × ' + fmtMoney(listing.priceMonthly) + '</span><span>' + fmtMoney(subtotal) + '</span></div>';
        }

        if (subtotal > 0) {
          var cleaning = listing.cleaningFee || 0;
          var deposit  = listing.securityDeposit || 0;
          var GIVEBACK_RATE  = 2;  // both communities
          var PLATFORM_RATE  = 4;  // both communities
          var commissionable = subtotal + cleaning;
          var communityFee   = Math.round(commissionable * GIVEBACK_RATE  / 100);
          var platformFee    = Math.round(commissionable * PLATFORM_RATE  / 100);
          var grandTotal     = subtotal + cleaning + deposit + communityFee + platformFee;

          if (cleaning > 0) feeRows += '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">Cleaning fee</span><span>' + fmtMoney(cleaning) + '</span></div>';
          if (deposit  > 0) feeRows += '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">Security deposit <em style="font-size:.75rem">(refundable)</em></span><span>' + fmtMoney(deposit) + '</span></div>';
          feeRows += '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">Community give back (' + GIVEBACK_RATE + '%)</span><span>' + fmtMoney(communityFee) + '</span></div>';
          feeRows += '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">Ecovilla Rentals platform fee (' + PLATFORM_RATE + '%)</span><span>' + fmtMoney(platformFee) + '</span></div>';
          feeRows += '<div style="display:flex;justify-content:space-between;padding-top:8px;margin-top:4px;border-top:1px solid var(--parchment,#ede5d8);font-weight:700"><span>Total</span><span style="color:var(--forest,#2d4a38)">' + fmtMoney(grandTotal) + ' USD</span></div>';
        }
      }

      html +=
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
        '<span style="color:var(--stone)">Check-out</span><strong>' + fmtAvailDate(calState.checkOut) + '</strong>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
        '<span style="color:var(--stone)">Duration</span><strong>' + nights + ' night' + (nights !== 1 ? 's' : '') + '</strong>' +
        '</div>' +
        (feeRows ? '<div style="padding-top:10px;margin-top:4px;margin-bottom:16px;border-top:1px solid var(--parchment,#ede5d8);font-size:.875rem">' + feeRows + '</div>' : '<div style="margin-bottom:16px"></div>') +
        (listing && window._currentUser && listing.ownerId === window._currentUser.id
          ? '<p style="text-align:center;color:var(--stone);font-size:.85rem;padding:10px 0">This is your listing — you cannot book it.</p>'
          : '<textarea id="booking-message" placeholder="Add a message to the host (optional)…" ' +
            'style="width:100%;padding:12px 14px;border:1.5px solid var(--parchment,#ede5d8);' +
            'border-radius:12px;font-size:.875rem;resize:vertical;min-height:80px;font-family:inherit;margin-bottom:10px;box-sizing:border-box"></textarea>' +
            '<button onclick="submitBookingRequest()" style="width:100%;padding:14px;border-radius:12px;font-size:.95rem;' +
            'background:var(--forest,#1f3b2f);color:white;border:none;cursor:pointer;font-weight:600">' +
            'Request Booking' +
            '</button>');
    } else {
      html += '<p style="color:var(--stone);font-size:.8rem;margin-top:4px">Now select your check-out date</p>';
    }
    html += '</div>';
  } else {
    html += '<p style="color:var(--stone);font-size:.8rem;margin-top:12px;text-align:center">Select your check-in date</p>';
  }

  html += '</div>'; // outer
  wrap.innerHTML = html;
}

// ── Day state ─────────────────────────────────────────────────
function getDayState(date, ymd, today) {
  if (date < today) return 'past';
  if (calState.checkIn && ymd === calState.checkIn) return 'checkin';
  if (calState.checkOut && ymd === calState.checkOut) return 'checkout';
  if (calState.checkIn && calState.checkOut && ymd > calState.checkIn && ymd < calState.checkOut) return 'inrange';

  var isBooked = calState.bookedRanges.some(function (b) { return ymd >= b.start_date && ymd < b.end_date; });
  if (isBooked) return 'booked';

  var isBlocked = calState.blockedRanges.some(function (b) { return ymd >= b.start_date && ymd < b.end_date; });
  if (isBlocked) return 'booked';

  var isAvail = calState.availWindows.some(function (w) { return ymd >= w.start_date && ymd < w.end_date; });
  if (!isAvail) return 'unavailable';

  if (calState.checkIn && !calState.checkOut) {
    var diff = Math.round((date - new Date(calState.checkIn)) / 86400000);
    if (diff > 0 && diff < calState.minStay) return 'minstay';
  }

  return 'available';
}

// ── Navigation ────────────────────────────────────────────────
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

// ── Date selection ────────────────────────────────────────────
function calSelectDay(ymd) {
  if (!calState.checkIn || (calState.checkIn && calState.checkOut)) {
    calState.checkIn = ymd; calState.checkOut = null;
    renderCalendar(); return;
  }
  if (ymd <= calState.checkIn) {
    calState.checkIn = ymd; calState.checkOut = null;
    renderCalendar(); return;
  }

  // Validate range — no booked or unavailable dates within
  var valid = true;
  var cursor = new Date(calState.checkIn); cursor.setDate(cursor.getDate() + 1);
  var end = new Date(ymd);
  while (cursor <= end) {
    var cymd = toCalYMD(cursor);
    var blocked = calState.bookedRanges.some(function (b) { return cymd >= b.start_date && cymd < b.end_date; });
    var avail = calState.availWindows.some(function (w) { return cymd >= w.start_date && cymd < w.end_date; });
    if (blocked || !avail) { valid = false; break; }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (!valid) {
    calState.checkIn = ymd; calState.checkOut = null;
  } else {
    calState.checkOut = ymd;
  }
  renderCalendar();
}

// ── Booking request ───────────────────────────────────────────
async function submitBookingRequest() {
  var listing = (window.LISTINGS || []).find(function (l) { return l.id === calState.listingId; });
  if (listing && window._currentUser && listing.ownerId === window._currentUser.id) {
    showToast('You cannot book your own listing.', 'error');
    return;
  }

  var session = await Auth.getSession();

  if (!session) {
    sessionStorage.setItem('pendingBooking', JSON.stringify({
      listingId: calState.listingId,
      checkIn: calState.checkIn,
      checkOut: calState.checkOut,
    }));
    window.location.href = 'login.html?redirect=booking';
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
    // 1. Create the booking
    var res = await fetch(_MAIN_BASE + '/bookings', {
      method: 'POST',
      headers: {
        apikey: _MAIN_ANON,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        listing_id: calState.listingId,
        requester_id: requesterId,
        start_date: calState.checkIn,
        end_date: calState.checkOut,
        message: message || null,
        status: 'pending',
      }),
    });

    if (!res.ok) throw new Error(await res.text());
    var bookingRows = await res.json();
    var booking = Array.isArray(bookingRows) ? bookingRows[0] : bookingRows;

    // 2. Look up the listing owner (host) so we can create the conversation
    var listingRes = await fetch(_MAIN_BASE + '/listings?id=eq.' + calState.listingId + '&select=owner_id', {
      headers: { apikey: _MAIN_ANON, Authorization: 'Bearer ' + token, Accept: 'application/json' },
    });
    var listingRows = listingRes.ok ? await listingRes.json() : [];
    var hostId = listingRows[0] ? listingRows[0].owner_id : null;

    // 3. Create the conversation (upsert-style: only create if one doesn't exist yet)
    if (hostId && booking) {
      var existingConvRes = await fetch(
        _MAIN_BASE + '/conversations?listing_id=eq.' + calState.listingId + '&user_id=eq.' + requesterId + '&select=id&limit=1',
        { headers: { apikey: _MAIN_ANON, Authorization: 'Bearer ' + token, Accept: 'application/json' } }
      );
      var existingConvs = existingConvRes.ok ? await existingConvRes.json() : [];
      var convId = existingConvs[0] ? existingConvs[0].id : null;

      if (!convId) {
        var convRes = await fetch(_MAIN_BASE + '/conversations', {
          method: 'POST',
          headers: {
            apikey: _MAIN_ANON,
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            listing_id: calState.listingId,
            host_id: hostId,
            user_id: requesterId,
            booking_id: booking.id,
          }),
        });
        if (convRes.ok) {
          var convRows = await convRes.json();
          convId = (Array.isArray(convRows) ? convRows[0] : convRows).id;
        }
      }

      // 4. Post the guest's opening message if they wrote one
      if (convId && message) {
        await fetch(_MAIN_BASE + '/messages', {
          method: 'POST',
          headers: {
            apikey: _MAIN_ANON,
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            conversation_id: convId,
            sender_id: requesterId,
            body: message,
          }),
        });
      }
    }

    var wrap = document.getElementById('availability-calendar-wrap');
    if (wrap) {
      wrap.innerHTML =
        '<div style="text-align:center;padding:28px 16px">' +
        '<div style="font-size:2.5rem;margin-bottom:12px">🌿</div>' +
        '<h3 style="font-family:var(--font-display,serif);font-size:1.4rem;margin-bottom:8px">Request Sent!</h3>' +
        '<p style="color:var(--stone);font-size:.875rem;line-height:1.6">' +
        'Your booking request for <strong>' + fmtAvailDate(calState.checkIn) + ' → ' + fmtAvailDate(calState.checkOut) + '</strong> has been sent to the host.<br>' +
        'You\'ll receive a response shortly.' +
        '</p>' +
        '</div>';
    }

  } catch (err) {
    console.error('[Booking] error:', err);
    showToast('Could not send booking request. Please try again.', 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Request Booking'; }
  }
}

// ── Date helpers ──────────────────────────────────────────────
function toCalYMD(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function fmtAvailDate(str) {
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var parts = str.split('-');
  return parseInt(parts[2]) + ' ' + months[parseInt(parts[1]) - 1] + ' ' + parts[0];
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  // Load current user so we can block owners from booking their own listings
  Auth.getUser().then(function (u) { window._currentUser = u || null; }).catch(function () {});

  initNav();
  initSearchTabs();
  initModal();
  initFilters();
  initScrollAnimations();

  var grid = document.getElementById('listings-grid');
  var featuredGrid = document.getElementById('featured-listings');
  var countEl = document.getElementById('listings-count');

  if (grid) grid.innerHTML = skeletonHTML(6);
  if (featuredGrid) featuredGrid.innerHTML = skeletonHTML(3);
  if (countEl) countEl.textContent = 'Loading…';

  var dataReady = window.LISTINGS_PROMISE || Promise.resolve(window.LISTINGS || []);
  Promise.all([dataReady, loadSavedIds()]).then(function () {
    renderListings();
    renderFeaturedListings();
    initScrollAnimations();

    // Check for pending booking after login redirect
    var pending = sessionStorage.getItem('pendingBooking');
    var urlParams = new URLSearchParams(window.location.search);
    if (pending && urlParams.get('redirect') === 'booking') {
      try {
        var pb = JSON.parse(pending);
        sessionStorage.removeItem('pendingBooking');
        // Wait for listings to load, then open modal and restore dates
        var waitForListings = function () {
          var listing = (window.LISTINGS || []).find(function (l) { return l.id === pb.listingId; });
          if (!listing) {
            setTimeout(waitForListings, 150);
            return;
          }
          openListingModal(pb.listingId);
          setTimeout(function () {
            // Load availability then restore dates
            currentAvailListingId = pb.listingId;
            availabilityLoaded = false;
            loadPublicAvailability(pb.listingId).then(function () {
              calState.checkIn = pb.checkIn;
              calState.checkOut = pb.checkOut;
              // Show the calendar section
              var wrap = document.getElementById('availability-calendar-wrap');
              var btn = document.getElementById('check-availability-btn');
              if (wrap) wrap.style.display = 'block';
              if (btn) btn.textContent = '📅 Hide Availability';
              renderCalendar();
            });
          }, 300);
        };
        waitForListings();
      } catch (e) { console.error('[Booking restore] error:', e); }
    }
  }).catch(function (err) {
    console.error('[ValleVivo] Data load error:', err);
    if (grid) grid.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1">' +
      '<div class="empty-icon">⚠️</div>' +
      '<h3>Could not load listings</h3>' +
      '<p>Check your Supabase connection in js/data.js</p>' +
      '</div>';
    if (countEl) countEl.textContent = '0 listings found';
  });
});