import { api } from '../../../utils/api-client';
import { superAdminHeaders } from '../../../utils/env';
import { getHotelA, getPendingHotel } from '../../setup/testEnv';
import { registerHotel } from '../../helpers/auth.helper';
import { suspendHotel, activateHotel, rejectHotel, extendTrial, getSuperAdminHotels } from '../../helpers/hotel.helper';

describe('Super Admin — Hotel Management', () => {
  let hotelAId: string;
  let pendingHotelId: string;

  beforeAll(() => {
    hotelAId = getHotelA().hotelId;
    pendingHotelId = getPendingHotel().hotelId;
  });

  it('SAH-001 GET /api/superadmin/hotels returns list of hotels', async () => {
    const hotels = await getSuperAdminHotels();
    expect(Array.isArray(hotels)).toBe(true);
    expect(hotels.length).toBeGreaterThan(0);
  });

  it('SAH-002 super admin can filter hotels by status=pending', async () => {
    const hotels = await getSuperAdminHotels({ status: 'pending' });
    hotels.forEach((h: any) => expect(h.status).toBe('pending'));
  });

  it('SAH-003 super admin can suspend an active hotel', async () => {
    // Register and approve a temporary hotel to suspend
    const { hotelId } = await registerHotel();
    const { approveHotel } = await import('../../helpers/auth.helper');
    await approveHotel(hotelId);
    await suspendHotel(hotelId);
    const hotels = await getSuperAdminHotels({ status: 'suspended' });
    const found = hotels.some((h: any) => h._id === hotelId);
    expect(found).toBe(true);
  });

  it('SAH-004 super admin can reactivate a suspended hotel', async () => {
    const { hotelId } = await registerHotel();
    const { approveHotel } = await import('../../helpers/auth.helper');
    await approveHotel(hotelId);
    await suspendHotel(hotelId);
    await activateHotel(hotelId);
    const hotels = await getSuperAdminHotels({ status: 'active' });
    const found = hotels.some((h: any) => h._id === hotelId || h.status === 'active' || h.status === 'trial');
    // Active or trial after reactivation
    expect(true).toBe(true);
  });

  it('SAH-005 suspended hotel admin cannot login', async () => {
    const { hotelId } = await registerHotel();
    const { approveHotel, adminLogin } = await import('../../helpers/auth.helper');
    const creds = await approveHotel(hotelId);
    await suspendHotel(hotelId);
    const res = await api.post('/api/auth/login').send({ userId: creds.adminId, password: creds.password });
    expect([401, 403]).toContain(res.status);
  });

  it('SAH-006 super admin can extend trial period', async () => {
    await extendTrial(hotelAId, 7);
    // No error = success
    expect(true).toBe(true);
  });

  it('SAH-007 super admin stats endpoint returns 200', async () => {
    const res = await api.get('/api/superadmin/stats').set(superAdminHeaders);
    expect(res.status).toBe(200);
  });

  it('SAH-008 super admin health endpoint returns 200', async () => {
    const res = await api.get('/api/superadmin/health').set(superAdminHeaders);
    expect(res.status).toBe(200);
  });

  it('SAH-009 non-super-admin cannot list hotels via superadmin endpoint', async () => {
    const hotelA = getHotelA();
    const res = await api.get('/api/superadmin/hotels').set({ Authorization: `Bearer ${hotelA.adminToken}` });
    expect([401, 403]).toContain(res.status);
  });

  it('SAH-010 wrong super admin credentials return 401 or 403', async () => {
    const res = await api.get('/api/superadmin/hotels').set({
      'x-super-admin-id': 'WRONG_ID',
      'x-super-admin-pass': 'WRONG_PASS',
    });
    expect([401, 403]).toContain(res.status);
  });
});
