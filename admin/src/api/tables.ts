import { apiFetch } from './client';

export interface Table {
  _id:      string;
  number:   number;
  name:     string;
  capacity: number;
  section:  string;
  isActive: boolean;
  hotelId:  string;
}

export const fetchTables = () =>
  apiFetch<Table[]>('/tables');

// ── QR Management — NOT YET IMPLEMENTED IN BACKEND ───────────────────────────
// Required endpoints:
//   GET  /qr                         — list all QR codes
//   POST /qr/generate                — generate QR for restaurant / table
//   POST /qr/bulk-generate           — bulk generate for all tables
//   GET  /qr/:id                     — QR detail + analytics
//   PATCH /qr/:id/disable            — disable QR
//   PATCH /qr/:id/enable             — enable QR
//   PATCH /qr/:id/replace            — regenerate QR token (invalidate old)
//   DELETE /qr/:id                   — delete QR
//   GET  /qr/:id/analytics           — scan count, orders, revenue
//   GET  /qr/analytics/summary       — today's scans, popular tables
