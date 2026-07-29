const WA_NUMBER = '916381356683';
const EMAIL     = 'info@happya.in';

export interface InquiryResponse {
  message: string;
  id: string;
}

export const submitDemo = async (body: {
  name: string;
  email: string;
  phone: string;
  restaurant?: string;
  outlets?: string;
  preferredDate?: string;
  preferredTime?: string;
  notes?: string;
}): Promise<InquiryResponse> => {
  const lines = [
    "Hi, I'd like to book a free DinePOS demo.",
    '',
    `Name: ${body.name}`,
    `Email: ${body.email}`,
    `Phone: ${body.phone}`,
    body.restaurant    ? `Restaurant: ${body.restaurant}` : null,
    body.outlets       ? `Outlets: ${body.outlets}` : null,
    body.preferredDate ? `Preferred date: ${body.preferredDate}` : null,
    body.preferredTime ? `Preferred time: ${body.preferredTime} IST` : null,
    body.notes         ? `\nI'd like to see: ${body.notes}` : null,
  ].filter((l): l is string => l !== null).join('\n');

  window.open(
    `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(lines)}`,
    '_blank',
    'noopener,noreferrer',
  );

  return { message: 'WhatsApp opened', id: Date.now().toString() };
};

export const submitContact = async (body: {
  name: string;
  email: string;
  phone?: string;
  restaurant?: string;
  message: string;
}): Promise<InquiryResponse> => {
  const subject = `Message from ${body.name} — Dine POS`;
  const text = [
    `Name: ${body.name}`,
    `Email: ${body.email}`,
    body.phone      ? `Phone: ${body.phone}` : null,
    body.restaurant ? `Restaurant: ${body.restaurant}` : null,
    '',
    body.message,
  ].filter((l): l is string => l !== null).join('\n');

  window.location.href =
    `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

  return { message: 'Email client opened', id: Date.now().toString() };
};
