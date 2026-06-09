// Shared utility functions — import what you need, no side-effects.

// ── DOM helpers ────────────────────────────────────────────────
export const $ = (sel, ctx = document) => ctx.querySelector(sel);
export const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ── HTML escaping ──────────────────────────────────────────────
export const esc = str =>
  String(str).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// ── Currency format ────────────────────────────────────────────
export const fmt = n => (n ? '$' + Number(n).toLocaleString() : null);

// ── Cloudinary URL optimisation ────────────────────────────────
export function clImg(url, w) {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  const t = 'f_auto,q_auto' + (w ? ',w_' + w : '');
  return url.replace('/upload/', '/upload/' + t + '/');
}

// ── Community lookup tables ────────────────────────────────────
export const COMMUNITY_NAMES = {
  'la-ecovilla': 'La Ecovilla (LEV)',
  'san-mateo':   'Ecovilla San Mateo (ESM)',
};
export const COMMUNITY_COLORS = {
  'la-ecovilla': '#4a7c59',
  'san-mateo':   '#3a6b7c',
};
export const communityName  = id => COMMUNITY_NAMES[id]  || id;
export const communityColor = id => COMMUNITY_COLORS[id] || '#9e9589';

// ── Date helpers ───────────────────────────────────────────────
export function toCalYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fmtAvailDate(str) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, mo, d] = str.split('-');
  return `${parseInt(d)} ${months[parseInt(mo) - 1]} ${y}`;
}

// ── Toast notifications ────────────────────────────────────────
export function showToast(msg, type = 'default', dur = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const icons = { success: '✓', error: '✕', default: 'ℹ' };
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || icons.default}</span><span>${esc(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.cssText = 'opacity:0;transform:translateX(40px);transition:all .3s ease';
    setTimeout(() => toast.remove(), 350);
  }, dur);
}
