// Support tickets for the Super Admin console. These live at /api/tickets
// (not under /api/superadmin) and use the Super Admin token.

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';

export type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed';

export interface TicketReply {
  message:   string;
  by:        'hotel' | 'superadmin';
  createdAt: string;
}

export interface SupportTicket {
  _id:         string;
  hotelId?:    string | null;
  hotelName:   string;
  hotelPhone:  string;
  subject:     string;
  description: string;
  category:    'technical' | 'billing' | 'account' | 'other';
  priority:    'low' | 'medium' | 'high';
  status:      TicketStatus;
  replies:     TicketReply[];
  createdAt:   string;
  updatedAt:   string;
}

async function ticketFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('sa_token');
  const res = await fetch(`${API}/tickets${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('sa_token');
    localStorage.removeItem('pos_role');
    window.location.replace('/super-admin/login');
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** All tickets, newest first. */
export const fetchTickets = () => ticketFetch<SupportTicket[]>('?status=all');

export const replyToTicket = (id: string, message: string) =>
  ticketFetch<SupportTicket>(`/${id}/admin-reply`, { method: 'POST', body: JSON.stringify({ message }) });

export const setTicketStatus = (id: string, status: TicketStatus) =>
  ticketFetch<SupportTicket>(`/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
