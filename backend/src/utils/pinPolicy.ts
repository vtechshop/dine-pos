export interface PinValidationResult {
  valid: boolean;
  message?: string;
}

export const validatePin = (raw: unknown): PinValidationResult => {
  const pin = String(raw ?? '').trim();

  if (!pin) {
    return { valid: false, message: 'PIN is required' };
  }
  if (!/^\d+$/.test(pin)) {
    return { valid: false, message: 'PIN must contain digits only — no letters or symbols' };
  }
  if (pin.length < 4) {
    return { valid: false, message: 'PIN must be at least 4 digits' };
  }
  if (pin.length > 6) {
    return { valid: false, message: 'PIN must be at most 6 digits' };
  }
  // Reject all repeated digits: 0000, 1111, 9999
  if (/^(\d)\1+$/.test(pin)) {
    return { valid: false, message: 'PIN is too simple — avoid repeated digits (e.g. 1111)' };
  }
  // Reject ascending sequences: 1234, 2345, 0123, 012345
  const asc = [...pin].every((c, i) => i === 0 || +c === +pin[i - 1] + 1);
  if (asc) {
    return { valid: false, message: 'PIN is too simple — avoid sequential digits (e.g. 1234)' };
  }
  // Reject descending sequences: 9876, 4321, 987654
  const desc = [...pin].every((c, i) => i === 0 || +c === +pin[i - 1] - 1);
  if (desc) {
    return { valid: false, message: 'PIN is too simple — avoid sequential digits (e.g. 9876)' };
  }

  return { valid: true };
};
