// ============================================================
// js/api/bookings.js — Booking creation and lookups
// ============================================================
import { dbGet, dbPost, getUserId } from './db.js';

export const BookingsAPI = {
  async create({ listingId, checkIn, checkOut, message }) {
    const userId = await getUserId();
    if (!userId) throw new Error('Not authenticated');
    const rows = await dbPost('bookings', {
      listing_id:   listingId,
      requester_id: userId,
      start_date:   checkIn,
      end_date:     checkOut,
      message:      message || null,
      status:       'pending',
    });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async getHostId(listingId) {
    const rows = await dbGet(`listings?id=eq.${listingId}&select=owner_id`);
    return rows[0]?.owner_id ?? null;
  },
};
