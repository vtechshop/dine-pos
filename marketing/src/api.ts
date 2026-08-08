const WA_NUMBER = '916381356683';
const API_BASE  = import.meta.env.VITE_API_URL as string | undefined;

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
  // Open WhatsApp immediately — must be synchronous with the user gesture
  // so the browser does not treat it as a popup and block it.
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

  // Persist to DB — saves lead, emits new_lead socket event to SA, sends confirmation emails.
  // Fire after WhatsApp so the popup is never blocked, but await so the caller gets a proper id.
  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/inquiries/demo`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; id?: string };
      if (res.ok) {
        return { message: data.message ?? 'Demo booked! We will confirm your slot shortly.', id: String(data.id ?? Date.now()) };
      }
    } catch { /* non-fatal — WhatsApp already opened */ }
  }

  return { message: 'WhatsApp opened', id: Date.now().toString() };
};

export const submitContact = async (body: {
  name: string;
  email: string;
  phone?: string;
  restaurant?: string;
  message: string;
}): Promise<InquiryResponse> => {
  if (!API_BASE) {
    throw new Error('Contact form is not configured. Please reach us at info@happya.in');
  }

  const res = await fetch(`${API_BASE}/inquiries/contact`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as { message?: string; id?: string };

  if (!res.ok) {
    throw new Error(data.message ?? 'Failed to send message. Please try again or email us at info@happya.in');
  }

  return { message: data.message ?? 'Message sent', id: String(data.id ?? Date.now()) };
};
