/**
 * test/ai/multiTenancy.test.ts
 *
 * Verifies that hotelId isolation is enforced across all AI tool functions and
 * the alert engine. No tool result should be reachable by a different hotel.
 *
 * Strategy:
 *   - Mock mongoose model methods (aggregate, find) to record the $match stage
 *     that is passed.  Assert that every call includes the correct hotelId.
 *   - Call each tool with hotelId A, then assert mongoose was NOT called with
 *     hotelId B in the $match filter.
 *
 * TODO items mark where integration or contract tests should be added once a
 * dedicated test database is available.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock mongoose ObjectId so we can compare string representations
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    Types: {
      ObjectId: jest.fn().mockImplementation((id: string) => ({
        toString: () => id,
        equals: (other: any) => String(other) === id,
        toHexString: () => id,
      })),
    },
  };
});

// Capture the $match hotelId from aggregate pipelines
let lastMatchedHotelId: string | null = null;

const makeMockModel = () => ({
  aggregate: jest.fn().mockImplementation((pipeline: any[]) => {
    const matchStage = pipeline.find((s: any) => s.$match?.hotelId);
    if (matchStage) {
      lastMatchedHotelId = String(matchStage.$match.hotelId);
    }
    return Promise.resolve([]);
  }),
  find: jest.fn().mockImplementation((filter: any) => {
    if (filter?.hotelId) {
      lastMatchedHotelId = String(filter.hotelId);
    }
    // Build a fluent chain that supports .sort().lean(), .lean(), .sort().limit().lean()
    const chain: any = {};
    chain.lean  = jest.fn().mockResolvedValue([]);
    chain.sort  = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockReturnValue(chain);
    return chain;
  }),
});

jest.mock('../../src/models/Order',               () => makeMockModel());
jest.mock('../../src/models/HourlyMetrics',        () => makeMockModel());
jest.mock('../../src/models/DailySnapshot',        () => makeMockModel());
jest.mock('../../src/models/Ingredient',           () => makeMockModel());
jest.mock('../../src/models/Expense',              () => makeMockModel());
jest.mock('../../src/models/VendorLedgerEntry',    () => makeMockModel());
jest.mock('../../src/models/Alert',                () => makeMockModel());

// ─── Subject under test ───────────────────────────────────────────────────────

import {
  toolGetRevenue,
  toolGetTopProducts,
  toolGetLowStockItems,
  toolGetVendorBalances,
  toolGetPaymentBreakdown,
} from '../../src/services/chatTools';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HOTEL_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const HOTEL_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const PAST_DATE = '2024-08-01';

beforeEach(() => {
  lastMatchedHotelId = null;
});

// ─── toolGetRevenue ───────────────────────────────────────────────────────────

describe('toolGetRevenue — hotelId isolation', () => {
  it('passes HOTEL_A in $match when called with HOTEL_A', async () => {
    await toolGetRevenue(HOTEL_A, { startDate: PAST_DATE, endDate: PAST_DATE });
    expect(lastMatchedHotelId).toBe(HOTEL_A);
  });

  it('never uses HOTEL_B when called with HOTEL_A', async () => {
    await toolGetRevenue(HOTEL_A, { startDate: PAST_DATE, endDate: PAST_DATE });
    expect(lastMatchedHotelId).not.toBe(HOTEL_B);
  });
});

// ─── toolGetTopProducts ───────────────────────────────────────────────────────

describe('toolGetTopProducts — hotelId isolation', () => {
  it('passes HOTEL_A in aggregate $match', async () => {
    await toolGetTopProducts(HOTEL_A, { startDate: PAST_DATE, endDate: PAST_DATE });
    expect(lastMatchedHotelId).toBe(HOTEL_A);
  });
});

// ─── toolGetLowStockItems ─────────────────────────────────────────────────────

describe('toolGetLowStockItems — hotelId isolation', () => {
  it('filters Ingredient.find by HOTEL_A', async () => {
    await toolGetLowStockItems(HOTEL_A);
    expect(lastMatchedHotelId).toBe(HOTEL_A);
  });
});

// ─── toolGetVendorBalances ────────────────────────────────────────────────────

describe('toolGetVendorBalances — hotelId isolation', () => {
  it('filters VendorLedgerEntry.aggregate by HOTEL_A', async () => {
    await toolGetVendorBalances(HOTEL_A);
    expect(lastMatchedHotelId).toBe(HOTEL_A);
  });
});

// ─── toolGetPaymentBreakdown ──────────────────────────────────────────────────

describe('toolGetPaymentBreakdown — hotelId isolation', () => {
  it('filters DailySnapshot.find by HOTEL_A', async () => {
    await toolGetPaymentBreakdown(HOTEL_A, { startDate: PAST_DATE, endDate: PAST_DATE });
    expect(lastMatchedHotelId).toBe(HOTEL_A);
  });
});

// ─── Cross-hotel access (contract test stubs) ─────────────────────────────────

describe('cross-hotel data access prevention', () => {
  /**
   * TODO: Integration test — requires a real MongoDB test database.
   *
   * Steps:
   *   1. Seed hotel A and hotel B each with a DailySnapshot for the same date.
   *   2. Call toolGetRevenue(HOTEL_A, { startDate, endDate }).
   *   3. Assert the returned dailyBreakdown contains only hotel A documents.
   *   4. Assert no hotel B revenue appears in the result.
   */
  it.todo('toolGetRevenue result contains only hotel A documents when called with hotel A');

  /**
   * TODO: Integration test
   *
   * Steps:
   *   1. Seed hotel A and hotel B ingredients with known stock levels.
   *   2. Call toolGetLowStockItems(HOTEL_A).
   *   3. Assert returned items have hotelId === HOTEL_A only.
   */
  it.todo('toolGetLowStockItems result contains only hotel A ingredients');

  /**
   * TODO: Alert engine integration test
   *
   * Steps:
   *   1. Import runAlertEngine (or equivalent exported function).
   *   2. Mock req.hotelId = HOTEL_A (simulating JWT extraction).
   *   3. Assert that Alert.insertMany is called with hotelId === HOTEL_A.
   *   4. Assert the hotelId is never sourced from req.body.
   */
  it.todo('alertEngine uses hotelId from JWT context, not from request body');
});
