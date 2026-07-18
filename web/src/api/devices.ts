import { apiFetch } from './client';

export interface SessionDevice {
  _id: string;
  deviceId: string;
  socketId: string | null;
  connectedAt: string | null;
  lastSeen: string | null;
  lastHeartbeat?: string | null;
  online?: boolean;
}

export const fetchSessionDevices = (): Promise<SessionDevice[]> =>
  apiFetch('/devices');

export const logoutDevice = (id: string): Promise<{ ok?: boolean; message?: string }> =>
  apiFetch(`/devices/${id}/logout`, { method: 'PATCH' });

export const logoutAllDevices = (): Promise<{ ok?: boolean; message?: string }> =>
  apiFetch('/devices/logout-all', { method: 'DELETE' });
