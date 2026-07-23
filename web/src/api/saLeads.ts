const SA_BASE = `${import.meta.env.VITE_API_URL ?? ''}/superadmin`;

function saToken(): string {
  return localStorage.getItem('sa_token') ?? '';
}

async function saFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SA_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${saToken()}`,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type LeadStatus = 'new' | 'contacted' | 'demo_scheduled' | 'proposal_sent' | 'won' | 'lost';
export type LeadPriority = 'low' | 'medium' | 'high';
export type LeadSource = 'website_contact' | 'website_demo' | 'referral' | 'social' | 'manual' | 'other';

export interface LeadTimeline {
  event: string;
  note?: string;
  actor?: string;
  createdAt: string;
}

export interface Lead {
  _id: string;
  ownerName: string;
  companyName: string;
  phone: string;
  email: string;
  city?: string;
  state?: string;
  country: string;
  businessType?: string;
  restaurantType?: string;
  source: LeadSource;
  status: LeadStatus;
  assignedTo?: string;
  priority: LeadPriority;
  notes?: string;
  timeline: LeadTimeline[];
  inquiryId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadStats {
  todayCount: number;
  weekCount: number;
  monthCount: number;
  pendingCount: number;
  wonCount: number;
  lostCount: number;
  totalCount: number;
  conversionRate: number;
}

export interface LeadsResponse {
  leads: Lead[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface LeadsFilter {
  page?: number;
  limit?: number;
  status?: string;
  priority?: string;
  source?: string;
  search?: string;
  assignedTo?: string;
}

export function getLeadStats(): Promise<LeadStats> {
  return saFetch<LeadStats>('/leads/stats');
}

export function getLeads(filter: LeadsFilter = {}): Promise<LeadsResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return saFetch<LeadsResponse>(`/leads${qs ? `?${qs}` : ''}`);
}

export function getLead(id: string): Promise<{ lead: Lead }> {
  return saFetch<{ lead: Lead }>(`/leads/${id}`);
}

export function updateLead(id: string, data: Partial<Pick<Lead, 'status' | 'priority' | 'assignedTo' | 'notes' | 'city' | 'state' | 'restaurantType' | 'businessType'>>): Promise<{ lead: Lead }> {
  return saFetch<{ lead: Lead }>(`/leads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function addTimelineEntry(id: string, event: string, note?: string): Promise<{ lead: Lead }> {
  return saFetch<{ lead: Lead }>(`/leads/${id}/timeline`, {
    method: 'POST',
    body: JSON.stringify({ event, note }),
  });
}

export function deleteLead(id: string): Promise<{ message: string }> {
  return saFetch<{ message: string }>(`/leads/${id}`, { method: 'DELETE' });
}

export function registerSAPushToken(pushToken: string, platform: 'ios' | 'android' = 'android'): Promise<{ message: string }> {
  return saFetch<{ message: string }>('/push-token', {
    method: 'POST',
    body: JSON.stringify({ pushToken, platform }),
  });
}

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new:            'New',
  contacted:      'Contacted',
  demo_scheduled: 'Demo Scheduled',
  proposal_sent:  'Proposal Sent',
  won:            'Won',
  lost:           'Lost',
};

export const STATUS_ORDER: LeadStatus[] = ['new', 'contacted', 'demo_scheduled', 'proposal_sent', 'won', 'lost'];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  website_contact: 'Website Contact',
  website_demo:    'Website Demo',
  referral:        'Referral',
  social:          'Social',
  manual:          'Manual',
  other:           'Other',
};
