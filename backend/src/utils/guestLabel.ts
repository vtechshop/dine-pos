/**
 * Returns a human-readable label for a guest slot.
 * Slots 1–26 → "Guest A"–"Guest Z"; beyond 26 → "Guest 27", "Guest 28", etc.
 */
export const guestLabel = (guestNumber: number): string =>
  guestNumber >= 1 && guestNumber <= 26
    ? `Guest ${String.fromCharCode(64 + guestNumber)}`
    : `Guest ${guestNumber}`;
