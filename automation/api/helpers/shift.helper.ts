import { api } from '../../utils/api-client';
import { authHeaders } from '../../utils/env';
import { getHotelA, getHotelB } from '../setup/testEnv';

/**
 * Counter payments (cash, UPI, card) need an open shift; the server answers
 * 409 SHIFT_REQUIRED otherwise. Test files that take counter money call this
 * so they do not depend on which file ran before them (the shift tests close
 * shifts). Opens a ₹0 shift only if none is open.
 */
export async function ensureOpenShift(adminToken: string): Promise<void> {
  const active = await api.get('/api/shifts/active').set(authHeaders(adminToken));
  if (active.status === 200 && active.body.shift?._id) return;
  const res = await api
    .post('/api/shifts/open')
    .set(authHeaders(adminToken))
    .send({ openingCash: 0, openingNote: 'API test default shift' });
  if (res.status !== 201) {
    throw new Error(`ensureOpenShift failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/** Make sure both shared test hotels (A and B) have an open shift. Use as `beforeAll(ensureOpenShifts)`. */
export async function ensureOpenShifts(): Promise<void> {
  await ensureOpenShift(getHotelA().adminToken);
  await ensureOpenShift(getHotelB().adminToken);
}
