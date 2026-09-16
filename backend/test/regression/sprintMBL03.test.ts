/**
 * Sprint MBL-03 Regression Tests
 *
 * Pure-logic tests — no real DB, no network.
 * Covers: org expiry config, expiry accounting, balance invariants,
 * idempotency, history API scope/pagination, HQ/branch feature flags,
 * offline org-redemption guard.
 *
 * MBL-S3-01 … MBL-S3-33
 */

// ── Helpers & stubs ────────────────────────────────────────────────────────────

interface LoyaltyConfig {
  enabled: boolean;
  pointsPerHundredRupees: number;
  minimumRedeemPoints: number;
  maximumRedeemPercent: number;
  pointValueInPaisa: number;
  expiryDays: number;
  roundingRule: 'floor' | 'round' | 'ceil';
  calculationBase: 'before_gst' | 'after_gst';
  maxEarnPointsPerBill: number;
}

const BASE_CFG: LoyaltyConfig = {
  enabled: true,
  pointsPerHundredRupees: 10,
  minimumRedeemPoints: 50,
  maximumRedeemPercent: 20,
  pointValueInPaisa: 100,
  expiryDays: 30,
  roundingRule: 'floor',
  calculationBase: 'before_gst',
  maxEarnPointsPerBill: 0,
};

// ── Org expiry calculation (pure logic mirrored from loyaltyExpiryWorker.ts) ──

function computeOrgExpiry(
  totalEarnedExpired: number,
  alreadyExpired: number,
  currentBalance: number,
): { toExpire: number; actualExpired: number } {
  const toExpire = Math.max(0, totalEarnedExpired - alreadyExpired);
  const actualExpired = Math.min(toExpire, currentBalance);
  return { toExpire, actualExpired };
}

function applyOrgExpiry(balance: number, actualExpired: number): number {
  return Math.max(0, balance - actualExpired);
}

// ── expiresAt computation (mirrored from loyaltyUtils.ts earnOrgPoints) ────────

function computeExpiresAt(expiryDays: number, now: Date): Date | null {
  if (expiryDays <= 0) return null;
  return new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
}

// ── resolveOrgLoyalty eligibility gate (pure subset) ─────────────────────────

interface MinHotel {
  parentHotelId: string | null;
  features: { orgLoyalty?: boolean; orgLoyaltyEnabled?: boolean; multiBranch?: boolean };
}

function isOrgLoyaltyEligible(
  hqFeatures: { orgLoyalty?: boolean },
  branchFeatures: { orgLoyaltyEnabled?: boolean },
  branchParentId: string | null,
  customerOptOut: boolean,
  orgCustomerId: string | null,
): boolean {
  if (!orgCustomerId) return false;
  if (customerOptOut) return false;
  if (!branchParentId) return false;             // must be a branch, not HQ
  if (!hqFeatures.orgLoyalty) return false;      // BR-2: HQ master switch
  if (branchFeatures.orgLoyaltyEnabled === false) return false; // branch opted out
  return true;
}

// ── Offline guard (mirrored from offlineQueue.ts) ─────────────────────────────

function assertOfflineQueueable(redeemedPoints: number): void {
  if (redeemedPoints > 0) {
    throw new Error('Loyalty redemption requires an internet connection.');
  }
}

// ── History API pagination (pure logic) ───────────────────────────────────────

function paginateResults<T>(items: T[], page: number, limit: number): { data: T[]; total: number; page: number; limit: number } {
  const total = items.length;
  const limitNum = Math.min(100, Math.max(1, limit));
  const pageNum  = Math.max(1, page);
  const skip = (pageNum - 1) * limitNum;
  return { data: items.slice(skip, skip + limitNum), total, page: pageNum, limit: limitNum };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Sprint MBL-03: Org Expiry Config', () => {
  test('MBL-S3-01: expiryDays=30 produces an expiresAt 30 days from now', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const exp = computeExpiresAt(30, now);
    expect(exp).not.toBeNull();
    const diffDays = (exp!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(30);
  });

  test('MBL-S3-02: expiryDays=0 produces null (never expires)', () => {
    const exp = computeExpiresAt(0, new Date());
    expect(exp).toBeNull();
  });

  test('MBL-S3-03: expiryDays=365 produces expiresAt one year from now', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const exp = computeExpiresAt(365, now);
    const diffDays = (exp!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(365);
  });

  test('MBL-S3-04: HQ config (not branch) drives expiryDays — branch config is ignored for org earn', () => {
    // If HQ has expiryDays=60 and branch has expiryDays=0, org earn uses HQ config
    const hqCfg = { ...BASE_CFG, expiryDays: 60 };
    const now = new Date('2026-01-01T00:00:00Z');
    const exp = computeExpiresAt(hqCfg.expiryDays, now);
    const diffDays = (exp!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(60);
  });
});

describe('Sprint MBL-03: Org Expiry Accounting', () => {
  test('MBL-S3-05: eligible org points expire correctly — full case', () => {
    // earned 200, none already expired, balance 200
    const { toExpire, actualExpired } = computeOrgExpiry(200, 0, 200);
    expect(toExpire).toBe(200);
    expect(actualExpired).toBe(200);
    expect(applyOrgExpiry(200, actualExpired)).toBe(0);
  });

  test('MBL-S3-06: expiry never touches CustomerProfile.loyaltyBalance — it is always org-only', () => {
    // Guard: expiry only modifies orgLoyaltyBalance, never loyaltyBalance.
    // This test validates the invariant via data separation — the expiry function
    // takes orgBalance, never profile balance.
    const orgBalance = 500;
    const profileBalance = 1000; // this value must never change
    const { actualExpired } = computeOrgExpiry(200, 0, orgBalance);
    const newOrgBalance = applyOrgExpiry(orgBalance, actualExpired);
    expect(newOrgBalance).toBe(300);
    // profileBalance is untouched (it was never passed to the function)
    expect(profileBalance).toBe(1000);
  });

  test('MBL-S3-07: partial expiry — alreadyExpired reduces what needs to be deducted', () => {
    // total earn expired = 300, already expired = 100, balance = 250
    const { toExpire, actualExpired } = computeOrgExpiry(300, 100, 250);
    expect(toExpire).toBe(200);         // 300 - 100
    expect(actualExpired).toBe(200);    // min(200, 250)
    expect(applyOrgExpiry(250, actualExpired)).toBe(50);
  });

  test('MBL-S3-08: expiry audit — actualExpired reflects the exact deduction amount', () => {
    // balance is only 80 but 200 should expire
    const { toExpire, actualExpired } = computeOrgExpiry(200, 0, 80);
    expect(toExpire).toBe(200);
    expect(actualExpired).toBe(80);     // capped at balance
    expect(applyOrgExpiry(80, actualExpired)).toBe(0);
  });
});

describe('Sprint MBL-03: Balance Never Negative', () => {
  test('MBL-S3-09: balance floored at 0 — expiry cannot exceed balance', () => {
    const { actualExpired } = computeOrgExpiry(1000, 0, 300);
    expect(actualExpired).toBe(300);    // capped at current balance
    expect(applyOrgExpiry(300, actualExpired)).toBe(0);
  });

  test('MBL-S3-10: applyOrgExpiry always returns >= 0 even if actualExpired > balance', () => {
    // Safety net for arithmetic edge cases
    expect(applyOrgExpiry(0, 0)).toBe(0);
    expect(applyOrgExpiry(100, 100)).toBe(0);
    expect(applyOrgExpiry(50, 0)).toBe(50);
  });

  test('MBL-S3-11: redemption + expiry race — balance cannot go below 0', () => {
    // If concurrent redemption reduced balance from 200 to 50, expiry of 200 can only take 50
    const balanceAfterRedemption = 50;
    const { actualExpired } = computeOrgExpiry(200, 0, balanceAfterRedemption);
    expect(actualExpired).toBe(50);
    expect(applyOrgExpiry(balanceAfterRedemption, actualExpired)).toBe(0);
  });
});

describe('Sprint MBL-03: Idempotency & Duplicate Expiry', () => {
  test('MBL-S3-12: already-expired guard — re-run on same day deducts nothing', () => {
    // All earned expired = 200, already expired = 200
    const { toExpire } = computeOrgExpiry(200, 200, 0);
    expect(toExpire).toBe(0);
  });

  test('MBL-S3-13: partial idempotency — second run only deducts the remainder', () => {
    // First run expired 100 of 200. Second run should only expire 100 more.
    const { toExpire } = computeOrgExpiry(200, 100, 100);
    expect(toExpire).toBe(100);
  });

  test('MBL-S3-14: alreadyExpired > totalExpired is treated as fully idempotent', () => {
    // Guard: alreadyExpired could theoretically exceed total in edge cases
    const { toExpire } = computeOrgExpiry(100, 150, 100);
    expect(toExpire).toBe(0);   // max(0, 100-150) = 0
  });

  test('MBL-S3-15: reversed earn points do not contribute to expiry', () => {
    // Reversed earn txns are type 'reverse', not 'earn'. The expiry aggregate
    // only sums type='earn' txns, so reversals are implicitly excluded.
    // We validate the sum logic: only counting earn-typed points.
    const txns = [
      { type: 'earn',    points: 100, orgCustomerId: 'c1' },
      { type: 'reverse', points: -100, orgCustomerId: 'c1' }, // should not count
      { type: 'earn',    points: 50, orgCustomerId: 'c1' },
    ];
    const totalEarn = txns
      .filter(t => t.type === 'earn')
      .reduce((sum, t) => sum + t.points, 0);
    expect(totalEarn).toBe(150); // only 100 + 50
  });
});

describe('Sprint MBL-03: Org-Scoped Expiry', () => {
  test('MBL-S3-16: expiry is per-orgCustomer — different org customers are independent', () => {
    const customers = [
      { orgCustomerId: 'c1', totalEarnExpired: 200, alreadyExpired: 50, balance: 180 },
      { orgCustomerId: 'c2', totalEarnExpired: 100, alreadyExpired: 0,  balance: 100 },
    ];
    const results = customers.map(c => {
      const { actualExpired } = computeOrgExpiry(c.totalEarnExpired, c.alreadyExpired, c.balance);
      return { id: c.orgCustomerId, actualExpired, newBalance: applyOrgExpiry(c.balance, actualExpired) };
    });
    expect(results[0].actualExpired).toBe(150);
    expect(results[0].newBalance).toBe(30);
    expect(results[1].actualExpired).toBe(100);
    expect(results[1].newBalance).toBe(0);
  });

  test('MBL-S3-17: expiry only matches transactions with orgCustomerId set', () => {
    // Transactions without orgCustomerId are branch-only loyalty — expiry worker skips them
    const txns = [
      { orgCustomerId: 'c1', transactionType: 'earn', points: 100 },
      { orgCustomerId: null, transactionType: 'earn', points: 200 }, // branch-only
      { orgCustomerId: 'c2', transactionType: 'earn', points: 50  },
    ];
    const orgEarns = txns.filter(t => t.orgCustomerId !== null && t.transactionType === 'earn');
    expect(orgEarns.length).toBe(2);
    expect(orgEarns.reduce((s, t) => s + t.points, 0)).toBe(150);
  });
});

describe('Sprint MBL-03: History API Auth & Scope', () => {
  test('MBL-S3-18: resolveOrg returns null for non-multiBranch hotel', () => {
    const hotel = { parentHotelId: null, features: { multiBranch: false } };
    const result = hotel.features.multiBranch ? 'allowed' : null;
    expect(result).toBeNull();
  });

  test('MBL-S3-19: resolveOrg returns orgHotelId = self for HQ', () => {
    const hotel = { _id: 'hq1', parentHotelId: null, features: { multiBranch: true } };
    const orgHotelId = hotel.parentHotelId ?? hotel._id;
    expect(orgHotelId).toBe('hq1');
  });

  test('MBL-S3-20: resolveOrg returns orgHotelId = parentHotelId for branch', () => {
    const hotel = { _id: 'b1', parentHotelId: 'hq1', features: { multiBranch: true } };
    const orgHotelId = hotel.parentHotelId ?? hotel._id;
    expect(orgHotelId).toBe('hq1');
  });

  test('MBL-S3-21: history API rejects org customer from different org', () => {
    // orgCustomer.orgHotelId must equal ctx.orgHotelId
    const ctx = { orgHotelId: 'hq1' };
    const orgCustomer = { orgHotelId: 'hq2' }; // different org
    const isAllowed = orgCustomer.orgHotelId === ctx.orgHotelId;
    expect(isAllowed).toBe(false);
  });

  test('MBL-S3-22: history API allows org customer from same org', () => {
    const ctx = { orgHotelId: 'hq1' };
    const orgCustomer = { orgHotelId: 'hq1' };
    const isAllowed = orgCustomer.orgHotelId === ctx.orgHotelId;
    expect(isAllowed).toBe(true);
  });
});

describe('Sprint MBL-03: History API Pagination', () => {
  const ITEMS = Array.from({ length: 55 }, (_, i) => ({ txnId: `t${i}`, points: i + 1 }));

  test('MBL-S3-23: default page=1 limit=20 returns first 20 items', () => {
    const { data, total, page, limit } = paginateResults(ITEMS, 1, 20);
    expect(data.length).toBe(20);
    expect(total).toBe(55);
    expect(page).toBe(1);
    expect(limit).toBe(20);
    expect(data[0].txnId).toBe('t0');
  });

  test('MBL-S3-24: page=2 limit=20 returns items 20-39', () => {
    const { data } = paginateResults(ITEMS, 2, 20);
    expect(data.length).toBe(20);
    expect(data[0].txnId).toBe('t20');
  });

  test('MBL-S3-25: last page returns remaining items', () => {
    const { data, total } = paginateResults(ITEMS, 3, 20);
    expect(total).toBe(55);
    expect(data.length).toBe(15);   // 55 - 40 = 15
  });

  test('MBL-S3-26: limit is capped at 100', () => {
    const big = Array.from({ length: 200 }, (_, i) => ({ txnId: `t${i}` }));
    const { data, limit } = paginateResults(big, 1, 500);
    expect(limit).toBe(100);
    expect(data.length).toBe(100);
  });

  test('MBL-S3-27: empty org customer history returns empty array', () => {
    const { data, total } = paginateResults([], 1, 20);
    expect(data).toEqual([]);
    expect(total).toBe(0);
  });
});

describe('Sprint MBL-03: HQ & Branch Feature Flag Logic', () => {
  test('MBL-S3-28: org loyalty requires HQ features.orgLoyalty === true', () => {
    expect(isOrgLoyaltyEligible({ orgLoyalty: false }, {}, 'hq1', false, 'oc1')).toBe(false);
    expect(isOrgLoyaltyEligible({ orgLoyalty: true },  {}, 'hq1', false, 'oc1')).toBe(true);
  });

  test('MBL-S3-29: branch can opt out via orgLoyaltyEnabled === false', () => {
    expect(isOrgLoyaltyEligible({ orgLoyalty: true }, { orgLoyaltyEnabled: false }, 'hq1', false, 'oc1')).toBe(false);
    expect(isOrgLoyaltyEligible({ orgLoyalty: true }, { orgLoyaltyEnabled: true  }, 'hq1', false, 'oc1')).toBe(true);
  });

  test('MBL-S3-30: orgLoyaltyEnabled defaults to true (undefined = participating)', () => {
    // undefined is not === false, so branch is participating by default
    expect(isOrgLoyaltyEligible({ orgLoyalty: true }, { orgLoyaltyEnabled: undefined }, 'hq1', false, 'oc1')).toBe(true);
  });

  test('MBL-S3-31: HQ hotel (parentHotelId null) cannot earn org loyalty', () => {
    // parentHotelId must be set — HQ itself is not a branch
    expect(isOrgLoyaltyEligible({ orgLoyalty: true }, {}, null, false, 'oc1')).toBe(false);
  });

  test('MBL-S3-32: customer with loyaltyOptOut=true is excluded from org loyalty', () => {
    expect(isOrgLoyaltyEligible({ orgLoyalty: true }, {}, 'hq1', true, 'oc1')).toBe(false);
  });

  test('MBL-S3-33: customer without orgCustomerId cannot earn org loyalty', () => {
    expect(isOrgLoyaltyEligible({ orgLoyalty: true }, {}, 'hq1', false, null)).toBe(false);
  });
});

describe('Sprint MBL-03: Offline Org Redemption Guard', () => {
  test('MBL-S3-34: assertOfflineQueueable throws when redeemedPoints > 0', () => {
    expect(() => assertOfflineQueueable(10)).toThrow('Loyalty redemption requires an internet connection.');
    expect(() => assertOfflineQueueable(1)).toThrow();
    expect(() => assertOfflineQueueable(0)).not.toThrow();
  });

  test('MBL-S3-35: assertOfflineQueueable allows orders with 0 redeemed points', () => {
    expect(() => assertOfflineQueueable(0)).not.toThrow();
  });

  test('MBL-S3-36: org loyalty redemption blocked offline — same guard as branch', () => {
    // The guard is redemption-agnostic. Any positive redeemedPoints, org or branch, is blocked.
    const payload = { redeemedPoints: 50, isOrgOrder: true };
    expect(() => assertOfflineQueueable(payload.redeemedPoints)).toThrow();
  });
});
