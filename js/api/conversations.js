// ============================================================
// js/api/conversations.js — Conversations and messages
// ============================================================
import { dbGet, dbPost, getUserId } from './db.js';

export const ConversationsAPI = {
  // Finds an existing conversation for this listing+user pair, or creates one.
  // Returns the conversation ID, or null on failure.
  async findOrCreate(listingId, hostId, bookingId) {
    const userId = await getUserId();
    if (!userId) return null;
    const existing = await dbGet(
      `conversations?listing_id=eq.${listingId}&user_id=eq.${userId}&select=id&limit=1`
    );
    if (existing[0]?.id) return existing[0].id;
    const rows = await dbPost('conversations', {
      listing_id: listingId,
      host_id:    hostId,
      user_id:    userId,
      booking_id: bookingId,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row?.id ?? null;
  },

  async sendMessage(convId, body) {
    const userId = await getUserId();
    if (!userId) throw new Error('Not authenticated');
    await dbPost('messages', {
      conversation_id: convId,
      sender_id:       userId,
      body,
    }, 'return=minimal');
  },
};
