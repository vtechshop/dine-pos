import { apiFetch } from './client';

export interface AuditLog {
  _id: string;
  action: string;
  actorRole: string;
  actorId?: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  pages: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const fetchAuditLogs = (params?: {
  page?: number;
  limit?: number;
  action?: string;
  actorRole?: string;
  targetType?: string;
  from?: string;
  to?: string;
}): Promise<AuditLogsResponse> =>
  apiFetch<AuditLogsResponse>(`/audit${qs(params ?? {})}`);
