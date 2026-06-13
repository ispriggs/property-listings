// ============================================================
// js/pages/main.js — Home page (index.html) entry point
// ES module
// ============================================================
import { Auth } from '../lib/auth.js';
import { ListingsAPI } from '../lib/api.js';
import { SavedAPI } from '../api/saved.js';
import { AvailabilityAPI } from '../api/availability.js';
import { BookingsAPI } from '../api/bookings.js';
import { ConversationsAPI } from '../api/conversations.js';
import { $, $$, esc, fmt, clImg, showToast, communityName, communityColor, fmtAvailDate, toCalYMD } from '../lib/utils.js';
import { initNav } from '../components/nav.js';

'use strict';

// ─── Saved / Favourites ───────────────────────────────────────────────────────

let savedIds = new Set();

async function loadSavedIds() {
  try {
    savedIds = await SavedAPI.getIds();
  } catch (_) {}
}

async function toggleSaved(listingId, btn) {
  const session = await Auth.getSession();
  if (!session) { window.location.href = 'pages/login.html'; return; }
  const isSaved = savedIds.has(listingId);
  try {
    if (isSaved) {
      await SavedAPI.remove(listingId);
      savedIds.delete(listingId);
      btn.classList.remove('active');
      btn.innerHTML = '<i data-lucide="heart" aria-hidden="true" width="15" height="15"></i>';
    } else {
      await SavedAPI.save(listingId);
      savedIds.add(listingId);
      btn.classList.add('active');
      btn.innerHTML = '<i data-lucide="heart" aria-hidden="true" width="15" height="15" style="fill:currentColor"></i>';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (_) { showToast('Could not update saved listings. Please try again.', 'error'); }
}

// ── Photo Mosaic ───────────────────────────────────────────────────────────────

function buildMosaicHTML(imgs) {
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
  let html = `<div class="photo-mosaic photo-mosaic-${visible}">`;
  for (let i = 0; i < visible; i++) {
    html += `<div class="mosaic-cell${i === 0 ? ' mosaic-main' : ''}">`;
    html += `<img src="${esc(clImg(imgs[i], i === 0 ? 1200 : 700))}" class="mosaic-img" alt=""${i > 0 ? ' loading="lazy"' : ''} onclick="openLightbox(${i})">`;
    if (i === visible - 1 && count > visible) {
      html += `<button class="mosaic-show-all" onclick="event.stopPropagation();openLightbox(${i})">Show all ${count} photos</button>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return mobileHTML + html;
}

// ── Lightbox ───────────────────────────────────────────────────────────────────

function _getLightbox() {
  let lb = document.getElementById('photo-lightbox');
  if (lb) return lb;
  lb = document.createElement('div');
  lb.id = 'photo-lightbox';
  lb.className = 'photo-lightbox';
  lb.innerHTML =
    '<div class="lightbox-header"><span class="lightbox-counter" id="lightbox-counter"></span>' +
    '<button class="lightbox-close" aria-label="Close" onclick="closeLightbox()">&#215;</button></div>' +
    '<div class="lightbox-body">' +
    '<button class="lightbox-nav prev" aria-label="Previous photo" onclick="lightboxStep(-1)">&#8249;</button>' +
    '<div class="lightbox-img-wrap"><img id="lightbox-img" class="lightbox-img" alt=""></div>' +
    '<button class="lightbox-nav next" aria-label="Next photo" onclick="lightboxStep(1)">&#8250;</button></div>';
  document.body.appendChild(lb);
  document.addEventListener('keydown', e => {
    if (!document.getElementById('photo-lightbox')?.classList.contains('open')) return;
    if (e.key === 'ArrowLeft')  lightboxStep(-1);
    else if (e.key === 'ArrowRight') lightboxStep(1);
    else if (e.key === 'Escape') closeLightbox();
  });
  let _tx = 0;
  lb.addEventListener('touchstart', e => { _tx = e.changedTouches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _tx;
    if (Math.abs(dx) > 50) lightboxStep(dx < 0 ? 1 : -1);
  }, { passive: true });
  return lb;
}

function _updateLightbox() {
  const imgs = window._galleryImgs || [], idx = window._galleryIndex || 0;
  const img = document.getElementById('lightbox-img');
  const counter = document.getElementById('lightbox-counter');
  const lb = document.getElementById('photo-lightbox');
  if (img) img.src = clImg(imgs[idx] || '', 1600);
  if (counter) counter.textContent = `${idx + 1} / ${imgs.length}`;
  if (lb) {
    const show = imgs.length > 1 ? '' : 'none';
    const prev = lb.querySelector('.lightbox-nav.prev');
    const next = lb.querySelector('.lightbox-nav.next');
    if (prev) prev.style.display = show;
    if (next) next.style.display = show;
  }
}

function openLightbox(startIndex) {
  const imgs = window._galleryImgs || [];
  if (!imgs.length) return;
  _getLightbox();
  window._galleryIndex = startIndex || 0;
  _updateLightbox();
  document.getElementById('photo-lightbox').classList.add('open');
}

function lightboxStep(dir) {
  const imgs = window._galleryImgs || [];
  window._galleryIndex = ((window._galleryIndex || 0) + dir + imgs.length) % imgs.length;
  _updateLightbox();
}

function closeLightbox() {
  document.getElementById('photo-lightbox')?.classList.remove('open');
}

// ─── Listings State & Filters ─────────────────────────────────────────────────

const PAGE_SIZE = 12;
let visibleCount = PAGE_SIZE;
let activeFilters = { mode: 'all', community: '', type: '', bedroomsMin: '', priceMin: '', priceMax: '', sort: 'newest', search: '', checkIn: '', checkOut: '' };

window.activeFilters  = activeFilters;
window._resetVisible  = () => { visibleCount = PAGE_SIZE; };

function getListings() { return window.LISTINGS || []; }

function applyFilters(listings) {
  let result = listings.slice();
  if (activeFilters.mode === 'for-sale') {
    result = result.filter(l => l.listingType === 'sale');
    if (activeFilters.priceMin) { const v = parseFloat(activeFilters.priceMin); result = result.filter(l => l.salePrice && l.salePrice >= v); }
    if (activeFilters.priceMax) { const v = parseFloat(activeFilters.priceMax); result = result.filter(l => l.salePrice && l.salePrice <= v); }
  } else {
    result = result.filter(l => l.listingType !== 'sale');
    if (activeFilters.mode === 'short-term') result = result.filter(l => l.priceNightly);
    else if (activeFilters.mode === 'long-term') result = result.filter(l => l.priceMonthly);
    if (activeFilters.priceMin) { const v = parseFloat(activeFilters.priceMin); result = result.filter(l => { const p = l.priceMonthly || l.priceNightly; return p && p >= v; }); }
    if (activeFilters.priceMax) { const v = parseFloat(activeFilters.priceMax); result = result.filter(l => { const p = l.priceMonthly || l.priceNightly; return p && p <= v; }); }
  }
  if (activeFilters.community) result = result.filter(l => l.community === activeFilters.community);
  if (activeFilters.type) result = result.filter(l => l.type === activeFilters.type);
  if (activeFilters.bedroomsMin) result = result.filter(l => l.bedrooms >= parseInt(activeFilters.bedroomsMin));
  if (activeFilters.search) {
    const q = activeFilters.search.toLowerCase();
    result = result.filter(l => l.title.toLowerCase().includes(q) || (l.description || '').toLowerCase().includes(q) || communityName(l.community).toLowerCase().includes(q) || (l.type || '').toLowerCase().includes(q));
  }
  if (activeFilters.checkIn && activeFilters.checkOut && window.availableListingIds != null) {
    result = result.filter(l => window.availableListingIds.has(l.id));
  }
  switch (activeFilters.sort) {
    case 'price-high': result.sort((a, b) => (b.priceMonthly || b.priceNightly || 0) - (a.priceMonthly || a.priceNightly || 0)); break;
    case 'price-low':  result.sort((a, b) => (a.priceMonthly || a.priceNightly || 0) - (b.priceMonthly || b.priceNightly || 0)); break;
    case 'newest':     result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); break;
    case 'oldest':     result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
    case 'az':         result.sort((a, b) => a.title.localeCompare(b.title)); break;
    case 'za':         result.sort((a, b) => b.title.localeCompare(a.title)); break;
  }
  return result;
}

// ─── Card HTML ────────────────────────────────────────────────────────────────

function cardHTML(listing, idx) {
  const community = communityName(listing.community);
  const color     = communityColor(listing.community);
  const img       = clImg((listing.images || [])[0] || listing.image || 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80', 600);
  const beds      = listing.bedrooms  || 0;
  const baths     = listing.bathrooms || 0;

  let priceHTML = '';
  if (listing.listingType === 'sale') {
    priceHTML = listing.salePrice ? `<span class="price-sale">${fmt(listing.salePrice)}</span>` : '<span class="price-poa">Price on request</span>';
  } else if (!listing.priceMonthly && !listing.priceNightly) {
    priceHTML = '<span class="price-poa">Price on request</span>';
  } else {
    priceHTML = '<div class="price-stack">';
    if (listing.priceNightly) priceHTML += `<span class="price-night">${fmt(listing.priceNightly)}<small style="font-size:.65em;font-weight:400;opacity:.7">/night</small></span>`;
    if (listing.priceMonthly) priceHTML += `<span class="price-month">${fmt(listing.priceMonthly)}<small style="font-size:.65em;font-weight:400;opacity:.7">/month</small></span>`;
    priceHTML += '</div>';
  }

  const badges = [];
  if (listing.listingType === 'sale') badges.push('<span class="badge badge-sale">For Sale</span>');
  if (listing.featured)  badges.push('<span class="badge badge-featured"><i data-lucide="star" aria-hidden="true" width="10" height="10" style="fill:currentColor;margin-right:3px"></i>Certified</span>');
  if (listing.status === 'unavailable') badges.push('<span class="badge badge-unavailable">Unavailable</span>');
  badges.push(`<span class="badge badge-type">${esc(listing.type || 'Property')}</span>`);

  return `<article class="listing-card" data-id="${esc(listing.id)}" style="animation-delay:${idx * 60}ms" role="button" tabindex="0" aria-label="${esc(listing.title)}">
    <div class="card-img-wrap">
      <img src="${esc(img)}" alt="${esc(listing.title)}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=60'">
      <div class="card-badge-row">${badges.join('')}</div>
      <button class="card-wishlist${savedIds.has(listing.id) ? ' active' : ''}" aria-label="Save listing" data-wishlist="${esc(listing.id)}">
        <i data-lucide="heart" aria-hidden="true" width="15" height="15"${savedIds.has(listing.id) ? ' style="fill:currentColor"' : ''}></i>
      </button>
    </div>
    <div class="card-body">
      <div class="card-meta"><span class="community-dot" style="background:${color}"></span><span class="community-name">${esc(community)}</span></div>
      <h3 class="card-title">${esc(listing.title)}</h3>
      <div class="card-specs">
        <span class="spec-item"><i data-lucide="bed-double" class="spec-icon" aria-hidden="true" width="14" height="14"></i>${beds} bed${beds !== 1 ? 's' : ''}</span>
        <span class="spec-item"><i data-lucide="bath" class="spec-icon" aria-hidden="true" width="14" height="14"></i>${baths} bath${baths !== 1 ? 's' : ''}</span>
        ${listing.maxGuests ? `<span class="spec-item"><i data-lucide="users" class="spec-icon" aria-hidden="true" width="14" height="14"></i>${listing.maxGuests} guest${listing.maxGuests !== 1 ? 's' : ''}</span>` : ''}
        ${listing.petsAllowed ? '<span class="spec-item"><i data-lucide="paw-print" class="spec-icon" aria-hidden="true" width="14" height="14"></i>Pets OK</span>' : ''}
      </div>
      <div class="card-footer">${priceHTML}<span class="btn btn-sm btn-secondary">View →</span></div>
    </div>
  </article>`;
}

function skeletonHTML(count = 6) {
  let out = '';
  for (let i = 0; i < count; i++) {
    out += '<div class="listing-card" style="pointer-events:none"><div class="card-img-wrap skeleton" style="height:220px;border-radius:0"></div><div class="card-body"><div class="skeleton" style="height:12px;width:60%;border-radius:6px;margin-bottom:12px"></div><div class="skeleton" style="height:20px;width:80%;border-radius:6px;margin-bottom:16px"></div><div class="skeleton" style="height:12px;width:50%;border-radius:6px"></div></div></div>';
  }
  return out;
}

// ─── Render Listings Grid ─────────────────────────────────────────────────────

function _wireCard(card) {
  if (card.dataset.wired) return;
  card.dataset.wired = '1';
  const go = () => { window.location.href = 'pages/listing.html?id=' + encodeURIComponent(card.dataset.id); };
  card.addEventListener('click', go);
  card.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  const btn = card.querySelector('.card-wishlist');
  if (btn) btn.addEventListener('click', e => { e.stopPropagation(); toggleSaved(btn.dataset.wishlist, btn); });
}

function renderListings(containerId = 'listings-grid', append = false) {
  const grid        = document.getElementById(containerId);
  const countEl     = document.getElementById('listings-count');
  const loadMoreWrap = document.getElementById('load-more-wrap');
  if (!grid) return;

  const all      = getListings();
  const filtered = applyFilters(all);
  const total    = filtered.length;

  if (countEl) countEl.textContent = `${total} ${total === 1 ? 'listing' : 'listings'} found`;

  if (total === 0) {
    let emptyMsg, emptyIcon, extraBtn = '';
    if (all.length === 0) {
      emptyIcon = '<i data-lucide="alert-triangle" aria-hidden="true" width="48" height="48" style="stroke:var(--clay)"></i>';
      emptyMsg  = 'No active listings were found. Make sure your listings have status <strong>active</strong> in the admin panel.';
    } else if (activeFilters.mode === 'short-term' || activeFilters.mode === 'long-term') {
      emptyIcon = '<i data-lucide="search-x" aria-hidden="true" width="48" height="48" style="stroke:var(--stone)"></i>';
      emptyMsg  = `No ${activeFilters.mode.replace('-', ' ')} rentals found. Try broadening your search.`;
      extraBtn  = `<button class="btn btn-primary" style="margin-left:8px" onclick="window.activeFilters.mode='all';if(window._resetVisible)window._resetVisible();if(typeof window._syncFilterChip==='function')window._syncFilterChip('all');renderListings()">Show all rentals</button>`;
    } else {
      emptyIcon = '<i data-lucide="leaf" aria-hidden="true" width="48" height="48" style="stroke:var(--stone)"></i>';
      emptyMsg  = 'Try adjusting your filters or search to discover available properties.';
    }
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">${emptyIcon}</div><h3>No listings found</h3><p>${emptyMsg}</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn btn-secondary" onclick="clearFilters()">Clear filters</button>${extraBtn}</div></div>`;
    if (loadMoreWrap) loadMoreWrap.innerHTML = '';
  } else if (append) {
    const start = visibleCount - PAGE_SIZE;
    filtered.slice(start, visibleCount).forEach((l, i) => {
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHTML(l, start + i);
      const card = tmp.firstElementChild;
      _wireCard(card);
      grid.appendChild(card);
    });
  } else {
    grid.innerHTML = filtered.slice(0, visibleCount).map((l, i) => cardHTML(l, i)).join('');
    $$('.listing-card', grid).forEach(card => _wireCard(card));
  }

  if (loadMoreWrap && total > 0) {
    if (visibleCount >= total) {
      loadMoreWrap.innerHTML = '';
    } else {
      const remaining = Math.min(PAGE_SIZE, total - visibleCount);
      loadMoreWrap.innerHTML = `<button class="load-more-btn">Show ${remaining} more listing${remaining !== 1 ? 's' : ''}</button>`;
      loadMoreWrap.querySelector('.load-more-btn').addEventListener('click', () => {
        visibleCount += PAGE_SIZE;
        renderListings(containerId, true);
      });
    }
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ─── Filter Controls ──────────────────────────────────────────────────────────

function initFilters() {
  $$('.mode-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.mode-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilters.mode = chip.dataset.mode;
      visibleCount = PAGE_SIZE;
      renderListings();
    });
  });

  [['#filter-community','community'],['#filter-type','type'],['#filter-beds','bedroomsMin'],['#filter-price-min','priceMin'],['#filter-price-max','priceMax'],['#filter-sort','sort']].forEach(([sel, key]) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener('change', () => { activeFilters[key] = el.value; window.activeFilters = activeFilters; visibleCount = PAGE_SIZE; renderListings(); });
  });

  const searchInput = document.getElementById('listing-search');
  if (searchInput) {
    let t;
    searchInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { activeFilters.search = searchInput.value.trim(); visibleCount = PAGE_SIZE; renderListings(); }, 280);
    });
  }

  const heroSearchBtn = document.getElementById('hero-search-btn');
  if (heroSearchBtn) {
    heroSearchBtn.addEventListener('click', async () => {
      const comm    = document.getElementById('hero-community');
      const type    = document.getElementById('hero-type');
      const beds    = document.getElementById('st-beds');
      const price   = document.getElementById('st-price');
      const checkin = document.getElementById('st-checkin');
      const checkout = document.getElementById('st-checkout');
      activeFilters.mode = 'short-term';
      const sync = (srcId, key, filterId) => { const s = document.getElementById(srcId); if (s?.value) { activeFilters[key] = s.value; const f = document.getElementById(filterId); if (f) f.value = s.value; } };
      sync('hero-community', 'community', 'filter-community');
      sync('hero-type', 'type', 'filter-type');
      sync('st-beds', 'bedroomsMin', 'filter-beds');
      if (price?.value) { activeFilters.priceMax = price.value; const f = document.getElementById('filter-price-max'); if (f) f.value = price.value; }
      activeFilters.checkIn  = checkin  ? checkin.value  : '';
      activeFilters.checkOut = checkout ? checkout.value : '';
      if (typeof window._syncFilterChip === 'function') window._syncFilterChip('short-term');

      window.availableListingIds = null;
      if (activeFilters.checkIn && activeFilters.checkOut) {
        const grid = document.getElementById('listings-grid');
        if (grid) grid.innerHTML = skeletonHTML(3);
        try {
          const ci = activeFilters.checkIn, co = activeFilters.checkOut;
          window.availableListingIds = await AvailabilityAPI.getAvailableIds(ci, co);
        } catch (_) {}
      }
      visibleCount = PAGE_SIZE;
      renderListings();
      document.getElementById('listings-section')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  document.getElementById('lt-search-btn')?.addEventListener('click', () => {
    activeFilters.mode = 'long-term';
    activeFilters.community  = document.getElementById('lt-community')?.value || '';
    activeFilters.priceMin   = document.getElementById('lt-price-from')?.value || '';
    activeFilters.priceMax   = document.getElementById('lt-price-to')?.value   || '';
    activeFilters.bedroomsMin = document.getElementById('lt-beds')?.value || '';
    activeFilters.checkIn = ''; activeFilters.checkOut = '';
    const fc = document.getElementById('filter-community'); if (fc) fc.value = activeFilters.community;
    const fb = document.getElementById('filter-beds');      if (fb) fb.value = activeFilters.bedroomsMin;
    if (typeof window._syncFilterChip === 'function') window._syncFilterChip('long-term');
    visibleCount = PAGE_SIZE;
    renderListings();
    document.getElementById('listings-section')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('all-search-btn')?.addEventListener('click', () => {
    const heroInput = document.getElementById('listing-search-hero');
    activeFilters.mode    = 'all';
    activeFilters.search  = heroInput?.value.trim() || '';
    activeFilters.checkIn = ''; activeFilters.checkOut = '';
    const ms = document.getElementById('listing-search'); if (ms && heroInput) ms.value = heroInput.value;
    if (typeof window._syncFilterChip === 'function') window._syncFilterChip('all');
    visibleCount = PAGE_SIZE;
    renderListings();
    document.getElementById('listings-section')?.scrollIntoView({ behavior: 'smooth' });
  });

  const stCheckin  = document.getElementById('st-checkin');
  const stCheckout = document.getElementById('st-checkout');
  if (stCheckin && stCheckout) {
    const today = new Date().toISOString().split('T')[0];
    stCheckin.min = today; stCheckout.min = today;
    stCheckin.addEventListener('change', () => {
      if (!stCheckin.value) return;
      const d = new Date(stCheckin.value + 'T00:00:00'); d.setDate(d.getDate() + 1);
      const nextDay = d.toISOString().split('T')[0];
      stCheckout.min = nextDay;
      if (stCheckout.value && stCheckout.value <= stCheckin.value) stCheckout.value = nextDay;
    });
  }
}

window.clearFilters = function () {
  activeFilters = { mode: 'all', community: '', type: '', bedroomsMin: '', priceMin: '', priceMax: '', sort: 'newest', search: '', checkIn: '', checkOut: '' };
  window.activeFilters = activeFilters; window.availableListingIds = null;
  $$('.mode-chip').forEach((c, i) => c.classList.toggle('active', i === 0));
  ['#filter-community','#filter-type','#filter-beds','#filter-price-min','#filter-price-max'].forEach(sel => { const el = document.querySelector(sel); if (el) el.value = ''; });
  ['listing-search','st-checkin','st-checkout'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  visibleCount = PAGE_SIZE;
  renderListings();
};

window.filterByCommunity = function (communityId) {
  const sel = document.getElementById('filter-community'); if (sel) sel.value = communityId;
  activeFilters.community = communityId; window.activeFilters = activeFilters;
  visibleCount = PAGE_SIZE;
  renderListings();
  const el = document.querySelector('.filter-bar');
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - (window.innerWidth > 768 ? 70 : 0), behavior: 'smooth' });
};

// ─── Listing Detail Modal ─────────────────────────────────────────────────────

function openListingModal(id) {
  const listing  = getListings().find(l => l.id === id);
  if (!listing) return;
  const backdrop = document.getElementById('listing-modal-backdrop');
  const body     = document.getElementById('listing-modal-body');
  const titleEl  = document.getElementById('listing-modal-title');
  if (!backdrop || !body) return;
  if (titleEl) titleEl.textContent = listing.title;

  const imgs = (listing.images || []).filter(Boolean);
  if (!imgs.length && listing.image) imgs.push(listing.image);
  if (!imgs.length) imgs.push('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80');
  window._galleryImgs = imgs; window._galleryIndex = 0;

  const isSale = listing.listingType === 'sale';
  const specs  = [
    { icon: '<i data-lucide="map-pin" aria-hidden="true"></i>', label: communityName(listing.community) },
    { icon: '<i data-lucide="bed-double" aria-hidden="true"></i>', label: `${listing.bedrooms || 0} bed${listing.bedrooms !== 1 ? 's' : ''}` },
    { icon: '<i data-lucide="bath" aria-hidden="true"></i>', label: `${listing.bathrooms || 0} bath${listing.bathrooms !== 1 ? 's' : ''}` },
    listing.type ? { icon: '<i data-lucide="home" aria-hidden="true"></i>', label: listing.type } : null,
    isSale && listing.sqft ? { icon: '<i data-lucide="ruler" aria-hidden="true"></i>', label: Number(listing.sqft).toLocaleString() + ' sqft' } : null,
    listing.maxGuests ? { icon: '<i data-lucide="users" aria-hidden="true"></i>', label: `${listing.maxGuests} guest${listing.maxGuests !== 1 ? 's' : ''}` } : null,
    listing.petsAllowed ? { icon: '<i data-lucide="paw-print" aria-hidden="true"></i>', label: 'Pets welcome' } : null,
  ].filter(Boolean);
  const specsHTML = '<div class="detail-meta-row">' + specs.map(s => `<span class="detail-spec">${s.icon} ${esc(s.label)}</span>`).join('') + '</div>';

  let pricingHTML = '';
  if (isSale) {
    pricingHTML = `<div class="detail-pricing"><div class="price-item"><label>Asking Price</label><div class="value">${listing.salePrice ? fmt(listing.salePrice) : '<span style="color:var(--clay);font-style:italic">Price on request</span>'}</div></div></div>`;
  } else if (listing.priceMonthly || listing.priceNightly) {
    pricingHTML = '<div class="detail-pricing">' +
      (listing.priceNightly ? `<div class="price-item"><label>Per night</label><div class="value">${fmt(listing.priceNightly)}</div></div>` : '') +
      (listing.priceMonthly ? `<div class="price-item"><label>Per month</label><div class="value">${fmt(listing.priceMonthly)}</div></div>` : '') +
      (listing.cleaningFee  ? `<div class="price-item"><label>Cleaning fee</label><div class="value">${fmt(listing.cleaningFee)}</div></div>` : '') +
      '</div>';
  } else {
    pricingHTML = '<div class="detail-pricing"><div class="price-item" style="grid-column:1/-1"><label>Pricing</label><div class="value" style="color:var(--clay);font-style:italic">Price on application</div></div></div>';
  }

  const amenities = listing.amenities || [];
  const amenHTML  = amenities.length ? `<div style="margin-bottom:24px"><div class="label-sm" style="color:var(--stone);margin-bottom:14px">Amenities & Features</div><div class="amenity-grid">${amenities.map(a => `<div class="amenity-item"><i data-lucide="check" aria-hidden="true"></i>${esc(a)}</div>`).join('')}</div></div>` : '';

  let contactHTML = '';
  if (listing.hostName || listing.contactEmail) {
    const initials = (listing.hostName || 'H').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    contactHTML = `<div class="contact-box"><div class="contact-avatar">${esc(initials)}</div><div class="contact-info"><h4>${esc(listing.hostName || 'Contact Host')}</h4>${listing.contactEmail ? `<p>${esc(listing.contactEmail)}</p>` : ''}${listing.contactPhone ? `<p>${esc(listing.contactPhone)}</p>` : ''}</div><div class="contact-actions">${isSale ? `<a href="${listing.community === 'san-mateo' ? 'https://laecovilla.com/ecovilla-san-mateo/' : 'https://laecovilla.com/la-ecovilla-original/'}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">View full listing</a>` : (listing.contactEmail ? `<a href="mailto:${esc(listing.contactEmail)}" class="btn btn-primary btn-sm">Email</a>` : '')}${listing.contactPhone ? `<a href="tel:${esc(listing.contactPhone)}" class="btn btn-ghost btn-sm">Call</a>` : ''}</div></div>`;
  }

  const availBadge  = isSale ? '<span class="status-pill status-available" style="margin-bottom:16px;display:inline-block">For Sale</span>' : listing.status === 'active' ? '<span class="status-pill status-available" style="margin-bottom:16px;display:inline-block"><i data-lucide="check" aria-hidden="true" width="12" height="12" style="margin-right:3px"></i>Available</span>' : '<span class="status-pill status-unavailable" style="margin-bottom:16px;display:inline-block">Currently Unavailable</span>';
  const availSection = isSale ? '' : `<div id="modal-availability-section" style="margin-top:24px;margin-bottom:24px"><button class="btn btn-secondary btn-full" id="check-availability-btn" onclick="toggleAvailability('${esc(listing.id)}')"><i data-lucide="calendar" aria-hidden="true" width="15" height="15" style="margin-right:6px"></i>Check Availability</button><div id="availability-calendar-wrap" style="display:none;margin-top:16px;padding-bottom:40px"></div></div>`;

  body.innerHTML = buildMosaicHTML(imgs) + specsHTML + availBadge + pricingHTML + (listing.description ? `<p class="detail-description">${esc(listing.description)}</p>` : '') + amenHTML + availSection + contactHTML;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  const mobTrack = document.getElementById('mob-gallery-track');
  if (mobTrack) {
    let _tx = 0, _swiped = false;
    mobTrack.addEventListener('touchstart', e => { _tx = e.touches[0].clientX; _swiped = false; }, { passive: true });
    mobTrack.addEventListener('touchmove', e => { if (Math.abs(e.touches[0].clientX - _tx) > 8) _swiped = true; }, { passive: true });
    mobTrack.addEventListener('click', () => { if (!_swiped) openLightbox(Math.round(mobTrack.scrollLeft / mobTrack.offsetWidth)); });
    const mobDots = document.querySelectorAll('#mob-gallery-dots .mob-dot');
    if (mobDots.length) {
      mobTrack.addEventListener('scroll', () => {
        const idx = Math.round(mobTrack.scrollLeft / mobTrack.offsetWidth);
        mobDots.forEach((d, i) => d.classList.toggle('active', i === idx));
      }, { passive: true });
    }
  }

  currentAvailListingId = null; availabilityLoaded = false;

  const heartBtn = document.getElementById('modal-heart-btn');
  if (heartBtn) {
    heartBtn.classList.toggle('saved', savedIds.has(listing.id));
    heartBtn.innerHTML = `<i data-lucide="heart" aria-hidden="true" width="18" height="18"${savedIds.has(listing.id) ? ' style="fill:currentColor"' : ''}></i>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    heartBtn.onclick = () => _modalToggleSaved(listing.id, heartBtn);
  }

  const shareBtn = document.getElementById('modal-share-btn');
  if (shareBtn) {
    shareBtn.onclick = () => {
      const shareUrl  = window.location.origin + window.location.pathname + '?listing=' + encodeURIComponent(listing.id);
      const shareData = { title: listing.title, text: listing.title + ' — Ecovilla Rentals', url: shareUrl };
      if (navigator.share && /mobile|android|iphone|ipad/i.test(navigator.userAgent)) {
        navigator.share(shareData).catch(() => {});
      } else {
        navigator.clipboard.writeText(shareUrl).then(() => _showModalToast('Link copied — ready to share!')).catch(() => _showModalToast('Copy this link: ' + shareUrl));
      }
    };
  }

  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (window.history?.replaceState) window.history.replaceState(null, '', '?listing=' + encodeURIComponent(listing.id));
}

async function _modalToggleSaved(listingId, btn) {
  const session = await Auth.getSession();
  if (!session) { sessionStorage.setItem('pendingSaveListing', listingId); window.location.href = 'pages/login.html'; return; }
  await toggleSaved(listingId, btn);
  btn.classList.toggle('saved', savedIds.has(listingId));
  btn.innerHTML = `<i data-lucide="heart" aria-hidden="true" width="18" height="18"${savedIds.has(listingId) ? ' style="fill:currentColor"' : ''}></i>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _showModalToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--charcoal);color:white;padding:10px 20px;border-radius:50px;font-size:.85rem;z-index:2000;white-space:nowrap;box-shadow:var(--shadow-md);transition:opacity .3s ease';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}

function closeListingModal() {
  document.getElementById('listing-modal-backdrop')?.classList.remove('open');
  document.body.style.overflow = '';
  if (window.history?.replaceState) window.history.replaceState(null, '', window.location.pathname);
}

function initModal() {
  const backdrop = document.getElementById('listing-modal-backdrop');
  const closeBtn = document.getElementById('listing-modal-close');
  if (!backdrop) return;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeListingModal(); });
  if (closeBtn) closeBtn.addEventListener('click', closeListingModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeListingModal(); });
}

function renderFeaturedListings() {
  const container = document.getElementById('featured-listings');
  if (!container) return;
  const featured = getListings().filter(l => l.featured).slice(0, 4);
  const items    = featured.length ? featured : getListings().slice(0, 4);
  if (!items.length) return;
  container.innerHTML = items.map((l, i) => cardHTML(l, i)).join('');
  $$('.listing-card', container).forEach(card => {
    const go = () => { window.location.href = 'pages/listing.html?id=' + encodeURIComponent(card.dataset.id); };
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
  $$('.card-wishlist', container).forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); toggleSaved(btn.dataset.wishlist, btn); });
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ─── Availability Calendar ────────────────────────────────────────────────────

let currentAvailListingId = null;
let availabilityLoaded    = false;

const calState = { listingId: null, minStay: 1, availWindows: [], bookedRanges: [], blockedRanges: [], checkIn: null, checkOut: null, viewYear: new Date().getFullYear(), viewMonth: new Date().getMonth() };

function toggleAvailability(listingId) {
  const wrap = document.getElementById('availability-calendar-wrap');
  const btn  = document.getElementById('check-availability-btn');
  if (!wrap) return;
  const isOpen = wrap.style.display !== 'none';
  if (isOpen) {
    wrap.style.display = 'none';
    if (btn) { btn.innerHTML = '<i data-lucide="calendar" aria-hidden="true" width="15" height="15" style="margin-right:6px"></i>Check Availability'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  } else {
    wrap.style.display = 'block';
    if (btn) { btn.innerHTML = '<i data-lucide="calendar-x" aria-hidden="true" width="15" height="15" style="margin-right:6px"></i>Hide Availability'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    if (currentAvailListingId !== listingId || !availabilityLoaded) { currentAvailListingId = listingId; availabilityLoaded = false; loadPublicAvailability(listingId); }
    setTimeout(() => { const modal = document.querySelector('#listing-modal-backdrop .modal'); if (modal) modal.scrollTo({ top: modal.scrollHeight, behavior: 'smooth' }); }, 300);
  }
}

async function loadPublicAvailability(listingId) {
  const wrap = document.getElementById('availability-calendar-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<p style="color:var(--stone);font-size:.875rem;padding:16px 0">Loading availability…</p>';
  try {
    const { windows, booked, blocked } = await AvailabilityAPI.getForListing(listingId);
    const listing = getListings().find(l => l.id === listingId);
    const now = new Date();
    calState.listingId = listingId;
    const dbMinStay = listing?.minStayNights || 1;
    calState.minStay = listing?.community === 'la-ecovilla' ? Math.max(dbMinStay, 7) : dbMinStay;
    calState.availWindows = windows; calState.bookedRanges = booked; calState.blockedRanges = blocked;
    calState.checkIn = null; calState.checkOut = null;
    calState.viewYear = now.getFullYear(); calState.viewMonth = now.getMonth();
    availabilityLoaded = true;
    renderCalendar();
  } catch (_) {
    document.getElementById('availability-calendar-wrap')?.insertAdjacentHTML('afterbegin', '<p style="color:#b91c1c;font-size:.875rem;padding:16px 0">Could not load availability. Please try again.</p>');
  }
}

function renderCalendar() {
  const wrap = document.getElementById('availability-calendar-wrap');
  if (!wrap) return;
  if (!calState.availWindows.length) { wrap.innerHTML = '<p style="color:var(--stone);font-size:.875rem;padding:16px 0">No availability set for this property yet. Contact the host directly.</p>'; return; }

  const { viewYear: year, viewMonth: month } = calState;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const firstDay   = new Date(year, month, 1);
  const lastDay    = new Date(year, month + 1, 0);
  const today      = new Date(); today.setHours(0, 0, 0, 0);

  let html = '<div style="font-family:var(--font-body,sans-serif);padding:4px 0">';
  if (calState.minStay > 1) html += `<p style="font-size:.78rem;color:var(--stone);margin-bottom:10px;text-align:center">⏱ Minimum stay: ${calState.minStay} night${calState.minStay !== 1 ? 's' : ''}</p>`;
  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><button onclick="calPrev()" ${!canGoPrev() ? 'disabled ' : ''}style="border:none;background:none;cursor:${canGoPrev() ? 'pointer' : 'default'};font-size:1.2rem;padding:4px 10px;border-radius:8px;color:var(--charcoal);opacity:${canGoPrev() ? '1' : '0.3'}">‹</button><span style="font-weight:600;font-size:.95rem">${monthNames[month]} ${year}</span><button onclick="calNext()" style="border:none;background:none;cursor:pointer;font-size:1.2rem;padding:4px 10px;border-radius:8px;color:var(--charcoal)">›</button></div>`;
  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px">';
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => { html += `<div style="text-align:center;font-size:.7rem;font-weight:600;color:var(--stone);padding:4px 0">${d}</div>`; });
  html += '</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">';
  for (let i = 0; i < firstDay.getDay(); i++) html += '<div></div>';
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d); date.setHours(0, 0, 0, 0);
    const ymd  = toCalYMD(date);
    const state = _getDayState(date, ymd, today);
    let bg = 'transparent', color = 'var(--charcoal)', cursor = 'default', border = '1px solid transparent', fw = '400', opacity = '1';
    if (['past','unavailable','booked','minstay'].includes(state)) { color = '#bbb'; opacity = state === 'minstay' ? '0.5' : '1'; }
    else if (state === 'checkin' || state === 'checkout') { bg = 'var(--forest)'; color = 'white'; fw = '600'; border = '1px solid var(--forest)'; cursor = 'pointer'; }
    else if (state === 'inrange') { bg = 'rgba(31,59,47,.12)'; cursor = 'pointer'; }
    else { border = '1px solid var(--parchment)'; cursor = 'pointer'; }
    const onclick = ['available','checkin','checkout','inrange'].includes(state) ? `onclick="calSelectDay('${ymd}')"` : '';
    html += `<div ${onclick} style="text-align:center;padding:8px 2px;border-radius:8px;font-size:.85rem;cursor:${cursor};background:${bg};color:${color};border:${border};font-weight:${fw};opacity:${opacity};transition:background .15s;user-select:none">${d}</div>`;
  }
  html += '</div>';

  if (calState.checkIn) {
    html += `<div style="margin-top:16px;padding:14px 16px;background:var(--cream);border-radius:12px;font-size:.875rem"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--stone)">Check-in</span><strong>${fmtAvailDate(calState.checkIn)}</strong></div>`;
    if (calState.checkOut) {
      const nights  = Math.round((new Date(calState.checkOut) - new Date(calState.checkIn)) / 86400000);
      const listing = getListings().find(l => l.id === calState.listingId);
      const fmtM    = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
      let feeRows = '', subtotal = 0;
      if (listing && !listing.poa) {
        // Calendar-based monthly pricing: step forward by real calendar months from
        // check-in, then bill leftover days at nightly rate. Leftover ≥ 27 days rounds
        // up to the next month (e.g. Jan 1 → Feb 28 = 1 month + 27 days → 2 months).
        let _months = 0, _left = nights;
        if (nights >= 28 && listing.priceMonthly) {
          let _d = new Date(calState.checkIn);
          const _end = new Date(calState.checkOut);
          while (true) {
            const _next = new Date(_d);
            _next.setMonth(_next.getMonth() + 1);
            if (_next <= _end) { _months++; _d = _next; } else { break; }
          }
          _left = Math.round((_end - _d) / 86400000);
          if (_left >= 27) { _months++; _left = 0; }
        }
        if (_months > 0 && listing.priceMonthly) {
          const _lr = listing.priceNightly || Math.round(listing.priceMonthly / 30);
          const _lc = _left > 0 ? _lr * _left : 0;
          subtotal = _months * listing.priceMonthly + _lc;
          feeRows += `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">${_months} month${_months !== 1 ? 's' : ''} · ${fmtM(listing.priceMonthly)}/mo</span><span>${fmtM(_months * listing.priceMonthly)}</span></div>`;
          if (_left > 0) feeRows += `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">${_left} extra night${_left !== 1 ? 's' : ''} × ${fmtM(_lr)}</span><span>${fmtM(_lc)}</span></div>`;
        } else if (listing.priceNightly) {
          subtotal = nights * listing.priceNightly;
          feeRows += `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">${nights} night${nights !== 1 ? 's' : ''} × ${fmtM(listing.priceNightly)}</span><span>${fmtM(subtotal)}</span></div>`;
        } else if (listing.priceMonthly) {
          subtotal = Math.round(listing.priceMonthly * nights / 30);
          feeRows += `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">${nights} nights · ${fmtM(listing.priceMonthly)}/mo</span><span>${fmtM(subtotal)}</span></div>`;
        }
        if (subtotal > 0) {
          const cleaning = listing.cleaningFee || 0, deposit = listing.securityDeposit || 0;
          const communityFee = Math.round(subtotal * 3 / 100);
          const platformFee  = Math.round(subtotal * 3 / 100);
          const grand = subtotal + cleaning + deposit + communityFee + platformFee;
          if (cleaning > 0) feeRows += `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">Cleaning fee</span><span>${fmtM(cleaning)}</span></div>`;
          if (deposit  > 0) feeRows += `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">Security deposit <em style="font-size:.75rem">(refundable)</em></span><span>${fmtM(deposit)}</span></div>`;
          feeRows += `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">Community give back (3%)</span><span>${fmtM(communityFee)}</span></div>`;
          feeRows += `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">Ecovilla Rentals platform fee (3%)</span><span>${fmtM(platformFee)}</span></div>`;
          feeRows += `<div style="display:flex;justify-content:space-between;padding-top:8px;margin-top:4px;border-top:1px solid var(--parchment);font-weight:700"><span>Total</span><span style="color:var(--forest)">${fmtM(grand)} USD</span></div>`;
        }
      } else if (listing?.poa) { feeRows = '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--stone)">Price</span><span>Price on application</span></div>'; }
      const isOwnListing = listing && window._currentUser && listing.ownerId === window._currentUser.id;
      html += `<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--stone)">Check-out</span><strong>${fmtAvailDate(calState.checkOut)}</strong></div><div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--stone)">Duration</span><strong>${nights} night${nights !== 1 ? 's' : ''}</strong></div>${feeRows ? `<div style="padding-top:10px;margin-top:4px;margin-bottom:16px;border-top:1px solid var(--parchment);font-size:.875rem">${feeRows}</div>` : '<div style="margin-bottom:16px"></div>'}${isOwnListing ? '<p style="text-align:center;color:var(--stone);font-size:.85rem;padding:10px 0">This is your listing — you cannot book it.</p>' : '<textarea id="booking-message" placeholder="Add a message to the host (optional)…" style="width:100%;padding:12px 14px;border:1.5px solid var(--parchment);border-radius:12px;font-size:.875rem;resize:vertical;min-height:80px;font-family:inherit;margin-bottom:10px;box-sizing:border-box"></textarea><button onclick="submitBookingRequest()" style="width:100%;padding:14px;border-radius:12px;font-size:.95rem;background:var(--forest);color:white;border:none;cursor:pointer;font-weight:600">Request Booking</button>'}`;
    } else { html += '<p style="color:var(--stone);font-size:.8rem;margin-top:4px">Now select your check-out date</p>'; }
    html += '</div>';
  } else { html += '<p style="color:var(--stone);font-size:.8rem;margin-top:12px;text-align:center">Select your check-in date</p>'; }
  html += '</div>';
  wrap.innerHTML = html;
}

function _getDayState(date, ymd, today) {
  if (date < today) return 'past';
  if (calState.checkIn  && ymd === calState.checkIn)  return 'checkin';
  if (calState.checkOut && ymd === calState.checkOut) return 'checkout';
  if (calState.checkIn && calState.checkOut && ymd > calState.checkIn && ymd < calState.checkOut) return 'inrange';
  if (calState.bookedRanges.some(b  => ymd >= b.start_date  && ymd < b.end_date))  return 'booked';
  if (calState.blockedRanges.some(b => ymd >= b.start_date  && ymd < b.end_date))  return 'booked';
  if (!calState.availWindows.some(w => ymd >= w.start_date  && ymd < w.end_date))  return 'unavailable';
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
  const end    = new Date(ymd);
  while (cursor <= end) {
    const cymd = toCalYMD(cursor);
    if (calState.bookedRanges.some(b => cymd >= b.start_date && cymd < b.end_date) || !calState.availWindows.some(w => cymd >= w.start_date && cymd < w.end_date)) { valid = false; break; }
    cursor.setDate(cursor.getDate() + 1);
  }
  calState.checkOut = valid ? ymd : null;
  if (!valid) calState.checkIn = ymd;
  renderCalendar();
}

async function submitBookingRequest() {
  const listing = getListings().find(l => l.id === calState.listingId);
  if (listing && window._currentUser && listing.ownerId === window._currentUser.id) { showToast('You cannot book your own listing.', 'error'); return; }
  const session = await Auth.getSession();
  if (!session) {
    sessionStorage.setItem('pendingBooking', JSON.stringify({ listingId: calState.listingId, checkIn: calState.checkIn, checkOut: calState.checkOut }));
    window.location.href = 'pages/login.html?redirect=booking';
    return;
  }
  const msgEl   = document.getElementById('booking-message');
  const message = msgEl ? msgEl.value.trim() : '';
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
      if (convId && message) {
        await ConversationsAPI.sendMessage(convId, message);
      }
    }
    const wrap = document.getElementById('availability-calendar-wrap');
    if (wrap) wrap.innerHTML = `<div style="text-align:center;padding:28px 16px"><div style="font-size:2.5rem;margin-bottom:12px">🌿</div><h3 style="font-family:var(--font-display,serif);font-size:1.4rem;margin-bottom:8px">Request Sent!</h3><p style="color:var(--stone);font-size:.875rem;line-height:1.6">Your booking request for <strong>${fmtAvailDate(calState.checkIn)} → ${fmtAvailDate(calState.checkOut)}</strong> has been sent to the host.<br>You'll receive a response shortly.</p></div>`;
  } catch (err) {
    console.error('[Booking] error:', err);
    showToast('Could not send booking request. Please try again.', 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Request Booking'; }
  }
}

function initSearchTabs() {
  $$('.search-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.search-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      $$('.search-panel-content').forEach(p => { p.style.display = p.dataset.content === target ? 'block' : 'none'; });
    });
  });
}

function initScrollAnimations() {
  const els = $$('.animate-on-scroll');
  if (!els.length) return;
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, { threshold: .12 });
  els.forEach((el, i) => { el.style.transitionDelay = (i * 60) + 'ms'; io.observe(el); });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  Auth.getUser().then(u => { window._currentUser = u || null; }).catch(() => {});
  initNav();
  initSearchTabs();
  initModal();
  initFilters();
  initScrollAnimations();

  const grid        = document.getElementById('listings-grid');
  const featuredGrid = document.getElementById('featured-listings');
  const countEl     = document.getElementById('listings-count');
  if (grid)        grid.innerHTML        = skeletonHTML(6);
  if (featuredGrid) featuredGrid.innerHTML = skeletonHTML(3);
  if (countEl)     countEl.textContent   = 'Loading…';

  try {
    const listings = await ListingsAPI.getPublic();
    window.LISTINGS = listings;
    await loadSavedIds();
    renderListings();
    renderFeaturedListings();
    initScrollAnimations();

    const urlParams   = new URLSearchParams(window.location.search);
    const deepListing = urlParams.get('listing');
    if (deepListing) { window.location.replace('pages/listing.html?id=' + encodeURIComponent(deepListing)); return; }

    const pendingSave = sessionStorage.getItem('pendingSaveListing');
    if (pendingSave) {
      sessionStorage.removeItem('pendingSaveListing');
      Auth.getSession().then(async session => {
        if (!session) return;
        try {
          await SavedAPI.save(pendingSave);
          savedIds.add(pendingSave);
        } catch (_) {}
        window.location.href = 'pages/user.html?panel=saved';
      });
    }

    const pending = sessionStorage.getItem('pendingBooking');
    if (pending && urlParams.get('redirect') === 'booking') {
      try {
        const pb = JSON.parse(pending);
        sessionStorage.removeItem('pendingBooking');
        const waitForListings = () => {
          const listing = (window.LISTINGS || []).find(l => l.id === pb.listingId);
          if (!listing) { setTimeout(waitForListings, 150); return; }
          openListingModal(pb.listingId);
          setTimeout(() => {
            currentAvailListingId = pb.listingId; availabilityLoaded = false;
            loadPublicAvailability(pb.listingId).then(() => { calState.checkIn = pb.checkIn; calState.checkOut = pb.checkOut; const wrap = document.getElementById('availability-calendar-wrap'); const btn2 = document.getElementById('check-availability-btn'); if (wrap) wrap.style.display = 'block'; if (btn2) btn2.textContent = '📅 Hide Availability'; renderCalendar(); });
          }, 300);
        };
        waitForListings();
      } catch (e) { console.error('[Booking restore]', e); }
    }
  } catch (err) {
    console.error('[Main] Data load error:', err);
    window.LISTINGS = [];
    if (grid)    grid.innerHTML    = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><h3>Could not load listings</h3><p>Check your Supabase connection.</p></div>';
    if (countEl) countEl.textContent = '0 listings found';
  }
});

// ─── Window globals for HTML onclick handlers ─────────────────────────────────
Object.assign(window, {
  renderListings,
  openLightbox,
  lightboxStep,
  closeLightbox,
  toggleAvailability,
  calPrev,
  calNext,
  calSelectDay,
  submitBookingRequest,
});
