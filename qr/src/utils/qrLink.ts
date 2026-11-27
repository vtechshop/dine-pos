// Phase 5 · Batch 4 (P4-QR-12): the hotel and table live only in the link the guest scanned
// (?hotel=…&table=…). Every in-app link and navigation keeps them, so a refresh on any page
// still knows where the guest is.
let qrQuery = '';

/** Called once by App with the scanned link's hotel and table. */
export function setQrQuery(hotelId: string, tableNumber: string): void {
  qrQuery = new URLSearchParams({ hotel: hotelId, table: tableNumber }).toString();
}

/** `path` with the scanned hotel and table, e.g. qrPath('/bill') → '/bill?hotel=…&table=…'. */
export function qrPath(path: string): string {
  return qrQuery ? `${path}?${qrQuery}` : path;
}
