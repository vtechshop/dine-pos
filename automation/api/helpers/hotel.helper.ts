import { api } from '../../utils/api-client';
import { superAdminHeaders } from '../../utils/env';

export async function rejectHotel(hotelId: string, reason = 'Test rejection'): Promise<void> {
  const res = await api
    .put(`/api/superadmin/hotels/${hotelId}/reject`)
    .set(superAdminHeaders)
    .send({ reason });
  if (res.status !== 200) {
    throw new Error(`rejectHotel failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export async function suspendHotel(hotelId: string): Promise<void> {
  const res = await api
    .put(`/api/superadmin/hotels/${hotelId}/suspend`)
    .set(superAdminHeaders);
  if (res.status !== 200) {
    throw new Error(`suspendHotel failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export async function activateHotel(hotelId: string): Promise<void> {
  const res = await api
    .put(`/api/superadmin/hotels/${hotelId}/activate`)
    .set(superAdminHeaders);
  if (res.status !== 200) {
    throw new Error(`activateHotel failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export async function setPlan(
  hotelId: string,
  plan: string,
  durationDays = 30
): Promise<void> {
  const res = await api
    .put(`/api/superadmin/hotels/${hotelId}/plan`)
    .set(superAdminHeaders)
    .send({ plan, durationDays });
  if (res.status !== 200) {
    throw new Error(`setPlan failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export async function extendTrial(hotelId: string, days = 7): Promise<void> {
  const res = await api
    .put(`/api/superadmin/hotels/${hotelId}/extend-trial`)
    .set(superAdminHeaders)
    .send({ days });
  if (res.status !== 200) {
    throw new Error(`extendTrial failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export async function getSuperAdminHotels(query: Record<string, string> = {}): Promise<any[]> {
  const res = await api.get('/api/superadmin/hotels').set(superAdminHeaders).query(query);
  if (res.status !== 200) {
    throw new Error(`getSuperAdminHotels failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.hotels || res.body.data || res.body;
}

export async function getHotelStatus(phone: string): Promise<any> {
  const res = await api.get(`/api/hotels/status/${phone}`);
  return { status: res.status, body: res.body };
}
