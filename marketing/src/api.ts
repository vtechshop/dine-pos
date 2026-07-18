const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://api.dinepos.com';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ message: 'Unexpected server error' }));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? 'Request failed');
  return data as T;
}

export interface InquiryResponse {
  message: string;
  id: string;
}

export const submitContact = (body: {
  name: string;
  email: string;
  phone?: string;
  restaurant?: string;
  message: string;
}) => post<InquiryResponse>('/api/inquiries/contact', body);

export const submitDemo = (body: {
  name: string;
  email: string;
  phone: string;
  restaurant?: string;
  outlets?: string;
  preferredDate?: string;
  preferredTime?: string;
  notes?: string;
}) => post<InquiryResponse>('/api/inquiries/demo', body);
