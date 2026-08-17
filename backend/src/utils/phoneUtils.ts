/**
 * phoneUtils.ts — Shared E.164 phone normalization.
 *
 * Used by: loyaltyRoutes.ts, orderRoutes.ts, and any future path
 * that stores a phone on CustomerProfile.
 *
 * Returns null when the input cannot be resolved to a valid E.164 number so
 * callers can decide whether to skip profile matching or surface a validation
 * error to the user.
 *
 * Only India (+91) heuristics are applied for 10/11/12-digit inputs.
 * Explicitly E.164-prefixed strings (starting with '+') are accepted as-is
 * provided they contain ≥ 10 digits total.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits  = trimmed.replace(/\D/g, '');

  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (trimmed.startsWith('+') && digits.length >= 10) return `+${digits}`;

  return null;
}
