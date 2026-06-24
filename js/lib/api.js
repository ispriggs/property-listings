// ============================================================
// js/lib/api.js — Ecovilla Rentals Listings Data Layer
// ES module: import { ListingsAPI, normalise } from './api.js'
// ============================================================
import { Auth } from './auth.js';
import { dbGet, dbPost, dbPatch, dbDelete, getUserId } from '../api/db.js';

// ── Shape converters ─────────────────────────────────────────

export function normalise(row) {
  return {
    id:              row.id,
    title:           row.title,
    slug:            row.slug || '',
    minStayNights:   row.min_stay_nights || 1,
    description:     row.description || '',
    type:            row.property_type || 'Other',
    status:          row.status,
    featured:        row.featured,
    community:       row.community || '',
    bedrooms:        row.bedrooms ?? 0,
    bathrooms:       row.bathrooms ?? 0,
    sqft:            row.sqft ?? null,
    lotSize:         row.lot_size ?? null,
    priceMonthly:    row.price_monthly ?? null,
    priceNightly:    row.price_nightly ?? null,
    listingType:     row.listing_type || 'rental',
    salePrice:       row.sale_price ?? null,
    deposit:         row.deposit ?? null,
    rentalMode:      row.rental_mode || 'both',
    poa:             row.poa || false,
    images:          row.images || [],
    image:           (row.images || [])[0] || '',
    amenities:       row.amenities || [],
    tags:            row.tags || [],
    hostName:        row.host_name || '',
    contactEmail:    row.contact_email || '',
    contactPhone:    row.contact_phone || '',
    metaTitle:       row.meta_title || '',
    metaDesc:        row.meta_description || '',
    lat:             row.lat ?? null,
    lng:             row.lng ?? null,
    ownerId:         row.owner_id ?? null,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
    maxGuests:       row.max_guests ?? null,
    cleaningFee:     row.cleaning_fee ?? null,
    securityDeposit: row.security_deposit ?? null,
    petsAllowed:     row.pets_allowed || false,
    smokingAllowed:  row.smoking_allowed || false,
    partiesAllowed:  row.parties_allowed || false,
    shoesInside:     row.shoes_inside || false,
    lotId:           row.lot_id ?? null,
  };
}

function _denormalise(data) {
  return {
    title:            data.title,
    slug:             data.slug || _slugify(data.title),
    description:      data.description || null,
    min_stay_nights:  data.minStayNights ? parseInt(data.minStayNights) : 1,
    property_type:    data.type || 'Other',
    status:           data.status || 'draft',
    featured:         data.featured || false,
    community:        data.community || '',
    bedrooms:         data.bedrooms ? parseInt(data.bedrooms) : null,
    bathrooms:        data.bathrooms ? parseFloat(data.bathrooms) : null,
    sqft:             data.sqft ? parseInt(data.sqft) : null,
    lot_size:         data.lotSize || null,
    price_monthly:    data.priceMonthly ? parseFloat(data.priceMonthly) : null,
    price_nightly:    data.priceNightly ? parseFloat(data.priceNightly) : null,
    listing_type:     data.listingType || 'rental',
    sale_price:       data.salePrice ? parseFloat(data.salePrice) : null,
    rental_mode:      data.rentalMode || 'both',
    poa:              data.poa || false,
    images:           Array.isArray(data.images) ? data.images : [],
    amenities:        Array.isArray(data.amenities) ? data.amenities : [],
    tags:             Array.isArray(data.tags) ? data.tags : [],
    host_name:        data.hostName || null,
    contact_email:    data.contactEmail || null,
    contact_phone:    data.contactPhone || null,
    max_guests:       data.maxGuests ? parseInt(data.maxGuests) : null,
    cleaning_fee:     data.cleaningFee ? parseFloat(data.cleaningFee) : null,
    security_deposit: data.securityDeposit ? parseFloat(data.securityDeposit) : null,
    pets_allowed:     data.petsAllowed || false,
    smoking_allowed:  data.smokingAllowed || false,
    parties_allowed:  data.partiesAllowed || false,
    shoes_inside:     data.shoesInside || false,
    lot_id:           data.lotId || null,
  };
}

function _slugify(str = '') {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Public Listings API ──────────────────────────────────────

export const ListingsAPI = {

  async getPublic() {
    const rows = await dbGet(
      'listings?select=id,title,description,property_type,status,featured,community,' +
      'bedrooms,bathrooms,sqft,price_monthly,price_nightly,listing_type,sale_price,poa,' +
      'images,amenities,host_name,contact_email,contact_phone,max_guests,pets_allowed,' +
      'cleaning_fee,security_deposit,rental_mode,min_stay_nights,owner_id,created_at' +
      '&status=eq.active&order=created_at.desc'
    );
    return rows.map(normalise);
  },

  async getAll() {
    const user  = await Auth.getUser();
    let query = 'listings?select=*&status=neq.archived&order=created_at.desc';
    // Default-deny: only a true super admin (role=admin, no community) sees all.
    // A community admin is scoped to their community; everyone else (host, user,
    // null/unknown role, not-logged-in) is scoped to their own listings.
    if (user?.role === 'admin') {
      if (user.adminCommunity) query += `&community=eq.${user.adminCommunity}`;
    } else {
      query += `&owner_id=eq.${user?.id ?? '00000000-0000-0000-0000-000000000000'}`;
    }
    const rows = await dbGet(query);
    return rows.map(normalise);
  },

  async getById(id) {
    const rows = await dbGet(`listings?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    if (!rows.length) throw new Error('Listing not found');
    return normalise(rows[0]);
  },

  async save(data) {
    const userId  = await getUserId();
    const profile = await Auth.getUser();
    const payload = {
      ..._denormalise(data),
      owner_id:      userId,
      host_name:     profile?.fullName || null,
      contact_email: profile?.email || null,
    };
    const rows = await dbPost('listings', payload);
    return Array.isArray(rows) ? normalise(rows[0]) : normalise(rows);
  },

  async update(id, data) {
    const rows = await dbPatch(`listings?id=eq.${id}`, _denormalise(data), 'return=representation');
    return Array.isArray(rows) ? normalise(rows[0]) : normalise(rows);
  },

  // Soft delete — archive the listing so its bookings, conversations and
  // payment history are preserved (a hard DELETE is blocked by those FKs anyway).
  // Archived listings are hidden from host/admin dashboards (getAll filters them)
  // and from public pages (getPublic only returns active).
  async delete(id) {
    const rows = await dbPatch(`listings?id=eq.${id}`, { status: 'archived' }, 'return=representation');
    if (Array.isArray(rows) && rows.length === 0) return { id };
    return Array.isArray(rows) ? normalise(rows[0]) : normalise(rows);
  },
};

// Backward-compat global for host.html inline scripts
window.ListingsAPI = ListingsAPI;
