/**
 * generateUpiUri — builds a spec-compliant UPI deep-link for payment requests.
 * @param pa  Payee VPA (UPI ID), e.g. "shop@upi"
 * @param pn  Payee display name
 * @param amountRupees  Amount in rupees (will be formatted to 2 dp)
 * @param tn  Transaction note shown in the customer's UPI app
 */
export function generateUpiUri(pa: string, pn: string, amountRupees: number, tn: string): string {
  const params = new URLSearchParams({
    pa: pa,
    pn: pn,
    am: amountRupees.toFixed(2),
    cu: 'INR',
    tn: tn,
  });
  return `upi://pay?${params.toString()}`;
}

/**
 * generateWhatsAppBillUrl — builds a wa.me deep-link pre-filled with message text.
 * Returns '' when the phone number is invalid so the caller can gate on it.
 * @param phone  Raw phone string (handled formats: +91XXXXXXXXXX, 91XXXXXXXXXX, XXXXXXXXXX)
 * @param message  Pre-filled message text
 */
export function generateWhatsAppBillUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  let e164 = digits;
  if (digits.length === 10) e164 = `91${digits}`;
  else if (digits.length === 11 && digits.startsWith('0')) e164 = `91${digits.slice(1)}`;
  if (e164.length < 12) return '';
  return `https://wa.me/${e164}?text=${encodeURIComponent(message)}`;
}
