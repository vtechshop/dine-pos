// Support contact details — single source for every "contact support" link.
export const SUPPORT_PHONE    = '+917871469095';
export const SUPPORT_WHATSAPP = '917871469095';
export const SUPPORT_EMAIL    = 'support@dinepos.in';

export function supportWhatsAppUrl(message = 'Hi, I need help with Dine POS.'): string {
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`;
}
