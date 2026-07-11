import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { tablePayload } from '../../../utils/test-data';

describe('Menu — Tables', () => {
  let adminToken: string;
  let waiterToken: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    waiterToken = hotelA.waiterToken;
  });

  it('TBL-001 admin can create a table', async () => {
    const res = await api.post('/api/tables').set(authHeaders(adminToken)).send(tablePayload());
    expect(res.status).toBe(201);
    const tbl = res.body.table || res.body;
    expect(tbl._id).toBeDefined();
  });

  it('TBL-002 waiter cannot create table', async () => {
    const res = await api.post('/api/tables').set(authHeaders(waiterToken)).send(tablePayload());
    expect([401, 403]).toContain(res.status);
  });

  it('TBL-003 missing name returns 400', async () => {
    const res = await api.post('/api/tables').set(authHeaders(adminToken)).send({ capacity: 4 });
    expect([400, 422]).toContain(res.status);
  });

  it('TBL-004 admin can list tables', async () => {
    const res = await api.get('/api/tables').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const tables = res.body.tables || res.body.data || res.body;
    expect(Array.isArray(tables)).toBe(true);
  });

  it('TBL-005 waiter can list tables', async () => {
    const res = await api.get('/api/tables').set(authHeaders(waiterToken));
    expect(res.status).toBe(200);
  });

  it('TBL-006 unauthenticated cannot list tables', async () => {
    const res = await api.get('/api/tables');
    expect(res.status).toBe(401);
  });

  it('TBL-007 tables from hotel A not visible to hotel B', async () => {
    const { getHotelB } = await import('../../setup/testEnv');
    const hotelA = getHotelA();
    const hotelB = getHotelB();

    const createRes = await api
      .post('/api/tables')
      .set(authHeaders(hotelA.adminToken))
      .send(tablePayload({ name: 'Isolation Table A99' }));
    const tableId = createRes.body.table?._id || createRes.body._id;

    const listResB = await api.get('/api/tables').set(authHeaders(hotelB.adminToken));
    const tablesB = listResB.body.tables || listResB.body.data || listResB.body;
    const found = tablesB.some((t: any) => t._id === tableId);
    expect(found).toBe(false);
  });
});
