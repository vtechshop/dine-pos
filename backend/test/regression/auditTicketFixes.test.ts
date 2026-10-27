/**
 * Audit (Phase 2) — support tickets are tenant-scoped.
 *
 * TKT-01  GET /tickets/hotel/:phone ignores :phone; returns only the JWT hotel's tickets.
 * TKT-02  POST /tickets stores hotelId + name/phone from the DB, not from the body.
 * TKT-03  POST /tickets/:id/reply only updates a ticket owned by the JWT hotel.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/models/Ticket', () => ({
  __esModule: true,
  default: { find: jest.fn(), create: jest.fn(), findOneAndUpdate: jest.fn(), findByIdAndUpdate: jest.fn() },
}));
jest.mock('../../src/models/Hotel', () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

import TicketModel from '../../src/models/Ticket';
import HotelModel from '../../src/models/Hotel';

const HOTEL_A = '64b7f0c2a1b2c3d4e5f60718';
const TICKET  = '64b7f0c2a1b2c3d4e5f60d01';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = jest.fn((c: number) => { res.statusCode = c; return res; });
  res.json   = jest.fn((b: unknown) => { res.body = b; return res; });
  return res;
}
function routeHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<unknown>;
}
function hotelLean(doc: unknown) {
  return { select: () => ({ lean: jest.fn().mockResolvedValue(doc) }) };
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ticketRouter = require('../../src/routes/ticketRoutes').default;

beforeEach(() => {
  jest.clearAllMocks();
  (HotelModel.findById as jest.Mock).mockReturnValue(hotelLean({ hotelName: 'Malu Hotel', phone: '9944556677' }));
});

describe('TKT-01 — list returns only the JWT hotel’s tickets', () => {
  it('ignores the :phone param (another hotel’s phone)', async () => {
    (TicketModel.find as jest.Mock).mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    const res = mockRes();
    await routeHandler(ticketRouter, 'get', '/hotel/:phone')(
      { hotelId: HOTEL_A, params: { phone: '9000000001' } }, res,
    );
    const filter = (TicketModel.find as jest.Mock).mock.calls[0][0];
    const json = JSON.stringify(filter);
    expect(json).not.toContain('9000000001');
    expect(json).toContain(HOTEL_A);
    expect(json).toContain('9944556677'); // legacy tickets matched by the hotel's own stored phone
  });
});

describe('TKT-02 — create takes identity from the DB', () => {
  it('stores hotelId and the DB name/phone, not the body values', async () => {
    (TicketModel.create as jest.Mock).mockImplementation(async (d: unknown) => d);
    const res = mockRes();
    await routeHandler(ticketRouter, 'post', '/')(
      { hotelId: HOTEL_A, body: { hotelName: 'Other Hotel', hotelPhone: '9000000001', subject: 'Help', description: 'Printer' } },
      res,
    );
    expect(res.statusCode).toBe(201);
    const doc = (TicketModel.create as jest.Mock).mock.calls[0][0];
    expect(String(doc.hotelId)).toBe(HOTEL_A);
    expect(doc.hotelName).toBe('Malu Hotel');
    expect(doc.hotelPhone).toBe('9944556677');
  });
});

describe('TKT-03 — reply is scoped to the owning hotel', () => {
  it('uses an ownership filter, never findByIdAndUpdate', async () => {
    (TicketModel.findOneAndUpdate as jest.Mock).mockResolvedValue(null); // not this hotel's ticket
    const res = mockRes();
    await routeHandler(ticketRouter, 'post', '/:id/reply')(
      { hotelId: HOTEL_A, params: { id: TICKET }, body: { message: 'hi' } }, res,
    );
    expect(res.statusCode).toBe(404);
    expect(TicketModel.findByIdAndUpdate).not.toHaveBeenCalled();
    const filter = (TicketModel.findOneAndUpdate as jest.Mock).mock.calls[0][0];
    expect(filter._id).toBe(TICKET);
    expect(JSON.stringify(filter)).toContain(HOTEL_A);
  });
});
