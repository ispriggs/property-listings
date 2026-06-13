// ============================================================
// js/api/saved.js — Saved / favourite listings
// ============================================================
import { dbGet, dbPost, dbDelete, getUserId } from './db.js';

export const SavedAPI = {
  async getIds() {
    const rows = await dbGet('saved_listings?select=listing_id');
    return new Set(rows.map(r => r.listing_id));
  },

  async save(listingId) {
    const userId = await getUserId();
    if (!userId) throw new Error('Not authenticated');
    await dbPost('saved_listings', { user_id: userId, listing_id: listingId }, 'return=minimal');
  },

  async remove(listingId) {
    await dbDelete(`saved_listings?listing_id=eq.${listingId}`);
  },
};
