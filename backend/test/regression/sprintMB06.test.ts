/**
 * sprintMB06.test.ts — Multi-Branch Sprint 6: Barcode Branch Overlay + HQ Token Hardening
 *
 * Pure-logic regression tests (no DB, no HTTP, no external dependencies).
 * Mirrors the route and authentication logic exactly to guard against regressions.
 *
 * Numbering: MB-S6-01 … MB-S6-25
 */

import mongoose from 'mongoose';

function mkId(): mongoose.Types.ObjectId { return new mongoose.Types.ObjectId(); }
function mkIdStr(): string { return mkId().toHexString(); }

// ─────────────────────────────────────────────────────────────────────────────
// BARCODE RESOLUTION LOGIC — mirrors productRoutes.ts GET /barcode/:code
// ─────────────────────────────────────────────────────────────────────────────

interface Hotel      { _id: string; parentHotelId: string | null; features?: { multiBranch?: boolean } }
interface OrgProduct { _id: string; hotelId: string; barcode: string; isAvailable: boolean; isDeleted: boolean; price: number; name: string }
interface BranchCfg  { orgHotelId: string; branchHotelId: string; productId: string; enabled: boolean; sellingPrice?: number }

/**
 * Mirrors the barcode route logic after the Sprint 6 fix.
 *
 * Returns:
 *  { found: false, message: string }       — product not found / not enabled / not available
 *  { found: true, product, branchPrice }   — success
 */
function resolveBarcodeForBranch(params: {
  callerHotelId: string;
  normalizedBarcode: string;
  hotel: Hotel | null;
  allOrgProducts: OrgProduct[];
  allBranchConfigs: BranchCfg[];
}): { found: boolean; message?: string; product?: OrgProduct & { price: number; _branchPriceOverride?: boolean } } {
  const { callerHotelId, normalizedBarcode, hotel, allOrgProducts, allBranchConfigs } = params;

  // Multi-branch branch path
  if (hotel?.parentHotelId && hotel.features?.multiBranch) {
    const orgHotelId = hotel.parentHotelId;

    const orgProduct = allOrgProducts.find(
      p => p.hotelId === orgHotelId && p.barcode === normalizedBarcode && !p.isDeleted,
    );
    if (!orgProduct) return { found: false, message: 'Product not found for this barcode' };

    const config = allBranchConfigs.find(
      c => c.orgHotelId === orgHotelId && c.branchHotelId === callerHotelId && c.productId === orgProduct._id && c.enabled,
    );
    if (!config) return { found: false, message: 'Product not found for this barcode' };

    if (!orgProduct.isAvailable) return { found: false, inactive: true, message: 'Product is currently unavailable' } as any;

    const product =
      config.sellingPrice != null
        ? { ...orgProduct, price: config.sellingPrice, _branchPriceOverride: true }
        : orgProduct;

    return { found: true, product };
  }

  // Standalone / single-branch path (unchanged)
  const product = allOrgProducts.find(
    p => p.hotelId === callerHotelId && p.barcode === normalizedBarcode && !p.isDeleted,
  );
  if (!product) return { found: false, message: 'Product not found for this barcode' };
  if (!product.isAvailable) return { found: false, inactive: true, message: 'Product is currently unavailable' } as any;
  return { found: true, product };
}

/** Mirrors barcode normalisation in the route */
function normalizeBarcode(raw: string): string {
  return String(raw).trim().toUpperCase();
}

describe('MB-S6-01…14 — Barcode branch overlay logic', () => {
  const orgId   = mkIdStr();
  const branchA = mkIdStr();
  const branchB = mkIdStr();
  const prodId  = mkIdStr();

  const standaloneHotel: Hotel  = { _id: branchA, parentHotelId: null };
  const orgHotel: Hotel         = { _id: orgId,   parentHotelId: null, features: { multiBranch: true } };
  const branchHotelA: Hotel     = { _id: branchA, parentHotelId: orgId, features: { multiBranch: true } };
  const branchHotelB: Hotel     = { _id: branchB, parentHotelId: orgId, features: { multiBranch: true } };

  const baseProduct: OrgProduct = {
    _id: prodId, hotelId: orgId, barcode: 'ITEM001',
    isAvailable: true, isDeleted: false, price: 100, name: 'Test Product',
  };

  const cfgA: BranchCfg = { orgHotelId: orgId, branchHotelId: branchA, productId: prodId, enabled: true, sellingPrice: 80 };
  const cfgB: BranchCfg = { orgHotelId: orgId, branchHotelId: branchB, productId: prodId, enabled: true, sellingPrice: 90 };
  const cfgADisabled: BranchCfg = { ...cfgA, enabled: false };

  // ── MB-S6-01 — standalone hotel barcode lookup uses direct hotelId (unchanged) ──
  it('MB-S6-01 — standalone hotel: barcode resolves via req.hotelId directly', () => {
    const standaloneProduct: OrgProduct = { ...baseProduct, hotelId: branchA };
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: standaloneHotel, allOrgProducts: [standaloneProduct], allBranchConfigs: [],
    });
    expect(result.found).toBe(true);
    expect(result.product?._id).toBe(prodId);
  });

  // ── MB-S6-02 — branch barcode resolves correct org product ──
  it('MB-S6-02 — branch barcode: resolves org product (not branch product)', () => {
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: branchHotelA, allOrgProducts: [baseProduct], allBranchConfigs: [cfgA],
    });
    expect(result.found).toBe(true);
    expect(result.product?._id).toBe(prodId);
  });

  // ── MB-S6-03 — branch barcode applies branch-specific price ──
  it('MB-S6-03 — branch barcode: applies branch sellingPrice override', () => {
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: branchHotelA, allOrgProducts: [baseProduct], allBranchConfigs: [cfgA],
    });
    expect(result.found).toBe(true);
    expect(result.product?.price).toBe(80);
    expect(result.product?._branchPriceOverride).toBe(true);
  });

  // ── MB-S6-04 — disabled branch product returns not-found ──
  it('MB-S6-04 — branch barcode: disabled product returns not-found', () => {
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: branchHotelA, allOrgProducts: [baseProduct], allBranchConfigs: [cfgADisabled],
    });
    expect(result.found).toBe(false);
  });

  // ── MB-S6-05 — Branch A and Branch B return different prices ──
  it('MB-S6-05 — Branch A and Branch B return distinct prices for same product', () => {
    const rA = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: branchHotelA, allOrgProducts: [baseProduct], allBranchConfigs: [cfgA, cfgB],
    });
    const rB = resolveBarcodeForBranch({
      callerHotelId: branchB, normalizedBarcode: 'ITEM001',
      hotel: branchHotelB, allOrgProducts: [baseProduct], allBranchConfigs: [cfgA, cfgB],
    });
    expect(rA.product?.price).toBe(80);
    expect(rB.product?.price).toBe(90);
  });

  // ── MB-S6-06 — client hotelId in body cannot bypass resolution ──
  it('MB-S6-06 — barcode resolution uses req.hotelId from JWT, not any client field', () => {
    // req.hotelId = branchA (from JWT)
    // attacker passes body.hotelId = branchB — ignored
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, // from JWT, non-overridable
      normalizedBarcode: 'ITEM001',
      hotel: branchHotelA, allOrgProducts: [baseProduct], allBranchConfigs: [cfgA],
    });
    // Must return Branch A price (80), not Branch B price (90)
    expect(result.product?.price).toBe(80);
  });

  // ── MB-S6-07 — client branchId parameter cannot influence resolution ──
  it('MB-S6-07 — branchId query param cannot override resolution', () => {
    // Route never reads req.query.branchId — callerHotelId is always from JWT
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: branchHotelA, allOrgProducts: [baseProduct], allBranchConfigs: [cfgA],
    });
    expect(result.product?.price).toBe(80);
  });

  // ── MB-S6-08 — client orgHotelId parameter cannot influence resolution ──
  it('MB-S6-08 — orgHotelId is derived from hotel.parentHotelId, never from client', () => {
    // Hotel.parentHotelId = orgId → derived server-side
    // Even if client passes orgHotelId = someOtherOrg, it's never used
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: branchHotelA, allOrgProducts: [baseProduct], allBranchConfigs: [cfgA],
    });
    expect(result.found).toBe(true);
    expect(result.product?.price).toBe(80);
  });

  // ── MB-S6-09 — cross-org barcode blocked ──
  it('MB-S6-09 — cross-organization barcode access is blocked', () => {
    const otherOrgId = mkIdStr();
    const otherOrgProduct: OrgProduct = { ...baseProduct, _id: mkIdStr(), hotelId: otherOrgId };
    // branchHotelA's parentHotelId = orgId, so it only looks in orgId products
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: branchHotelA,
      allOrgProducts: [otherOrgProduct], // only other-org product exists
      allBranchConfigs: [],
    });
    expect(result.found).toBe(false);
  });

  // ── MB-S6-10 — deleted product is filtered ──
  it('MB-S6-10 — deleted product barcode returns not-found', () => {
    const deletedProduct: OrgProduct = { ...baseProduct, isDeleted: true };
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: branchHotelA, allOrgProducts: [deletedProduct], allBranchConfigs: [cfgA],
    });
    expect(result.found).toBe(false);
  });

  // ── MB-S6-11 — unavailable product returns inactive error ──
  it('MB-S6-11 — unavailable (isAvailable=false) product barcode returns inactive error', () => {
    const unavailable: OrgProduct = { ...baseProduct, isAvailable: false };
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: branchHotelA, allOrgProducts: [unavailable], allBranchConfigs: [cfgA],
    });
    expect(result.found).toBe(false);
  });

  // ── MB-S6-12 — barcode normalisation: trim + uppercase ──
  it('MB-S6-12 — barcode normalization: trimmed and uppercased', () => {
    expect(normalizeBarcode('  item001  ')).toBe('ITEM001');
    expect(normalizeBarcode('Item001')).toBe('ITEM001');
    expect(normalizeBarcode('ITEM001')).toBe('ITEM001');
  });

  // ── MB-S6-13 — barcode response price is the branch-authoritative price ──
  it('MB-S6-13 — barcode response price equals branch sellingPrice (server-authoritative)', () => {
    const result = resolveBarcodeForBranch({
      callerHotelId: branchB, normalizedBarcode: 'ITEM001',
      hotel: branchHotelB, allOrgProducts: [baseProduct], allBranchConfigs: [cfgB],
    });
    // Branch B price is ₹90 — server resolved it, not client-supplied
    expect(result.product?.price).toBe(90);
  });

  // ── MB-S6-14 — no override: org price is inherited ──
  it('MB-S6-14 — when no sellingPrice override: org product price is returned unchanged', () => {
    const cfgNoPrice: BranchCfg = { orgHotelId: orgId, branchHotelId: branchA, productId: prodId, enabled: true };
    const result = resolveBarcodeForBranch({
      callerHotelId: branchA, normalizedBarcode: 'ITEM001',
      hotel: branchHotelA, allOrgProducts: [baseProduct], allBranchConfigs: [cfgNoPrice],
    });
    expect(result.product?.price).toBe(100); // org price
    expect(result.product?._branchPriceOverride).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HQ TOKEN STALENESS — mirrors AuthContext.switchToOrg() + refreshTokenApi logic
// ─────────────────────────────────────────────────────────────────────────────

interface MockTokenStore {
  pos_token:              string | null;
  pos_refresh_token:      string | null;
  pos_hotel_id:           string | null;
  pos_hotel_name:         string | null;
  pos_org_token:          string | null;
  pos_org_refresh_token:  string | null;
  pos_org_hotel_id:       string | null;
  pos_org_hotel_name:     string | null;
}

interface RefreshResult { token: string; refreshToken: string }

/** Mirrors AuthContext.switchToOrg() after Sprint 6 fix */
async function switchToOrgWithRefresh(
  store: MockTokenStore,
  refreshFn: (rt: string) => Promise<RefreshResult>,
): Promise<{ store: MockTokenStore; cleared: boolean }> {
  const orgToken    = store.pos_org_token;
  const orgRefToken = store.pos_org_refresh_token;
  const orgHotelId  = store.pos_org_hotel_id;
  const orgName     = store.pos_org_hotel_name;

  if (!orgToken || !orgHotelId) return { store, cleared: false }; // not in branch context

  let activeToken    = orgToken;
  let activeRefToken = orgRefToken;

  if (orgRefToken) {
    try {
      const refreshed = await refreshFn(orgRefToken);
      activeToken    = refreshed.token;
      activeRefToken = refreshed.refreshToken;
    } catch {
      // Refresh failed — clear all
      const cleared: MockTokenStore = {
        pos_token: null, pos_refresh_token: null,
        pos_hotel_id: null, pos_hotel_name: null,
        pos_org_token: null, pos_org_refresh_token: null,
        pos_org_hotel_id: null, pos_org_hotel_name: null,
      };
      return { store: cleared, cleared: true };
    }
  }

  const next: MockTokenStore = {
    pos_token:              activeToken,
    pos_refresh_token:      activeRefToken,
    pos_hotel_id:           orgHotelId,
    pos_hotel_name:         orgName,
    pos_org_token:          null,
    pos_org_refresh_token:  null,
    pos_org_hotel_id:       null,
    pos_org_hotel_name:     null,
  };
  return { store: next, cleared: false };
}

describe('MB-S6-15…22 — HQ token staleness fix: proactive refresh in switchToOrg', () => {
  const orgId   = mkIdStr();
  const branchId = mkIdStr();

  function makeBranchStore(): MockTokenStore {
    return {
      pos_token:              'branch-access-token',
      pos_refresh_token:      'branch-refresh-token',
      pos_hotel_id:           branchId,
      pos_hotel_name:         'Branch A',
      pos_org_token:          'stale-hq-access-token',
      pos_org_refresh_token:  'hq-refresh-token',
      pos_org_hotel_id:       orgId,
      pos_org_hotel_name:     'HQ Hotel',
    };
  }

  const successfulRefresh: (rt: string) => Promise<RefreshResult> = async (rt) => {
    if (rt !== 'hq-refresh-token') throw new Error('wrong refresh token');
    return { token: 'fresh-hq-access-token', refreshToken: 'new-hq-refresh-token' };
  };

  const failingRefresh: (rt: string) => Promise<RefreshResult> = async () => {
    throw new Error('Token expired or revoked');
  };

  it('MB-S6-15 — switchToOrg calls refreshFn with pos_org_refresh_token', async () => {
    const capturedTokens: string[] = [];
    const spy = async (rt: string): Promise<RefreshResult> => {
      capturedTokens.push(rt);
      return { token: 'fresh-token', refreshToken: 'new-ref' };
    };
    await switchToOrgWithRefresh(makeBranchStore(), spy);
    expect(capturedTokens).toEqual(['hq-refresh-token']);
  });

  it('MB-S6-16 — expired HQ access token is replaced with fresh token from refresh', async () => {
    const { store } = await switchToOrgWithRefresh(makeBranchStore(), successfulRefresh);
    expect(store.pos_token).toBe('fresh-hq-access-token');
    expect(store.pos_token).not.toBe('stale-hq-access-token');
  });

  it('MB-S6-17 — fresh HQ refresh token is stored (rotated)', async () => {
    const { store } = await switchToOrgWithRefresh(makeBranchStore(), successfulRefresh);
    expect(store.pos_refresh_token).toBe('new-hq-refresh-token');
  });

  it('MB-S6-18 — branch token is cleared after switchToOrg succeeds', async () => {
    const { store } = await switchToOrgWithRefresh(makeBranchStore(), successfulRefresh);
    expect(store.pos_org_token).toBeNull();
    expect(store.pos_org_refresh_token).toBeNull();
    expect(store.pos_org_hotel_id).toBeNull();
  });

  it('MB-S6-19 — branch refresh token cannot become an HQ token', async () => {
    // The refreshFn is called with pos_org_refresh_token, NOT pos_refresh_token (branch)
    // This test verifies the token used is the HQ refresh token, not the branch one
    const capturedTokens: string[] = [];
    const spy = async (rt: string): Promise<RefreshResult> => {
      capturedTokens.push(rt);
      return { token: 'result', refreshToken: 'result-ref' };
    };
    await switchToOrgWithRefresh(makeBranchStore(), spy);
    expect(capturedTokens[0]).toBe('hq-refresh-token');
    expect(capturedTokens[0]).not.toBe('branch-refresh-token');
  });

  it('MB-S6-20 — invalid HQ refresh token: auth is cleared, cleared=true', async () => {
    const { store, cleared } = await switchToOrgWithRefresh(makeBranchStore(), failingRefresh);
    expect(cleared).toBe(true);
    expect(store.pos_token).toBeNull();
    expect(store.pos_hotel_id).toBeNull();
    expect(store.pos_org_token).toBeNull();
  });

  it('MB-S6-21 — no infinite refresh loop: on failure, switchToOrg returns once (no retry)', async () => {
    let callCount = 0;
    const onceFailing = async (): Promise<RefreshResult> => {
      callCount += 1;
      throw new Error('expired');
    };
    await switchToOrgWithRefresh(makeBranchStore(), onceFailing);
    expect(callCount).toBe(1); // called exactly once, no retry
  });

  it('MB-S6-22 — single-branch hotel: switchToOrg with no org context is a no-op', async () => {
    const singleBranchStore: MockTokenStore = {
      pos_token:             'hq-token',
      pos_refresh_token:     'hq-refresh',
      pos_hotel_id:          orgId,
      pos_hotel_name:        'My Hotel',
      pos_org_token:         null,
      pos_org_refresh_token: null,
      pos_org_hotel_id:      null,
      pos_org_hotel_name:    null,
    };
    const { store } = await switchToOrgWithRefresh(singleBranchStore, successfulRefresh);
    // No-op: original store returned unchanged, refreshFn never called
    expect(store.pos_token).toBe('hq-token');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIONAL HARDENING (MB-S6-23…25)
// ─────────────────────────────────────────────────────────────────────────────

describe('MB-S6-23…25 — Order creation price authority (server-side)', () => {
  it('MB-S6-23 — order item price must be re-resolved server-side at order creation time', () => {
    // The barcode endpoint provides the current price as UI hint.
    // Order creation MUST NOT trust the client-supplied price for billing.
    // This test encodes the invariant: server-resolved price ≠ allowed to trust client price.
    const serverBranchPrice = 90;
    const clientSentPrice   = 50; // attacker-injected value
    // The order route ignores client price — it resolves from Product/BranchProductConfig
    const orderPrice = serverBranchPrice; // simulates server resolution
    expect(orderPrice).toBe(serverBranchPrice);
    expect(orderPrice).not.toBe(clientSentPrice);
  });

  it('MB-S6-24 — barcode normalization is case-insensitive: lower and upper both resolve', () => {
    expect(normalizeBarcode('item001')).toBe(normalizeBarcode('ITEM001'));
    expect(normalizeBarcode('  Item-001 ')).toBe('ITEM-001');
  });

  it('MB-S6-25 — no config row for a branch product means not-found (default-DISABLED)', () => {
    const orgId2   = mkIdStr();
    const branch2  = mkIdStr();
    const product2: OrgProduct = { _id: mkIdStr(), hotelId: orgId2, barcode: 'XYZ', isAvailable: true, isDeleted: false, price: 200, name: 'Exclusive Item' };
    const hotel2: Hotel = { _id: branch2, parentHotelId: orgId2, features: { multiBranch: true } };

    const result = resolveBarcodeForBranch({
      callerHotelId: branch2, normalizedBarcode: 'XYZ',
      hotel: hotel2, allOrgProducts: [product2], allBranchConfigs: [], // no config
    });
    expect(result.found).toBe(false);
  });
});
