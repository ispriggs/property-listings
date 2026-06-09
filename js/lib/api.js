// ============================================================
// js/lib/api.js — Ecovilla Rentals Data Layer
// ES module: import { ListingsAPI } from './api.js'
// ============================================================
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';
import { Auth } from './auth.js';

const REST = `${SUPABASE_URL}/rest/v1`;

// ── Low-level REST helpers ───────────────────────────────────

async function _get(path, token) {
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

async function _post(path, payload, token) {
  _requireToken(token);
  const res = await fetch(`${REST}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function _patch(path, payload, token) {
  _requireToken(token);
  const res = await fetch(`${REST}/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function _delete(path, token) {
  _requireToken(token);
  const res = await fetch(`${REST}/${path}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return true;
}

function _requireToken(token) {
  if (!token) throw new Error('Not authenticated — please sign in.');
}

// ── Shape converters ─────────────────────────────────────────

export function normalise(row) {
  return {
    id:             row.id,
    title:          row.title,
    slug:           row.slug || '',
    minStayNights:  row.min_stay_nights || 1,
    description:    row.description || '',
    type:           row.property_type || 'Other',
    status:         row.status,
    featured:       row.featured,
    community:      row.community || '',
    bedrooms:       row.bedrooms ?? 0,
    bathrooms:      row.bathrooms ?? 0,
    sqft:           row.sqft ?? null,
    lotSize:        row.lot_size ?? null,
    priceMonthly:   row.price_monthly ?? null,
    priceNightly:   row.price_nightly ?? null,
    listingType:    row.listing_type || 'rental',
    salePrice:      row.sale_price ?? null,
    deposit:        row.deposit ?? null,
    rentalMode:     row.rental_mode || 'both',
    poa:            row.poa || false,
    images:         row.images || [],
    image:          (row.images || [])[0] || '',
    amenities:      row.amenities || [],
    tags:           row.tags || [],
    hostName:       row.host_name || '',
    contactEmail:   row.contact_email || '',
    contactPhone:   row.contact_phone || '',
    metaTitle:      row.meta_title || '',
    metaDesc:       row.meta_description || '',
    lat:            row.lat ?? null,
    lng:            row.lng ?? null,
    ownerId:        row.owner_id ?? null,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
    maxGuests:      row.max_guests ?? null,
    cleaningFee:    row.cleaning_fee ?? null,
    securityDeposit: row.security_deposit ?? null,
    petsAllowed:    row.pets_allowed || false,
    minStayNights:  row.min_stay_nights || 1,
  };
}

function _denormalise(data) {
  return {
    title:          data.title,
    slug:           data.slug || _slugify(data.title),
    description:    data.description || null,
    min_stay_nights: data.minStayNights ? parseInt(data.minStayNights) : 1,
    property_type:  data.type || 'Other',
    status:         data.status || 'draft',
    featured:       data.featured || false,
    community:      data.community || '',
    bedrooms:       data.bedrooms ? parseInt(data.bedrooms) : null,
    bathrooms:      data.bathrooms ? parseFloat(data.bathrooms) : null,
    sqft:           data.sqft ? parseInt(data.sqft) : null,
    lot_size:       data.lotSize || null,
    price_monthly:  data.priceMonthly ? parseFloat(data.priceMonthly) : null,
    price_nightly:  data.priceNightly ? parseFloat(data.priceNightly) : null,
    listing_type:   data.listingType || 'rental',
    sale_price:     data.salePrice ? parseFloat(data.salePrice) : null,
    rental_mode:    data.rentalMode || 'both',
    poa:            data.poa || false,
    images:         Array.isArray(data.images) ? data.images : [],
    amenities:      Array.isArray(data.amenities) ? data.amenities : [],
    tags:           Array.isArray(data.tags) ? data.tags : [],
    host_name:      data.hostName || null,
    contact_email:  data.contactEmail || null,
    contact_phone:  data.contactPhone || null,
    max_guests:     data.maxGuests ? parseInt(data.maxGuests) : null,
    cleaning_fee:   data.cleaningFee ? parseFloat(data.cleaningFee) : null,
    security_deposit: data.securityDeposit ? parseFloat(data.securityDeposit) : null,
    pets_allowed:   data.petsAllowed || false,
  };
}

function _slugify(str = '') {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Public Listings API ──────────────────────────────────────

export const ListingsAPI = {

  async getPublic() {
    const rows = await _get(
      'listings?select=id,title,description,property_type,status,featured,community,' +
      'bedrooms,bathrooms,sqft,price_monthly,price_nightly,listing_type,sale_price,poa,' +
      'images,amenities,host_name,contact_email,contact_phone,max_guests,pets_allowed,' +
      'cleaning_fee,security_deposit,rental_mode,min_stay_nights,owner_id,created_at' +
      '&status=eq.active&order=created_at.desc'
    );
    return rows.map(normalise);
  },

  async getAll() {
    const token = await Auth.getToken();
    const user  = await Auth.getUser();
    let query = 'listings?select=*&order=created_at.desc';
    if (user?.role === 'host') query += `&owner_id=eq.${user.id}`;
    else if (user?.role === 'admin' && user.adminCommunity) query += `&community=eq.${user.adminCommunity}`;
    const rows = await _get(query, token);
    return rows.map(normalise);
  },

  async save(data) {
    const token   = await Auth.getToken();
    const session = await Auth.getSession();
    const userId  = session ? _parseJwt(session.access_token).sub : null;
    const profile = await Auth.getUser();
    const payload = {
      ..._denormalise(data),
      owner_id:      userId,
      host_name:     profile?.fullName || null,
      contact_email: profile?.email || null,
    };
    const rows = await _post('listings', payload, token);
    return Array.isArray(rows) ? normalise(rows[0]) : normalise(rows);
  },

  async update(id, data) {
    const token = await Auth.getToken();
    const rows  = await _patch(`listings?id=eq.${id}`, _denormalise(data), token);
    return Array.isArray(rows) ? normalise(rows[0]) : normalise(rows);
  },

  async delete(id) {
    const token = await Auth.getToken();
    return _delete(`listings?id=eq.${id}`, token);
  },
};

function _parseJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch (_) { return {}; }
}

// Backward-compat global for host.html inline scripts
window.ListingsAPI = ListingsAPI;
