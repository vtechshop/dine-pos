const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';

export interface PublicRemoteConfig {
  maintenanceMode:    boolean;
  maintenanceMessage: string;
}

export async function getPublicRemoteConfig(): Promise<PublicRemoteConfig> {
  const res = await fetch(`${API_BASE}/remote-config`);
  if (!res.ok) throw new Error('Failed to fetch remote config');
  return res.json() as Promise<PublicRemoteConfig>;
}
