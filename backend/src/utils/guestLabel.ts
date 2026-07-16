/**
 * Converts a 1-based slot number to an Excel-style alphabetic label.
 * 1→A, 2→B, …, 26→Z, 27→AA, 28→AB, …, 52→AZ, 53→BA, …
 * Supports unlimited guests without ever falling back to numeric suffixes.
 */
const toAlpha = (n: number): string => {
  let result = '';
  while (n > 0) {
    n--;                                          // convert to 0-indexed
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
};

export const guestLabel = (guestNumber: number): string =>
  `Guest ${toAlpha(guestNumber)}`;
