// ============================================================
// js/data.js  — Valle Vivo  (Supabase edition)
// ============================================================
// Auth.getToken() is called before every write so RLS can
// identify the logged-in user. Public reads stay anonymous.
// ============================================================

// Use auth.js values if already defined, otherwise declare
const _DATA_URL = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : 'https://wywmdgelflstnqfgslqw.supabase.co';
const _DATA_ANON = typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d21kZ2VsZmxzdG5xZmdzbHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTQxODIsImV4cCI6MjA5NDk3MDE4Mn0.7SAsWpGvYDV-aRaHagt_tBFiSkbNL-Vuc3gHLSs8o9E';
// ── Low-level REST helpers ───────────────────────────────────

async function _sbGet(path, token) {
  const res = await fetch(`${_DATA_URL}/rest/v1/${path}`, {
    headers: {
      apikey: _DATA_ANON,
      Authorization: `Bearer ${token || _DATA_ANON}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function _sbPost(path, payload, token) {
  _requireToken(token);
  const res = await fetch(`${_DATA_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: _DATA_ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function _sbPatch(path, payload, token) {
  _requireToken(token);
  const res = await fetch(`${_DATA_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: _DATA_ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function _sbDelete(path, token) {
  _requireToken(token);
  const res = await fetch(`${_DATA_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      apikey: _DATA_ANON,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return true;
}

function _requireToken(token) {
  if (!token) throw new Error('Not authenticated — please sign in.');
}

// ── Shape converters ─────────────────────────────────────────
// normalise : DB row  → shape main.js expects
// denormalise: form data → DB columns

function normalise(row) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug || '',
    minStayNights: row.min_stay_nights || 1,
    description: row.description || '',
    type: row.property_type || 'Other',
    status: row.status,
    featured: row.featured,
    community: row.community || '',
    bedrooms: row.bedrooms ?? 0,
    bathrooms: row.bathrooms ?? 0,
    sqft: row.sqft ?? null,
    lotSize: row.lot_size ?? null,
    priceMonthly: row.price_monthly ?? null,
    priceNightly: row.price_nightly ?? null,
    listingType: row.listing_type || 'rental',
    salePrice: row.sale_price ?? null,
    deposit: row.deposit ?? null,
    rentalMode: row.rental_mode || 'both',
    poa: row.poa || false,
    images: row.images || [],
    image: (row.images || [])[0] || '',   // convenience shortcut
    amenities: row.amenities || [],
    tags: row.tags || [],
    hostName: row.host_name || '',
    contactEmail: row.contact_email || '',
    contactPhone: row.contact_phone || '',
    metaTitle: row.meta_title || '',
    metaDesc: row.meta_description || '',
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    ownerId: row.owner_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function denormalise(data) {
  return {
    title: data.title,
    slug: data.slug || slugify(data.title),
    description: data.description || null,
    min_stay_nights: data.minStayNights ? parseInt(data.minStayNights) : 1,
    property_type: data.type || 'Other',
    status: data.status || 'draft',
    featured: data.featured || false,
    community: data.community || '',
    bedrooms: data.bedrooms ? parseInt(data.bedrooms) : null,
    bathrooms: data.bathrooms ? parseFloat(data.bathrooms) : null,
    sqft: data.sqft ? parseInt(data.sqft) : null,
    lot_size: data.lotSize || null,
    price_monthly: data.priceMonthly ? parseFloat(data.priceMonthly) : null,
    price_nightly: data.priceNightly ? parseFloat(data.priceNightly) : null,
    listing_type: data.listingType || 'rental',
    sale_price: data.salePrice ? parseFloat(data.salePrice) : null,
    deposit: data.deposit ? parseFloat(data.deposit) : null,
    rental_mode: data.rentalMode || 'both',
    poa: data.poa || false,
    images: Array.isArray(data.images) ? data.images : [],
    amenities: Array.isArray(data.amenities) ? data.amenities : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
    host_name: data.hostName || null,
    contact_email: data.contactEmail || null,
    contact_phone: data.contactPhone || null,
    meta_title: data.metaTitle || null,
    meta_description: data.metaDesc || null,
    lat: data.lat ? parseFloat(data.lat) : null,
    lng: data.lng ? parseFloat(data.lng) : null,
  };
}

function slugify(str = '') {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Public Listings API ──────────────────────────────────────

const ListingsAPI = {

  // ── Public: anyone can read active listings (no token needed)
  async getPublic() {
    const rows = await _sbGet(
      'listings?select=*&status=eq.active&order=created_at.desc'
    );
    return rows.map(normalise);
  },

  // ── Admin/host: read ALL listings (needs valid JWT)
  // RLS will return only the rows the user is allowed to see:
  //   admin  → all rows
  //   host   → their own rows
  async getAll() {
    const token = await Auth.getToken();
    const user = await Auth.getUser();

    // Admins see all listings, hosts only see their own
    var query = 'listings?select=*&order=created_at.desc';
    if (user && user.role === 'host') {
      query += '&owner_id=eq.' + user.id;
    }

    const rows = await _sbGet(query, token);
    return rows.map(normalise);
  },

  // ── Create a new listing (needs valid JWT)
  // owner_id is set to the logged-in user's ID automatically.
  async save(data) {
    const token = await Auth.getToken();
    const session = await Auth.getSession();
    const userId = session
      ? JSON.parse(atob(session.access_token.split('.')[1])).sub
      : null;

    // Fetch host profile to auto-populate contact details
    const profile = await Auth.getUser();

    const payload = {
      ...denormalise(data),
      owner_id: userId,
      host_name: profile?.fullName || null,
      contact_email: profile?.email || null,
      contact_phone: data.contactPhone || null,
    };

    const rows = await _sbPost('listings', payload, token);
    return Array.isArray(rows) ? normalise(rows[0]) : normalise(rows);
  },

  // ── Update an existing listing by id (needs valid JWT)
  async update(id, data) {
    const token = await Auth.getToken();
    const payload = denormalise(data);
    const rows = await _sbPatch(`listings?id=eq.${id}`, payload, token);
    return Array.isArray(rows) ? normalise(rows[0]) : normalise(rows);
  },

  // ── Delete a listing by id (needs valid JWT)
  async delete(id) {
    const token = await Auth.getToken();
    return _sbDelete(`listings?id=eq.${id}`, token);
  },
};

// ── Bootstrap for main.js ────────────────────────────────────
// main.js checks window.LISTINGS; if it finds a Promise it awaits it.
// This means zero changes to main.js are required.

window.LISTINGS_PROMISE = ListingsAPI.getPublic()
  .then(listings => {
    window.LISTINGS = listings;
    // If main.js has already run and exposed renderListings, re-render now.
    if (typeof window.renderListings === 'function') window.renderListings();
    return listings;
  })
  .catch(err => {
    console.error('[ValleVivo] Could not load listings from Supabase:', err);
    window.LISTINGS = [];
  });

// Expose so admin.html and any other page can use it directly
window.ListingsAPI = ListingsAPI;