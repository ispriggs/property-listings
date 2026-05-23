/**
 * Machuca Homes – Admin Dashboard JavaScript
 * Handles: CRUD for listings, form validation, image upload, table search
 */

'use strict';

const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(msg, type = 'default') {
  let c = $('#toast-container');
  if (!c) { c = document.createElement('div'); c.id='toast-container'; c.className='toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${{success:'✓',error:'✕',default:'ℹ'}[type]||'ℹ'}</span><span>${esc(msg)}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.cssText='opacity:0;transform:translateX(40px);transition:all .3s ease'; setTimeout(()=>t.remove(),350); }, 3500);
}

// ─── View Management ─────────────────────────────────────────────────────────

let currentView = 'dashboard';
let editingId = null;
let pendingDeleteId = null;
let imageUrls = [];

function showView(viewId) {
  $$('[data-view]').forEach(v => v.style.display = 'none');
  const view = $(`[data-view="${viewId}"]`);
  if (view) view.style.display = 'block';
  $$('.sidebar-nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === viewId));
  currentView = viewId;
  updateTopbarTitle(viewId);
}

function updateTopbarTitle(view) {
  const titles = {
    dashboard: 'Dashboard Overview',
    listings: 'All Listings',
    'create-listing': editingId ? 'Edit Listing' : 'Create New Listing',
  };
  const el = $('.topbar-title');
  if (el) el.textContent = titles[view] || 'Admin';
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

function renderDashboard() {
  const all = MachucaData.getListings();
  const stats = {
    total: all.length,
    available: all.filter(l => l.available).length,
    featured: all.filter(l => l.featured).length,
    communities: [...new Set(all.map(l => l.community))].length,
  };

  const set = (id, val) => { const el = $(`#${id}`); if(el) el.textContent = val; };
  set('stat-total', stats.total);
  set('stat-available', stats.available);
  set('stat-featured', stats.featured);
  set('stat-communities', stats.communities);

  // Recent listings mini table
  const recentContainer = $('#recent-listings-table');
  if (recentContainer) {
    const recent = [...all].sort((a,b) => new Date(b.dateAdded)-new Date(a.dateAdded)).slice(0,5);
    recentContainer.innerHTML = recent.map(l => `
      <tr>
        <td><img class="td-img" src="${esc(l.images[0]||'')}" alt="" onerror="this.src='https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=200&q=60'"></td>
        <td><div class="td-title">${esc(l.title)}</div><div class="td-community">${esc(communityLabel(l.community))}</div></td>
        <td>${priceLabel(l)}</td>
        <td><span class="status-pill ${l.available?'status-available':'status-unavailable'}">${l.available?'Available':'Unavailable'}</span></td>
        <td>${l.dateAdded}</td>
      </tr>`).join('');
  }
}

function communityLabel(id) {
  const m = MachucaData.COMMUNITIES.find(c=>c.id===id);
  return m ? m.name : id;
}
function priceLabel(l) {
  if (l.poa) return '<em style="color:var(--clay)">POA</em>';
  const parts = [];
  if (l.pricePerNight) parts.push(`$${l.pricePerNight}/night`);
  if (l.pricePerMonth) parts.push(`$${l.pricePerMonth.toLocaleString()}/mo`);
  return parts.join(' · ') || '—';
}

// ─── Listings Table ───────────────────────────────────────────────────────────

let tableSearch = '';

function renderListingsTable() {
  const tbody = $('#listings-tbody');
  if (!tbody) return;

  let all = MachucaData.getListings();
  if (tableSearch) {
    const q = tableSearch.toLowerCase();
    all = all.filter(l => l.title.toLowerCase().includes(q) || communityLabel(l.community).toLowerCase().includes(q) || l.type.toLowerCase().includes(q));
  }

  if (!all.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--stone)">No listings found</td></tr>`;
    return;
  }

  tbody.innerHTML = all.map(l => `
    <tr>
      <td><img class="td-img" src="${esc(l.images[0]||'')}" alt="" onerror="this.src='https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=200&q=60'"></td>
      <td>
        <div class="td-title">${esc(l.title)}</div>
        <div class="td-community">${esc(communityLabel(l.community))}</div>
      </td>
      <td>${esc(l.type)}</td>
      <td>${priceLabel(l)}</td>
      <td>
        <span class="status-pill ${l.available?'status-available':'status-unavailable'}">${l.available?'Available':'Unavailable'}</span>
        ${l.featured?`<span class="status-pill status-featured" style="margin-left:4px">Featured</span>`:''}
      </td>
      <td>${l.dateAdded}</td>
      <td>
        <div class="table-actions">
          <button class="tbl-btn tbl-btn-edit" data-edit="${l.id}">Edit</button>
          <button class="tbl-btn tbl-btn-delete" data-delete="${l.id}">Delete</button>
        </div>
      </td>
    </tr>`).join('');

  // Edit buttons
  $$('[data-edit]', tbody).forEach(btn => {
    btn.addEventListener('click', () => startEdit(btn.dataset.edit));
  });

  // Delete buttons
  $$('[data-delete]', tbody).forEach(btn => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.delete));
  });
}

// ─── Create/Edit Form ─────────────────────────────────────────────────────────

function buildForm() {
  // Populate community select
  const commSel = $('#form-community');
  if (commSel) {
    commSel.innerHTML = '<option value="">Select community</option>' +
      MachucaData.COMMUNITIES.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }

  // Populate type select
  const typeSel = $('#form-type');
  if (typeSel) {
    typeSel.innerHTML = '<option value="">Select type</option>' +
      MachucaData.PROPERTY_TYPES.map(t => `<option value="${t}">${esc(t)}</option>`).join('');
  }

  // Build amenity checkboxes
  const amenContainer = $('#amenity-checkboxes');
  if (amenContainer) {
    amenContainer.innerHTML = MachucaData.AMENITIES_OPTIONS.map(a => `
      <label class="amenity-check">
        <input type="checkbox" name="amenity" value="${esc(a)}"> ${esc(a)}
      </label>`).join('');
    $$('.amenity-check', amenContainer).forEach(label => {
      const checkbox = $('input', label);
      checkbox.addEventListener('change', () => label.classList.toggle('checked', checkbox.checked));
    });
  }

  // Toggle switches
  $$('.toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('on');
      const input = $(`#${toggle.dataset.for}`);
      if (input) input.value = toggle.classList.contains('on') ? '1' : '0';
    });
  });

  // Image upload zone
  initImageUpload();
}

function initImageUpload() {
  const zone = $('#image-upload-zone');
  const fileInput = $('#image-file-input');
  const urlInput = $('#image-url-input');
  const addUrlBtn = $('#add-url-btn');
  const preview = $('#image-preview');

  if (zone && fileInput) {
    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      handleFiles([...e.dataTransfer.files]);
    });
    fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));
  }

  if (addUrlBtn && urlInput) {
    addUrlBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url || !url.startsWith('http')) { showToast('Enter a valid image URL', 'error'); return; }
      imageUrls.push(url);
      urlInput.value = '';
      renderImagePreviews();
    });
    urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addUrlBtn.click(); } });
  }
}

function handleFiles(files) {
  files.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => { imageUrls.push(e.target.result); renderImagePreviews(); };
    reader.readAsDataURL(file);
  });
}

function renderImagePreviews() {
  const preview = $('#image-preview');
  if (!preview) return;
  preview.innerHTML = imageUrls.map((url, i) => `
    <div class="img-preview-wrap">
      <img src="${esc(url)}" alt="">
      <button class="img-preview-remove" data-idx="${i}" title="Remove">✕</button>
    </div>`).join('');
  $$('.img-preview-remove', preview).forEach(btn => {
    btn.addEventListener('click', () => {
      imageUrls.splice(parseInt(btn.dataset.idx), 1);
      renderImagePreviews();
    });
  });
}

// ─── Start Edit ───────────────────────────────────────────────────────────────

function startEdit(id) {
  const listing = MachucaData.getListings().find(l => l.id === id);
  if (!listing) return;
  editingId = id;
  imageUrls = [...(listing.images || [])];
  showView('create-listing');
  updateTopbarTitle('create-listing');

  // Set form title
  const formTitle = $('#form-view-title');
  if (formTitle) formTitle.textContent = 'Edit Listing';

  // Fill fields
  const fill = (id, val) => { const el = $(`#${id}`); if(el) el.value = val ?? ''; };
  fill('form-title', listing.title);
  fill('form-description', listing.description);
  fill('form-community', listing.community);
  fill('form-type', listing.type);
  fill('form-bedrooms', listing.bedrooms);
  fill('form-bathrooms', listing.bathrooms);
  fill('form-sqft', listing.sqft);
  fill('form-lot-size', listing.lotSize);
  fill('form-price-month', listing.pricePerMonth);
  fill('form-price-night', listing.pricePerNight);
  fill('form-deposit', listing.deposit);
  fill('form-contact-name', listing.contact?.name);
  fill('form-contact-email', listing.contact?.email);
  fill('form-contact-phone', listing.contact?.phone);
  fill('form-lat', listing.lat);
  fill('form-lng', listing.lng);
  fill('form-meta-title', listing.metaTitle);
  fill('form-meta-desc', listing.metaDescription);

  // Toggles
  setToggle('toggle-featured', 'form-featured', listing.featured);
  setToggle('toggle-available', 'form-available', listing.available);
  setToggle('toggle-poa', 'form-poa', listing.poa);

  // Amenities
  $$('#amenity-checkboxes input[type=checkbox]').forEach(cb => {
    const checked = (listing.amenities || []).includes(cb.value);
    cb.checked = checked;
    cb.closest('.amenity-check')?.classList.toggle('checked', checked);
  });

  // Images
  renderImagePreviews();
}

function setToggle(toggleId, inputId, value) {
  const toggle = $(`#${toggleId}`);
  const input = $(`#${inputId}`);
  if (!toggle || !input) return;
  toggle.classList.toggle('on', !!value);
  input.value = value ? '1' : '0';
}

function resetForm() {
  const form = $('#listing-form');
  if (form) form.reset();
  editingId = null;
  imageUrls = [];
  renderImagePreviews();
  $$('.toggle').forEach(t => t.classList.remove('on'));
  // Default available to true
  setToggle('toggle-available', 'form-available', true);
  $$('#amenity-checkboxes .amenity-check').forEach(l => l.classList.remove('checked'));
  $$('#amenity-checkboxes input').forEach(cb => cb.checked = false);
  $$('.field-error').forEach(e => e.textContent = '');
  $$('.form-input, .form-select, .form-textarea').forEach(el => el.classList.remove('error'));
  const formTitle = $('#form-view-title');
  if (formTitle) formTitle.textContent = 'Create New Listing';
}

// ─── Form Validation ─────────────────────────────────────────────────────────

function validateForm() {
  let valid = true;
  const required = [
    ['form-title', 'Title is required'],
    ['form-description', 'Description is required'],
    ['form-community', 'Select a community'],
    ['form-type', 'Select a property type'],
    ['form-bedrooms', 'Bedrooms count required'],
    ['form-bathrooms', 'Bathrooms count required'],
    ['form-contact-name', 'Contact name required'],
    ['form-contact-email', 'Contact email required'],
  ];
  required.forEach(([id, msg]) => {
    const el = $(`#${id}`);
    const errEl = $(`#err-${id.replace('form-','')}`);
    if (!el) return;
    const empty = !el.value.trim();
    el.classList.toggle('error', empty);
    if (errEl) errEl.textContent = empty ? msg : '';
    if (empty) valid = false;
  });

  // Email format
  const emailEl = $('#form-contact-email');
  if (emailEl && emailEl.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value)) {
    emailEl.classList.add('error');
    const errEl = $('#err-contact-email');
    if (errEl) errEl.textContent = 'Enter a valid email address';
    valid = false;
  }

  return valid;
}

// ─── Save Listing ─────────────────────────────────────────────────────────────

function saveListing() {
  if (!validateForm()) {
    showToast('Please fix the errors below', 'error');
    return;
  }

  const amenities = $$('#amenity-checkboxes input[type=checkbox]:checked').map(cb => cb.value);

  const data = {
    title: $('#form-title').value.trim(),
    description: $('#form-description').value.trim(),
    community: $('#form-community').value,
    type: $('#form-type').value,
    bedrooms: parseInt($('#form-bedrooms').value) || 1,
    bathrooms: parseInt($('#form-bathrooms').value) || 1,
    sqft: parseInt($('#form-sqft').value) || null,
    lotSize: $('#form-lot-size').value.trim() || null,
    pricePerMonth: parseFloat($('#form-price-month').value) || null,
    pricePerNight: parseFloat($('#form-price-night').value) || null,
    deposit: parseFloat($('#form-deposit').value) || null,
    featured: $('#form-featured').value === '1',
    available: $('#form-available').value === '1',
    poa: $('#form-poa').value === '1',
    images: imageUrls.length ? imageUrls : ['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80'],
    amenities,
    contact: {
      name: $('#form-contact-name').value.trim(),
      email: $('#form-contact-email').value.trim(),
      phone: $('#form-contact-phone').value.trim(),
    },
    lat: parseFloat($('#form-lat').value) || null,
    lng: parseFloat($('#form-lng').value) || null,
    metaTitle: $('#form-meta-title').value.trim(),
    metaDescription: $('#form-meta-desc').value.trim(),
    slug: ($('#form-title').value.trim()).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),
  };

  if (editingId) {
    MachucaData.updateListing(editingId, data);
    showToast('Listing updated successfully!', 'success');
  } else {
    MachucaData.addListing(data);
    showToast('New listing created!', 'success');
  }

  resetForm();
  showView('listings');
  renderListingsTable();
  renderDashboard();
}

// ─── Delete Listing ───────────────────────────────────────────────────────────

function confirmDelete(id) {
  pendingDeleteId = id;
  const backdrop = $('#confirm-modal-backdrop');
  if (backdrop) backdrop.classList.add('open');
}

function doDelete() {
  if (!pendingDeleteId) return;
  MachucaData.deleteListing(pendingDeleteId);
  pendingDeleteId = null;
  closeConfirm();
  renderListingsTable();
  renderDashboard();
  showToast('Listing deleted', 'default');
}

function closeConfirm() {
  const backdrop = $('#confirm-modal-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  pendingDeleteId = null;
}

// ─── Sidebar Toggle (mobile) ─────────────────────────────────────────────────

function initSidebarToggle() {
  const toggle = $('#sidebar-toggle');
  const sidebar = $('.admin-sidebar');
  if (!toggle || !sidebar) return;
  toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggle) {
      sidebar.classList.remove('open');
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  buildForm();

  // Sidebar navigation
  $$('.sidebar-nav a[data-nav]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const view = a.dataset.nav;
      if (view === 'create-listing') {
        resetForm();
      }
      showView(view);
      if (view === 'listings') renderListingsTable();
      if (view === 'dashboard') renderDashboard();
    });
  });

  // Table search
  const searchInput = $('#table-search');
  if (searchInput) {
    let t;
    searchInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { tableSearch = searchInput.value.trim(); renderListingsTable(); }, 250);
    });
  }

  // Sort select in listings table
  const sortSel = $('#table-sort');
  if (sortSel) sortSel.addEventListener('change', renderListingsTable);

  // Save button
  const saveBtn = $('#save-listing-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveListing);

  // Cancel button
  const cancelBtn = $('#cancel-listing-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { resetForm(); showView('listings'); renderListingsTable(); });

  // Create new button in listings view
  const createBtn = $('#create-new-btn');
  if (createBtn) createBtn.addEventListener('click', () => { resetForm(); showView('create-listing'); });

  // Confirm delete modal
  $('#confirm-delete-btn')?.addEventListener('click', doDelete);
  $('#cancel-delete-btn')?.addEventListener('click', closeConfirm);
  $('#confirm-modal-backdrop')?.addEventListener('click', e => { if(e.target.id==='confirm-modal-backdrop') closeConfirm(); });

  // Back to site link
  const backBtn = $('#back-to-site');
  if (backBtn) backBtn.addEventListener('click', e => { e.preventDefault(); window.open('index.html','_blank'); });

  initSidebarToggle();

  // Default view
  showView('dashboard');
  renderDashboard();
});
