// Shared field-level validation rules.
// SYNC: mobile/src/utils/validation.ts must stay identical to this file.
export const PHONE_RE   = /^\d{10}$/;
export const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GST_RE     = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/;
export const FSSAI_RE   = /^\d{14}$/;
export const PINCODE_RE = /^\d{6}$/;

export const validatePhone   = (v: string) => PHONE_RE.test(v.trim());
export const validateEmail   = (v: string) => EMAIL_RE.test(v.trim());
export const validateGST     = (v: string) => GST_RE.test(v.trim().toUpperCase());
export const validateFSSAI   = (v: string) => FSSAI_RE.test(v.trim());
export const validatePincode = (v: string) => PINCODE_RE.test(v.trim());
