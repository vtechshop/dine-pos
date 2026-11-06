const WA_NUMBER = '916381356683';
const API_BASE  = import.meta.env.VITE_API_URL as string | undefined;

export interface InquiryResponse {
  message: string;
  id: string;
}

export interface DemoRequest {
  name: string;
  email: string;
  phone: string;
  restaurant?: string;
  outlets?: string;
  preferredDate?: string;
  preferredTime?: string;
  notes?: string;
}

/** wa.me link to the DinePOS team with the demo details pre-filled. */
export function demoWhatsAppUrl(body: DemoRequest): string {
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
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(lines)}`;
}

/**
 * Saves the demo request (lead for the team + confirmation emails). Stays on the page —
 * no WhatsApp tab. Throws with a readable message if it could not be saved.
 */
export const submitDemo = async (body: DemoRequest): Promise<InquiryResponse> => {
  if (!API_BASE) {
    throw new Error('Demo booking is not available right now. Please call or WhatsApp us on +91 63813 56683.');
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/inquiries/demo`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not send your request — please check your internet and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as { message?: string; id?: string };
  if (!res.ok) {
    // Show the server's reason for a form problem (e.g. invalid email); a plain message otherwise
    throw new Error(res.status < 500 && data.message ? data.message : 'Could not send your request. Please try again in a minute.');
  }
  return { message: data.message ?? 'Demo booked! We will confirm your slot shortly.', id: String(data.id ?? Date.now()) };
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
