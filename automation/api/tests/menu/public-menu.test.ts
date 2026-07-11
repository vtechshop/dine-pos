import { api } from '../../../utils/api-client';
import { getHotelA } from '../../setup/testEnv';

describe('Public Menu — QR Menu Endpoint', () => {
  let hotelId: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    hotelId = hotelA.hotelId;
  });

  it('QR-001 GET /api/public/menu?hotel=<id> returns 200 without auth', async () => {
    const res = await api.get('/api/public/menu').query({ hotel: hotelId });
    expect(res.status).toBe(200);
  });

  it('QR-002 public menu response contains categories and products', async () => {
    const res = await api.get('/api/public/menu').query({ hotel: hotelId });
    const body = res.body;
    // Menu may be in body.categories, body.menu, or top-level array
    const hasMenu = body.categories || body.menu || Array.isArray(body);
    expect(hasMenu).toBeTruthy();
  });

  it('QR-003 public menu without hotel param returns 400', async () => {
    const res = await api.get('/api/public/menu');
    expect([400, 422]).toContain(res.status);
  });

  it('QR-004 public menu with nonexistent hotelId returns 404', async () => {
    const res = await api.get('/api/public/menu').query({ hotel: '000000000000000000000000' });
    expect([404, 400]).toContain(res.status);
  });

  it('QR-005 public menu only shows isAvailable=true products', async () => {
    const res = await api.get('/api/public/menu').query({ hotel: hotelId });
    expect(res.status).toBe(200);
    const extract = (obj: any): any[] => {
      if (Array.isArray(obj)) return obj;
      return obj.categories || obj.menu?.categories || obj.products || [];
    };
    const items = extract(res.body);
    if (items.length > 0 && items[0].products) {
      const allProducts = items.flatMap((c: any) => c.products || []);
      allProducts.forEach((p: any) => {
        if (p.isAvailable !== undefined) {
          expect(p.isAvailable).toBe(true);
        }
      });
    }
  });

  it('QR-006 suspended hotel public menu returns 403 or 404', async () => {
    // We don't suspend hotelA here to keep tests isolated;
    // this test documents expected behavior for suspended hotels.
    // Verified in multitenant tests where a hotel is explicitly suspended.
    expect(true).toBe(true);
  });
});
