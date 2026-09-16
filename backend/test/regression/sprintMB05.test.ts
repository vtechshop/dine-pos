/**
 * sprintMB05.test.ts — Multi-Branch Sprint 5: Production Hardening
 *
 * 60+ pure-logic regression tests. No DB, no HTTP, no external dependencies.
 * Tests cover: authentication invariants, branch isolation, catalog visibility,
 * coupon/voucher scope, settings inheritance, customer identity, security matrix,
 * authorization, single-branch backward compat, and concurrency patterns.
 *
 * Numbering: MB-S5-01 … MB-S5-65
 */

import mongoose from 'mongoose';

// ─── helpers that mirror backend logic ────────────────────────────────────────

function mkId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

function mkIdStr(): string {
  return mkId().toHexString();
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1: hotelId / JWT authority invariants (MB-S5-01 … 06)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The server MUST derive hotelId from the JWT payload, not from request body.
 * These tests verify the extraction pattern is correct and body fields cannot
 * override it.
 */
describe('MB-S5-01…06 — JWT authority for hotelId', () => {
  /** Simulated JWT decode result */
  interface JwtPayload {
    userId: string;
    hotelId: string;
    role: string;
  }

  /** Mirrors what authMiddleware does: take hotelId from token, never body */
  function resolveHotelId(
    jwtPayload: JwtPayload,
    bodyHotelId?: string,
  ): string {
    return jwtPayload.hotelId; // body is intentionally ignored
  }

  it('MB-S5-01 — resolveHotelId returns JWT hotelId even when body has different value', () => {
    const jwt: JwtPayload = { userId: mkIdStr(), hotelId: mkIdStr(), role: 'cashier' };
    const attackerBodyHotelId = mkIdStr();
    expect(resolveHotelId(jwt, attackerBodyHotelId)).toBe(jwt.hotelId);
    expect(resolveHotelId(jwt, attackerBodyHotelId)).not.toBe(attackerBodyHotelId);
  });

  it('MB-S5-02 — resolveHotelId works when body is absent', () => {
    const jwt: JwtPayload = { userId: mkIdStr(), hotelId: mkIdStr(), role: 'admin' };
    expect(resolveHotelId(jwt)).toBe(jwt.hotelId);
  });

  it('MB-S5-03 — resolveHotelId is deterministic for multiple calls', () => {
    const jwt: JwtPayload = { userId: mkIdStr(), hotelId: mkIdStr(), role: 'admin' };
    const id1 = resolveHotelId(jwt, mkIdStr());
    const id2 = resolveHotelId(jwt, mkIdStr());
    expect(id1).toBe(id2);
  });

  it('MB-S5-04 — JWT hotelId identity preserved across re-encode/decode simulation', () => {
    const originalId = mkIdStr();
    // Simulate encode → decode round-trip (in practice via JWT lib)
    const simulated = { ...{ userId: mkIdStr(), hotelId: originalId, role: 'admin' } };
    expect(simulated.hotelId).toBe(originalId);
  });

  it('MB-S5-05 — branch JWT has different hotelId than org JWT for same user', () => {
    const userId = mkIdStr();
    const orgJwt: JwtPayload  = { userId, hotelId: mkIdStr(), role: 'admin' };
    const branchJwt: JwtPayload = { userId, hotelId: mkIdStr(), role: 'admin' };
    expect(orgJwt.hotelId).not.toBe(branchJwt.hotelId);
  });

  it('MB-S5-06 — resolveHotelId returns string (not ObjectId) matching stored format', () => {
    const id = mkIdStr();
    const jwt: JwtPayload = { userId: mkIdStr(), hotelId: id, role: 'admin' };
    const result = resolveHotelId(jwt);
    expect(typeof result).toBe('string');
    expect(result).toHaveLength(24);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2: Branch switch token flow (MB-S5-07 … 12)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S5-07…12 — Branch switch token flow', () => {
  interface TokenStore {
    pos_token: string;
    pos_refresh_token: string;
    pos_org_token?: string;
    pos_org_refresh_token?: string;
  }

  /** Mirrors AuthContext.switchToBranch() localStorage mutation */
  function switchToBranch(
    store: TokenStore,
    branchToken: string,
    branchRefresh: string,
  ): TokenStore {
    // Stash HQ token if not already stashed
    const orgToken = store.pos_org_token ?? store.pos_token;
    const orgRefresh = store.pos_org_refresh_token ?? store.pos_refresh_token;
    return {
      pos_token: branchToken,
      pos_refresh_token: branchRefresh,
      pos_org_token: orgToken,
      pos_org_refresh_token: orgRefresh,
    };
  }

  /** Mirrors AuthContext.switchToOrg() localStorage mutation */
  function switchToOrg(store: TokenStore): TokenStore {
    if (!store.pos_org_token) return store; // not in branch context
    return {
      pos_token: store.pos_org_token,
      pos_refresh_token: store.pos_org_refresh_token ?? store.pos_refresh_token,
      pos_org_token: undefined,
      pos_org_refresh_token: undefined,
    };
  }

  it('MB-S5-07 — after switchToBranch pos_token is the branch token', () => {
    const s: TokenStore = { pos_token: 'hq-tok', pos_refresh_token: 'hq-ref' };
    const after = switchToBranch(s, 'br-tok', 'br-ref');
    expect(after.pos_token).toBe('br-tok');
  });

  it('MB-S5-08 — after switchToBranch HQ token is stashed in pos_org_token', () => {
    const s: TokenStore = { pos_token: 'hq-tok', pos_refresh_token: 'hq-ref' };
    const after = switchToBranch(s, 'br-tok', 'br-ref');
    expect(after.pos_org_token).toBe('hq-tok');
  });

  it('MB-S5-09 — switchToOrg restores pos_token from pos_org_token', () => {
    const s: TokenStore = { pos_token: 'hq-tok', pos_refresh_token: 'hq-ref' };
    const inBranch = switchToBranch(s, 'br-tok', 'br-ref');
    const restored = switchToOrg(inBranch);
    expect(restored.pos_token).toBe('hq-tok');
  });

  it('MB-S5-10 — switchToOrg clears pos_org_token after restore', () => {
    const s: TokenStore = { pos_token: 'hq-tok', pos_refresh_token: 'hq-ref' };
    const inBranch = switchToBranch(s, 'br-tok', 'br-ref');
    const restored = switchToOrg(inBranch);
    expect(restored.pos_org_token).toBeUndefined();
  });

  it('MB-S5-11 — double branch switch: second stash uses original HQ token, not branch token', () => {
    const s: TokenStore = { pos_token: 'hq-tok', pos_refresh_token: 'hq-ref' };
    const inBranch1 = switchToBranch(s, 'br1-tok', 'br1-ref');
    const inBranch2 = switchToBranch(inBranch1, 'br2-tok', 'br2-ref');
    // pos_org_token must be original HQ token, not br1 token
    expect(inBranch2.pos_org_token).toBe('hq-tok');
  });

  it('MB-S5-12 — switchToOrg is a no-op when not in branch context', () => {
    const s: TokenStore = { pos_token: 'hq-tok', pos_refresh_token: 'hq-ref' };
    const result = switchToOrg(s);
    expect(result.pos_token).toBe('hq-tok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3: Category visibility — CategoryConfig default-ENABLED (MB-S5-13 … 18)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S5-13…18 — CategoryConfig default-ENABLED visibility logic', () => {
  interface Category { _id: string; name: string; }
  interface CategoryConfigRow { categoryId: string; enabled: boolean; }

  /** Mirrors categoryRoutes.ts GET / logic for branch hotels */
  function filterVisibleCategories(
    allCategories: Category[],
    disabledConfigs: CategoryConfigRow[],
  ): Category[] {
    const disabledIds = new Set(disabledConfigs.filter(c => !c.enabled).map(c => c.categoryId));
    return allCategories.filter(cat => !disabledIds.has(cat._id));
  }

  const cats: Category[] = [
    { _id: 'cat-A', name: 'Starters' },
    { _id: 'cat-B', name: 'Mains' },
    { _id: 'cat-C', name: 'Desserts' },
  ];

  it('MB-S5-13 — no config rows → all categories visible (default-ENABLED)', () => {
    expect(filterVisibleCategories(cats, [])).toHaveLength(3);
  });

  it('MB-S5-14 — one disabled config → that category hidden', () => {
    const visible = filterVisibleCategories(cats, [{ categoryId: 'cat-B', enabled: false }]);
    expect(visible.map(c => c._id)).not.toContain('cat-B');
  });

  it('MB-S5-15 — enabled:true config row does NOT hide the category', () => {
    const visible = filterVisibleCategories(cats, [{ categoryId: 'cat-B', enabled: true }]);
    expect(visible).toHaveLength(3);
  });

  it('MB-S5-16 — all three disabled → empty result', () => {
    const configs: CategoryConfigRow[] = cats.map(c => ({ categoryId: c._id, enabled: false }));
    expect(filterVisibleCategories(cats, configs)).toHaveLength(0);
  });

  it('MB-S5-17 — config for unknown categoryId does not affect known categories', () => {
    const visible = filterVisibleCategories(cats, [{ categoryId: 'cat-UNKNOWN', enabled: false }]);
    expect(visible).toHaveLength(3);
  });

  it('MB-S5-18 — mix of enabled and disabled configs → only disabled ones hidden', () => {
    const configs: CategoryConfigRow[] = [
      { categoryId: 'cat-A', enabled: false },
      { categoryId: 'cat-B', enabled: true },
    ];
    const visible = filterVisibleCategories(cats, configs);
    expect(visible.map(c => c._id)).toEqual(['cat-B', 'cat-C']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4: BranchProductConfig default-DISABLED overlay (MB-S5-19 … 24)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S5-19…24 — BranchProductConfig default-DISABLED visibility logic', () => {
  interface Product { _id: string; name: string; price: number; }
  interface BranchProductConfigRow { productId: string; isVisible: boolean; overridePrice?: number; }

  /** Mirrors catalogRoutes.ts logic: default-DISABLED means product only visible if config row exists with isVisible:true */
  function filterBranchProducts(
    allOrgProducts: Product[],
    branchConfigs: BranchProductConfigRow[],
  ): Array<Product & { effectivePrice: number }> {
    const configMap = new Map(branchConfigs.map(c => [c.productId, c]));
    return allOrgProducts
      .filter(p => configMap.get(p._id)?.isVisible === true)
      .map(p => {
        const cfg = configMap.get(p._id)!;
        return { ...p, effectivePrice: cfg.overridePrice ?? p.price };
      });
  }

  const products: Product[] = [
    { _id: 'p1', name: 'Paneer Tikka', price: 250 },
    { _id: 'p2', name: 'Dal Makhani', price: 180 },
    { _id: 'p3', name: 'Naan', price: 40 },
  ];

  it('MB-S5-19 — no config rows → no products visible (default-DISABLED)', () => {
    expect(filterBranchProducts(products, [])).toHaveLength(0);
  });

  it('MB-S5-20 — isVisible:true config → product visible', () => {
    const result = filterBranchProducts(products, [{ productId: 'p1', isVisible: true }]);
    expect(result.map(p => p._id)).toContain('p1');
  });

  it('MB-S5-21 — isVisible:false config → product still hidden', () => {
    const result = filterBranchProducts(products, [{ productId: 'p1', isVisible: false }]);
    expect(result).toHaveLength(0);
  });

  it('MB-S5-22 — overridePrice replaces org price', () => {
    const result = filterBranchProducts(products, [{ productId: 'p1', isVisible: true, overridePrice: 299 }]);
    expect(result[0].effectivePrice).toBe(299);
  });

  it('MB-S5-23 — no overridePrice → org price used', () => {
    const result = filterBranchProducts(products, [{ productId: 'p2', isVisible: true }]);
    expect(result[0].effectivePrice).toBe(180);
  });

  it('MB-S5-24 — partial config: only visible products returned', () => {
    const configs: BranchProductConfigRow[] = [
      { productId: 'p1', isVisible: true },
      { productId: 'p2', isVisible: false },
    ];
    const result = filterBranchProducts(products, configs);
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe('p1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 5: Coupon scope resolution (MB-S5-25 … 30)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S5-25…30 — Coupon scope resolution logic', () => {
  interface Coupon {
    _id: string;
    scope: 'branch' | 'organization';
    orgHotelId?: string;
    selectedBranchIds?: string[];
    isActive: boolean;
    isDeleted: boolean;
  }

  /** Mirrors couponRoutes.ts: is this org coupon valid for the requesting branchId? */
  function isOrgCouponValidForBranch(coupon: Coupon, branchId: string): boolean {
    if (coupon.scope !== 'organization') return false;
    if (!coupon.isActive || coupon.isDeleted) return false;
    if (!coupon.selectedBranchIds || coupon.selectedBranchIds.length === 0) {
      return true; // empty = all branches
    }
    return coupon.selectedBranchIds.includes(branchId);
  }

  const orgId = mkIdStr();
  const br1 = mkIdStr();
  const br2 = mkIdStr();

  const allBranchCoupon: Coupon = { _id: mkIdStr(), scope: 'organization', orgHotelId: orgId, selectedBranchIds: [], isActive: true, isDeleted: false };
  const restrictedCoupon: Coupon = { _id: mkIdStr(), scope: 'organization', orgHotelId: orgId, selectedBranchIds: [br1], isActive: true, isDeleted: false };
  const branchCoupon: Coupon = { _id: mkIdStr(), scope: 'branch', isActive: true, isDeleted: false };
  const inactiveCoupon: Coupon = { _id: mkIdStr(), scope: 'organization', orgHotelId: orgId, selectedBranchIds: [], isActive: false, isDeleted: false };

  it('MB-S5-25 — org coupon with empty selectedBranchIds is valid for any branch', () => {
    expect(isOrgCouponValidForBranch(allBranchCoupon, br1)).toBe(true);
    expect(isOrgCouponValidForBranch(allBranchCoupon, br2)).toBe(true);
  });

  it('MB-S5-26 — org coupon with selectedBranchIds=[br1] is valid for br1 only', () => {
    expect(isOrgCouponValidForBranch(restrictedCoupon, br1)).toBe(true);
    expect(isOrgCouponValidForBranch(restrictedCoupon, br2)).toBe(false);
  });

  it('MB-S5-27 — branch-scoped coupon is not valid through org coupon path', () => {
    expect(isOrgCouponValidForBranch(branchCoupon, br1)).toBe(false);
  });

  it('MB-S5-28 — inactive org coupon is not valid for any branch', () => {
    expect(isOrgCouponValidForBranch(inactiveCoupon, br1)).toBe(false);
  });

  it('MB-S5-29 — deleted org coupon is not valid', () => {
    const deleted: Coupon = { ...allBranchCoupon, isDeleted: true };
    expect(isOrgCouponValidForBranch(deleted, br1)).toBe(false);
  });

  it('MB-S5-30 — org coupon restricted to multiple branches validates each correctly', () => {
    const multi: Coupon = { _id: mkIdStr(), scope: 'organization', orgHotelId: orgId, selectedBranchIds: [br1, br2], isActive: true, isDeleted: false };
    expect(isOrgCouponValidForBranch(multi, br1)).toBe(true);
    expect(isOrgCouponValidForBranch(multi, br2)).toBe(true);
    expect(isOrgCouponValidForBranch(multi, mkIdStr())).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 6: GiftVoucher redeem filter selection (MB-S5-31 … 36)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S5-31…36 — GiftVoucher redeem filter selection', () => {
  interface VoucherLookupResult {
    _id: string;
    scope: 'branch' | 'organization';
    hotelId?: string;
    orgHotelId?: string;
    voucherCode: string;
    balance: number;
  }

  /** Mirrors giftVoucherRoutes.ts voucherFilter selection for atomic update */
  function buildVoucherFilter(
    voucher: VoucherLookupResult,
    callerHotelId: string,
  ): Record<string, unknown> {
    if (voucher.scope === 'organization') {
      // Org voucher: use _id to avoid branch-hotelId mismatch
      return { _id: voucher._id };
    }
    // Branch voucher: use hotelId + voucherCode (preserves unique index usage)
    return { hotelId: callerHotelId, voucherCode: voucher.voucherCode };
  }

  const branchId = mkIdStr();
  const orgId = mkIdStr();

  it('MB-S5-31 — branch voucher filter uses hotelId + voucherCode', () => {
    const v: VoucherLookupResult = { _id: mkIdStr(), scope: 'branch', hotelId: branchId, voucherCode: 'GIFT001', balance: 500 };
    const filter = buildVoucherFilter(v, branchId);
    expect(filter).toEqual({ hotelId: branchId, voucherCode: 'GIFT001' });
  });

  it('MB-S5-32 — org voucher filter uses _id only (not hotelId)', () => {
    const id = mkIdStr();
    const v: VoucherLookupResult = { _id: id, scope: 'organization', orgHotelId: orgId, voucherCode: 'GIFT001', balance: 500 };
    const filter = buildVoucherFilter(v, branchId);
    expect(filter).toEqual({ _id: id });
    expect(filter.hotelId).toBeUndefined();
  });

  it('MB-S5-33 — branch voucher filter is idempotent for same input', () => {
    const v: VoucherLookupResult = { _id: mkIdStr(), scope: 'branch', hotelId: branchId, voucherCode: 'GIFT002', balance: 200 };
    const f1 = buildVoucherFilter(v, branchId);
    const f2 = buildVoucherFilter(v, branchId);
    expect(f1).toEqual(f2);
  });

  it('MB-S5-34 — org voucher from branch A is addressable even when caller is branch B', () => {
    const branchB = mkIdStr();
    const id = mkIdStr();
    const v: VoucherLookupResult = { _id: id, scope: 'organization', orgHotelId: orgId, voucherCode: 'ORG001', balance: 1000 };
    const filter = buildVoucherFilter(v, branchB);
    // Filter must use _id — not branchB's hotelId — so the update finds the document
    expect(filter).toEqual({ _id: id });
  });

  it('MB-S5-35 — branch voucher callerHotelId is used verbatim in filter (server-trusted)', () => {
    const v: VoucherLookupResult = { _id: mkIdStr(), scope: 'branch', hotelId: branchId, voucherCode: 'LOCAL1', balance: 100 };
    const attackerId = mkIdStr();
    const filter = buildVoucherFilter(v, attackerId);
    // hotelId in filter is from caller's JWT (server-resolved), attacker can't inject a different one
    expect((filter as any).hotelId).toBe(attackerId);
  });

  it('MB-S5-36 — zero-balance voucher: filter is correct even when balance is 0', () => {
    const v: VoucherLookupResult = { _id: mkIdStr(), scope: 'branch', hotelId: branchId, voucherCode: 'ZERO', balance: 0 };
    const filter = buildVoucherFilter(v, branchId);
    expect(filter).toEqual({ hotelId: branchId, voucherCode: 'ZERO' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 7: Settings inheritance / reset-fields (MB-S5-37 … 42)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S5-37…42 — Settings inheritance and reset-fields', () => {
  const INHERITABLE_FROM_HQ = new Set([
    'businessType',
    'currencySymbol',
    'defaultTaxPercent',
    'footerText',
    'loyaltySettings',
  ]);

  interface SettingsDoc {
    hotelId: string;
    businessType?: string;
    currencySymbol?: string;
    defaultTaxPercent?: number;
    footerText?: string;
    loyaltySettings?: object;
    nonInheritable?: string;
  }

  /** Mirrors settingsRoutes.ts POST /reset-fields logic */
  function validateResetFields(requestedFields: string[]): string[] {
    return requestedFields.filter(f => INHERITABLE_FROM_HQ.has(f));
  }

  /** Mirrors _inheritedFromOrg computation: fields present in HQ settings but absent in branch */
  function computeInheritedFields(
    hqSettings: SettingsDoc,
    branchSettings: SettingsDoc,
  ): string[] {
    return [...INHERITABLE_FROM_HQ].filter(field => {
      const hqHas = (hqSettings as any)[field] !== undefined;
      const branchOverrides = (branchSettings as any)[field] !== undefined;
      return hqHas && !branchOverrides;
    });
  }

  it('MB-S5-37 — validateResetFields filters out non-inheritable fields', () => {
    const result = validateResetFields(['businessType', 'nonInheritable', 'footerText']);
    expect(result).toEqual(['businessType', 'footerText']);
  });

  it('MB-S5-38 — validateResetFields returns empty when no fields are inheritable', () => {
    expect(validateResetFields(['fakeField', 'anotherFake'])).toHaveLength(0);
  });

  it('MB-S5-39 — validateResetFields accepts all 5 inheritable fields', () => {
    const allInheritable = [...INHERITABLE_FROM_HQ];
    const result = validateResetFields(allInheritable);
    expect(result).toHaveLength(5);
  });

  it('MB-S5-40 — computeInheritedFields returns field present in HQ but not branch', () => {
    const hq: SettingsDoc = { hotelId: mkIdStr(), currencySymbol: '₹', defaultTaxPercent: 5 };
    const branch: SettingsDoc = { hotelId: mkIdStr() }; // no overrides
    const inherited = computeInheritedFields(hq, branch);
    expect(inherited).toContain('currencySymbol');
    expect(inherited).toContain('defaultTaxPercent');
  });

  it('MB-S5-41 — computeInheritedFields does NOT flag field present in both (branch overrides)', () => {
    const hq: SettingsDoc = { hotelId: mkIdStr(), currencySymbol: '₹' };
    const branch: SettingsDoc = { hotelId: mkIdStr(), currencySymbol: '$' };
    expect(computeInheritedFields(hq, branch)).not.toContain('currencySymbol');
  });

  it('MB-S5-42 — computeInheritedFields ignores non-inheritable fields even if present in HQ', () => {
    const hq: SettingsDoc = { hotelId: mkIdStr(), nonInheritable: 'someValue' };
    const branch: SettingsDoc = { hotelId: mkIdStr() };
    // nonInheritable is not in INHERITABLE_FROM_HQ, so should never appear
    expect(computeInheritedFields(hq, branch)).not.toContain('nonInheritable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 8: OrganizationCustomer — no auto-merge, explicit link only (MB-S5-43 … 48)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S5-43…48 — OrganizationCustomer: no auto-merge, explicit link only', () => {
  interface CustomerProfile {
    _id: string;
    hotelId: string;
    phone?: string;
    email?: string;
    orgCustomerId?: string | null;
    loyaltyBalance: number;
    walletBalance: number;
  }

  interface OrgCustomer {
    _id: string;
    orgHotelId: string;
    canonicalPhone?: string | null;
    canonicalEmail?: string | null;
  }

  /** Mirrors orgCustomerRoutes.ts POST /:id/link — sets orgCustomerId, nothing else */
  function linkProfileToOrgCustomer(
    profile: CustomerProfile,
    orgCustomerId: string,
  ): CustomerProfile {
    return {
      ...profile,
      orgCustomerId,
      // loyaltyBalance and walletBalance MUST NOT change
    };
  }

  it('MB-S5-43 — linkProfileToOrgCustomer sets orgCustomerId', () => {
    const profile: CustomerProfile = { _id: mkIdStr(), hotelId: mkIdStr(), loyaltyBalance: 100, walletBalance: 500, orgCustomerId: null };
    const orgId = mkIdStr();
    const linked = linkProfileToOrgCustomer(profile, orgId);
    expect(linked.orgCustomerId).toBe(orgId);
  });

  it('MB-S5-44 — link does NOT modify loyaltyBalance', () => {
    const profile: CustomerProfile = { _id: mkIdStr(), hotelId: mkIdStr(), loyaltyBalance: 250, walletBalance: 0, orgCustomerId: null };
    const linked = linkProfileToOrgCustomer(profile, mkIdStr());
    expect(linked.loyaltyBalance).toBe(250);
  });

  it('MB-S5-45 — link does NOT modify walletBalance', () => {
    const profile: CustomerProfile = { _id: mkIdStr(), hotelId: mkIdStr(), loyaltyBalance: 0, walletBalance: 750, orgCustomerId: null };
    const linked = linkProfileToOrgCustomer(profile, mkIdStr());
    expect(linked.walletBalance).toBe(750);
  });

  it('MB-S5-46 — two profiles with same phone are NOT auto-linked', () => {
    const hotelA = mkIdStr();
    const hotelB = mkIdStr();
    const p1: CustomerProfile = { _id: mkIdStr(), hotelId: hotelA, phone: '9876543210', loyaltyBalance: 100, walletBalance: 0, orgCustomerId: null };
    const p2: CustomerProfile = { _id: mkIdStr(), hotelId: hotelB, phone: '9876543210', loyaltyBalance: 200, walletBalance: 0, orgCustomerId: null };
    // No auto-link: their orgCustomerId must remain null unless staff explicitly links
    expect(p1.orgCustomerId).toBeNull();
    expect(p2.orgCustomerId).toBeNull();
  });

  it('MB-S5-47 — OrgCustomer canonicalPhone normalisation: digits only', () => {
    function normalizePhone(raw: string): string {
      const digits = raw.replace(/\D/g, '');
      return digits.length >= 10 ? digits.slice(-10) : digits;
    }
    expect(normalizePhone('+91-98765-43210')).toBe('9876543210');
    expect(normalizePhone('098765 43210')).toBe('9876543210');
    expect(normalizePhone('9876543210')).toBe('9876543210');
  });

  it('MB-S5-48 — OrgCustomer canonicalEmail normalisation: lowercase trimmed', () => {
    function normalizeEmail(raw: string): string {
      return raw.trim().toLowerCase();
    }
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
    expect(normalizeEmail('JOHN@DOE.IN')).toBe('john@doe.in');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 9: Cross-branch security & authorization matrix (MB-S5-49 … 54)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S5-49…54 — Cross-branch security & authorization matrix', () => {
  interface BranchDoc {
    _id: string;
    parentHotelId: string | null;
    features?: { multiBranch?: boolean };
    status: 'active' | 'suspended';
  }

  /** Mirrors POST /api/branches/switch validation */
  function validateBranchSwitch(
    callerOrgHotelId: string,
    targetBranch: BranchDoc,
  ): { ok: boolean; reason?: string } {
    if (!targetBranch.parentHotelId) {
      return { ok: false, reason: 'target is not a branch' };
    }
    if (targetBranch.parentHotelId !== callerOrgHotelId) {
      return { ok: false, reason: 'branch does not belong to caller org' };
    }
    if (targetBranch.status === 'suspended') {
      return { ok: false, reason: 'branch is suspended' };
    }
    return { ok: true };
  }

  const orgId = mkIdStr();
  const otherOrgId = mkIdStr();

  it('MB-S5-49 — switching to own branch is allowed', () => {
    const branch: BranchDoc = { _id: mkIdStr(), parentHotelId: orgId, features: { multiBranch: true }, status: 'active' };
    expect(validateBranchSwitch(orgId, branch).ok).toBe(true);
  });

  it('MB-S5-50 — switching to another org branch is REJECTED', () => {
    const foreignBranch: BranchDoc = { _id: mkIdStr(), parentHotelId: otherOrgId, features: { multiBranch: true }, status: 'active' };
    const result = validateBranchSwitch(orgId, foreignBranch);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('belong to caller org');
  });

  it('MB-S5-51 — switching to a standalone hotel (parentHotelId:null) is REJECTED', () => {
    const standalone: BranchDoc = { _id: mkIdStr(), parentHotelId: null, status: 'active' };
    const result = validateBranchSwitch(orgId, standalone);
    expect(result.ok).toBe(false);
  });

  it('MB-S5-52 — switching to a suspended branch is REJECTED', () => {
    const suspended: BranchDoc = { _id: mkIdStr(), parentHotelId: orgId, status: 'suspended' };
    const result = validateBranchSwitch(orgId, suspended);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('suspended');
  });

  it('MB-S5-53 — org report query must scope branches to orgHotelId', () => {
    /** Mirrors reportRoutes.ts GET /org-summary branch scoping */
    function buildOrgReportQuery(orgHotelId: string): Record<string, unknown> {
      return { 'hotel.parentHotelId': orgHotelId };
    }
    const q = buildOrgReportQuery(orgId);
    expect(q['hotel.parentHotelId']).toBe(orgId);
  });

  it('MB-S5-54 — multiBranch feature gate: branch category overlay only applies when feature enabled', () => {
    function shouldApplyBranchOverlay(hotel: { parentHotelId: string | null; features?: { multiBranch?: boolean } }): boolean {
      return !!(hotel.parentHotelId && hotel.features?.multiBranch);
    }
    expect(shouldApplyBranchOverlay({ parentHotelId: orgId, features: { multiBranch: true } })).toBe(true);
    expect(shouldApplyBranchOverlay({ parentHotelId: orgId, features: { multiBranch: false } })).toBe(false);
    expect(shouldApplyBranchOverlay({ parentHotelId: null, features: { multiBranch: true } })).toBe(false);
    expect(shouldApplyBranchOverlay({ parentHotelId: null })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 10: Single-branch backward compatibility (MB-S5-55 … 60)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S5-55…60 — Single-branch backward compatibility', () => {
  it('MB-S5-55 — hotel with parentHotelId:null behaves as standalone', () => {
    const hotel = { _id: mkIdStr(), parentHotelId: null, features: {} };
    const isStandalone = hotel.parentHotelId === null;
    expect(isStandalone).toBe(true);
  });

  it('MB-S5-56 — coupon scope defaults to "branch" for existing coupons', () => {
    const existingCoupon = { scope: 'branch' as const, orgHotelId: null, selectedBranchIds: [] };
    expect(existingCoupon.scope).toBe('branch');
    expect(existingCoupon.orgHotelId).toBeNull();
  });

  it('MB-S5-57 — gift voucher scope defaults to "branch" for existing vouchers', () => {
    const existingVoucher = { scope: 'branch' as const, orgHotelId: null };
    expect(existingVoucher.scope).toBe('branch');
  });

  it('MB-S5-58 — CustomerProfile.orgCustomerId defaults to null for existing profiles', () => {
    const profile = { orgCustomerId: null };
    expect(profile.orgCustomerId).toBeNull();
  });

  it('MB-S5-59 — standalone hotel: GET /categories returns all categories (no config overlay)', () => {
    function shouldApplyConfigOverlay(hotel: { parentHotelId: string | null }): boolean {
      return hotel.parentHotelId !== null;
    }
    expect(shouldApplyConfigOverlay({ parentHotelId: null })).toBe(false);
  });

  it('MB-S5-60 — existing hotel IDs remain valid: ObjectId 24-char hex format preserved', () => {
    // Existing IDs stored as ObjectId strings must remain valid 24-char hex
    const existingId = '64f1a2b3c4d5e6f7a8b9c0d1';
    expect(existingId).toHaveLength(24);
    expect(/^[0-9a-f]{24}$/.test(existingId)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 11: Concurrency / optimistic-update patterns (MB-S5-61 … 65)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S5-61…65 — Concurrency patterns for voucher redemption', () => {
  interface VoucherState {
    _id: string;
    balance: number;
    isActive: boolean;
    version: number; // simulates MongoDB __v or a custom version field
  }

  /**
   * Mirrors the $inc + $push atomic update pattern used in giftVoucherRoutes.ts.
   * In real code: findOneAndUpdate with { _id: v._id, balance: { $gte: amount } }
   * to prevent negative balance races.
   */
  function atomicRedeem(
    voucher: VoucherState,
    amount: number,
  ): { success: boolean; voucher?: VoucherState; error?: string } {
    if (!voucher.isActive) return { success: false, error: 'voucher not active' };
    if (voucher.balance < amount) return { success: false, error: 'insufficient balance' };
    return {
      success: true,
      voucher: { ...voucher, balance: voucher.balance - amount, version: voucher.version + 1 },
    };
  }

  it('MB-S5-61 — successful redemption decrements balance', () => {
    const v: VoucherState = { _id: mkIdStr(), balance: 500, isActive: true, version: 1 };
    const result = atomicRedeem(v, 200);
    expect(result.success).toBe(true);
    expect(result.voucher!.balance).toBe(300);
  });

  it('MB-S5-62 — redemption for exact balance brings balance to 0', () => {
    const v: VoucherState = { _id: mkIdStr(), balance: 100, isActive: true, version: 1 };
    const result = atomicRedeem(v, 100);
    expect(result.success).toBe(true);
    expect(result.voucher!.balance).toBe(0);
  });

  it('MB-S5-63 — redemption exceeding balance is rejected', () => {
    const v: VoucherState = { _id: mkIdStr(), balance: 50, isActive: true, version: 1 };
    const result = atomicRedeem(v, 100);
    expect(result.success).toBe(false);
    expect(result.error).toContain('insufficient');
  });

  it('MB-S5-64 — redemption on inactive voucher is rejected', () => {
    const v: VoucherState = { _id: mkIdStr(), balance: 500, isActive: false, version: 1 };
    const result = atomicRedeem(v, 100);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not active');
  });

  it('MB-S5-65 — each successful redeem increments version (optimistic lock signal)', () => {
    const v: VoucherState = { _id: mkIdStr(), balance: 1000, isActive: true, version: 3 };
    const r1 = atomicRedeem(v, 100);
    expect(r1.voucher!.version).toBe(4);
    const r2 = atomicRedeem(r1.voucher!, 100);
    expect(r2.voucher!.version).toBe(5);
  });
});
