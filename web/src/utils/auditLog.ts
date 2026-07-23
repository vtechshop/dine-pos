export interface AuditEntry {
  action: string;
  detail: string;
  cashierName: string;
  cashierId: string;
  timestamp: string;
}

const MAX_ENTRIES = 500;

export function logAuditEntry(hotelId: string, entry: AuditEntry): void {
  if (!hotelId) return;
  const key = `pos_audit_${hotelId}`;
  try {
    const existing = JSON.parse(localStorage.getItem(key) ?? '[]') as AuditEntry[];
    const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(key, JSON.stringify(updated));
  } catch { /* ignore quota errors */ }
}

export function getAuditLog(hotelId: string): AuditEntry[] {
  if (!hotelId) return [];
  try {
    return JSON.parse(localStorage.getItem(`pos_audit_${hotelId}`) ?? '[]') as AuditEntry[];
  } catch { return []; }
}

export function clearAuditLog(hotelId: string): void {
  if (!hotelId) return;
  localStorage.removeItem(`pos_audit_${hotelId}`);
}
