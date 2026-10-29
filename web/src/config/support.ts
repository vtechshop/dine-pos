// Support contact details — single source for every "contact support" link.
export const SUPPORT_PHONE         = '+916381356683';
export const SUPPORT_PHONE_DISPLAY = '+91 63813 56683';
export const SUPPORT_WHATSAPP      = '916381356683';
export const SUPPORT_EMAIL         = 'info@happya.in';

/** In-app route of the public support page (works signed in or out). */
export const SUPPORT_PAGE = '/support';

export function supportWhatsAppUrl(message = 'Hi, I need help with Dine POS.'): string {
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`;
}
