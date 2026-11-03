// Hotel-side support tickets. The hotel comes from the signed-in token, never
// from the request — a hotel can only see and reply to its own tickets.
import { apiFetch } from './client';

export type TicketStatus   = 'open' | 'in-progress' | 'resolved' | 'closed';
export type TicketCategory = 'technical' | 'billing' | 'account' | 'other';
export type TicketPriority = 'low' | 'medium' | 'high';

export interface TicketReply {
  message:   string;
  by:        'hotel' | 'superadmin';
  createdAt: string;
}

export interface HotelTicket {
  _id:         string;
  subject:     string;
  description: string;
  category:    TicketCategory;
  priority:    TicketPriority;
  status:      TicketStatus;
  replies:     TicketReply[];
  createdAt:   string;
  updatedAt:   string;
}

/** This hotel's tickets, newest first. (The path segment is ignored by the server.) */
export const fetchMyTickets = () => apiFetch<HotelTicket[]>('/tickets/hotel/me');

export const raiseTicket = (body: { subject: string; description: string; category: TicketCategory; priority: TicketPriority }) =>
  apiFetch<HotelTicket>('/tickets', { method: 'POST', body: JSON.stringify(body) });

export const replyToMyTicket = (id: string, message: string) =>
  apiFetch<HotelTicket>(`/tickets/${id}/reply`, { method: 'POST', body: JSON.stringify({ message }) });
