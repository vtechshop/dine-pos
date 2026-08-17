/**
 * test/ai/chatTools.test.ts
 *
 * Tests tool-level safety invariants in src/services/chatTools.ts:
 *   1. Future dates are rejected / silently clamped to a safe default.
 *   2. Tools handle empty result sets without throwing.
 *   3. toolGetVendorBalances uses runningBalance, not a raw "balance" field.
 *
 * The executeTool dispatcher is tested in the TODO stubs below — it requires
 * importing the dispatcher function once it is exported from aiChat.ts or a
 * dedicated executor module.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

// Empty-result mocks — every DB call returns []
jest.mock('../../src/models/Order', () => ({
  aggregate: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/models/HourlyMetrics', () => ({
  aggregate: jest.fn().mockResolvedValue([]),
}));

// DailySnapshot.find() is called as .find(...).sort(...).lean() in some tools
// and as .find(...).lean() in others, so the mock must support both chains.
const makeFindChain = () => {
  const chain: any = {};
  chain.lean  = jest.fn().mockResolvedValue([]);
  chain.sort  = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  return chain;
};
jest.mock('../../src/models/DailySnapshot', () => ({
  find: jest.fn().mockImplementation(() => makeFindChain()),
}));

jest.mock('../../src/models/Ingredient', () => ({
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock('../../src/models/Expense', () => ({
  aggregate: jest.fn().mockResolvedValue([]),
}));

// VendorLedgerEntry mock — records the pipeline so we can inspect $group stage
let capturedVendorPipeline: any[] = [];
jest.mock('../../src/models/VendorLedgerEntry', () => ({
  aggregate: jest.fn().mockImplementation((pipeline: any[]) => {
    capturedVendorPipeline = pipeline;
    return Promise.resolve([]);
  }),
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import {
  toolGetRevenue,
  toolGetTopProducts,
  toolGetLowStockItems,
  toolGetVendorBalances,
  toolGetPaymentBreakdown,
  executeTool,
} from '../../src/services/chatTools';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HOTEL_ID   = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PAST_DATE  = '2024-08-01';

// A date string that is definitely in the future (relative to any CI run date)
const FUTURE_DATE = '2099-12-31';

beforeEach(() => {
  capturedVendorPipeline = [];
});

// ─── Future date rejection / clamping ────────────────────────────────────────

describe('future date handling', () => {
  it('toolGetRevenue does not crash when endDate is in the future', async () => {
    // The implementation clamps future dates to a safe default (yesterday/today).
    // The tool must resolve (not throw) and return a valid object.
    await expect(
      toolGetRevenue(HOTEL_ID, { startDate: FUTURE_DATE, endDate: FUTURE_DATE }),
    ).resolves.toHaveProperty('totalRevenue');
  });

  it('toolGetRevenue result period does not include the future date string verbatim', async () => {
    const result = await toolGetRevenue(HOTEL_ID, { startDate: FUTURE_DATE, endDate: FUTURE_DATE });
    // The period reported should use the clamped (past) date, not FUTURE_DATE
    expect(String(result.period)).not.toContain(FUTURE_DATE);
  });

  it('toolGetTopProducts does not crash when startDate is in the future', async () => {
    await expect(
      toolGetTopProducts(HOTEL_ID, { startDate: FUTURE_DATE, endDate: FUTURE_DATE }),
    ).resolves.toHaveProperty('products');
  });

  it('toolGetTopProducts result period does not include the future date', async () => {
    const result = await toolGetTopProducts(HOTEL_ID, { startDate: FUTURE_DATE });
    expect(String(result.period)).not.toContain(FUTURE_DATE);
  });

  it('toolGetPaymentBreakdown does not crash with a future date', async () => {
    await expect(
      toolGetPaymentBreakdown(HOTEL_ID, { startDate: FUTURE_DATE, endDate: FUTURE_DATE }),
    ).resolves.toHaveProperty('totalRevenue');
  });
});

// ─── Empty result resilience ──────────────────────────────────────────────────

describe('empty result handling', () => {
  it('toolGetRevenue returns totalRevenue=0 when snapshots are empty', async () => {
    const result = await toolGetRevenue(HOTEL_ID, { startDate: PAST_DATE, endDate: PAST_DATE });
    expect(result.totalRevenue).toBe(0);
    expect(result.totalOrders).toBe(0);
  });

  it('toolGetTopProducts returns an empty products array when no orders exist', async () => {
    const result = await toolGetTopProducts(HOTEL_ID, { startDate: PAST_DATE });
    expect(Array.isArray(result.products)).toBe(true);
    expect((result.products as any[]).length).toBe(0);
  });

  it('toolGetLowStockItems returns count=0 when ingredient store is empty', async () => {
    const result = await toolGetLowStockItems(HOTEL_ID);
    expect(result.count).toBe(0);
    expect(Array.isArray(result.items)).toBe(true);
    expect((result.items as any[]).length).toBe(0);
  });

  it('toolGetVendorBalances returns totalOutstanding=0 when ledger is empty', async () => {
    const result = await toolGetVendorBalances(HOTEL_ID);
    expect(result.totalOutstanding).toBe(0);
    expect(Array.isArray(result.vendors)).toBe(true);
  });

  it('toolGetPaymentBreakdown returns totalRevenue=0 when snapshots are empty', async () => {
    const result = await toolGetPaymentBreakdown(HOTEL_ID, { startDate: PAST_DATE });
    expect(result.totalRevenue).toBe(0);
    expect(result).toHaveProperty('breakdown');
  });

  it('none of the tools throw for empty DB results', async () => {
    await expect(toolGetRevenue(HOTEL_ID, {})).resolves.toBeDefined();
    await expect(toolGetTopProducts(HOTEL_ID, {})).resolves.toBeDefined();
    await expect(toolGetLowStockItems(HOTEL_ID)).resolves.toBeDefined();
    await expect(toolGetVendorBalances(HOTEL_ID)).resolves.toBeDefined();
    await expect(toolGetPaymentBreakdown(HOTEL_ID, {})).resolves.toBeDefined();
  });
});

// ─── toolGetVendorBalances uses runningBalance ────────────────────────────────

describe('toolGetVendorBalances pipeline correctness', () => {
  it('aggregate pipeline contains a $group stage that selects $first runningBalance', async () => {
    await toolGetVendorBalances(HOTEL_ID);

    const groupStage = capturedVendorPipeline.find((s: any) => s.$group);
    expect(groupStage).toBeDefined();
    // Must select runningBalance via $first, NOT a raw "balance" field
    expect(groupStage.$group).toHaveProperty('runningBalance');
    expect(groupStage.$group.runningBalance).toEqual({ $first: '$runningBalance' });
  });

  it('pipeline $match stage filters by hotelId before grouping', async () => {
    await toolGetVendorBalances(HOTEL_ID);
    const matchStage = capturedVendorPipeline.find((s: any) => s.$match?.hotelId);
    expect(matchStage).toBeDefined();
  });

  it('pipeline has a $sort on createdAt DESC before grouping (latest-entry semantics)', async () => {
    await toolGetVendorBalances(HOTEL_ID);
    // Find the first $sort stage (before $group)
    const groupIdx = capturedVendorPipeline.findIndex((s: any) => s.$group);
    const sortBeforeGroup = capturedVendorPipeline
      .slice(0, groupIdx)
      .find((s: any) => s.$sort);
    expect(sortBeforeGroup).toBeDefined();
    expect(sortBeforeGroup.$sort.createdAt).toBe(-1);
  });
});

// ─── executeTool dispatcher stubs ─────────────────────────────────────────────

describe('executeTool dispatcher', () => {
  it('rejects unknown tool names with a safe error payload (no throw)', async () => {
    const result = await executeTool('dropDatabase', HOTEL_ID, {});
    expect(result).toHaveProperty('error');
    expect(String(result.error)).toMatch(/unknown tool/i);
  });

  it('does not execute arbitrary method names injected via tool name', async () => {
    // Prototype-chain names must return an error payload, never throw
    const r1 = await executeTool('__proto__', HOTEL_ID, {});
    expect(r1).toHaveProperty('error');

    const r2 = await executeTool('constructor', HOTEL_ID, {});
    expect(r2).toHaveProperty('error');

    const r3 = await executeTool('toString', HOTEL_ID, {});
    expect(r3).toHaveProperty('error');
  });

  it('maps known tool names to their handler functions', async () => {
    // 'getRevenue' is a registered tool; all its DB models are mocked above
    const result = await executeTool('getRevenue', HOTEL_ID, { startDate: PAST_DATE, endDate: PAST_DATE });
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('totalRevenue');
  });
});
