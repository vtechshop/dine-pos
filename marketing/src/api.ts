import emailjs from '@emailjs/browser';

const WA_NUMBER   = '916381356683';
const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID as string;
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_CONTACT_TEMPLATE_ID as string;
const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string;

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
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    throw new Error('Email service is not configured. Please reach us at info@happya.in');
  }

  const result = await emailjs.send(
    SERVICE_ID,
    TEMPLATE_ID,
    {
      from_name:  body.name,
      from_email: body.email,
      from_phone: body.phone ?? '',
      restaurant: body.restaurant ?? '',
      message:    body.message,
    },
    { publicKey: PUBLIC_KEY },
  );

  if (result.status !== 200) {
    throw new Error('Failed to send message. Please try again or email us at info@happya.in');
  }

  return { message: 'Message sent', id: result.text };
};
