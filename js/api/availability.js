// ============================================================
// js/api/availability.js — Availability windows, bookings,
//   and blocked dates
// ============================================================
import { dbGet } from './db.js';

export const AvailabilityAPI = {
  // Full calendar data for one listing (used by the booking calendar).
  async getForListing(listingId) {
    const [windows, booked, blocked] = await Promise.all([
      dbGet(`availability?listing_id=eq.${listingId}&order=start_date.asc&select=*`),
      dbGet(`bookings?listing_id=eq.${listingId}&status=eq.accepted&select=start_date,end_date`),
      dbGet(`blocked_dates?listing_id=eq.${listingId}&select=start_date,end_date`),
    ]);
    return { windows, booked, blocked };
  },

  // Returns a Set of listing IDs that are available for the given range, or
  // null when no availability data exists (caller treats null as "show all").
  async getAvailableIds(checkIn, checkOut) {
    const [availRows, bookRows, blockedRows] = await Promise.all([
      dbGet(`availability?start_date=lte.${checkIn}&end_date=gte.${checkOut}&select=listing_id`),
      dbGet(`bookings?status=eq.accepted&start_date=lt.${checkOut}&end_date=gt.${checkIn}&select=listing_id`),
      dbGet(`blocked_dates?start_date=lt.${checkOut}&end_date=gt.${checkIn}&select=listing_id`),
    ]);
    if (!availRows.length) return null;
    const excluded = new Set([
      ...bookRows.map(r => r.listing_id),
      ...blockedRows.map(r => r.listing_id),
    ]);
    return new Set(availRows.map(r => r.listing_id).filter(id => !excluded.has(id)));
  },
};
