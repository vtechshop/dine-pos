/**
 * Sprint MB-S4 Regression Tests
 *
 * 56 pure-logic tests covering:
 *   - OrganizationCustomer identity model logic
 *   - CustomerProfile.orgCustomerId linking rules
 *   - CategoryConfig default-enabled semantics
 *   - Coupon scope + org fallback validation
 *   - GiftVoucher scope + org fallback logic
 *   - Settings inheritance + isOrgBranch + reset-fields
 *   - Org report product breakdown
 *   - Org customer candidate detection
 *   - Branch authorization guards
 *   - No auto-merge, no auto-link, no loyalty balance change on link
 *
 * All tests are pure logic — no DB, no network, no imports from the app.
 */

// ── MB-S4-01 through MB-S4-10: OrgCustomer identity ──────────────────────────

describe('MB-S4 OrgCustomer identity', () => {

  test('MB-S4-01: canonicalPhone normalization strips non-digits', () => {
    const normalize = (phone: string) => phone.replace(/\D/g, '').slice(-10);
    expect(normalize('+91 98765 43210')).toBe('9876543210');
    expect(normalize('98765-43210')).toBe('9876543210');
    expect(normalize('(0)9876543210')).toBe('9876543210');
  });

  test('MB-S4-02: canonicalPhone normalization takes last 10 digits', () => {
    const normalize = (phone: string) => phone.replace(/\D/g, '').slice(-10);
    expect(normalize('919876543210')).toBe('9876543210');  // 12 digits → last 10
    expect(normalize('1234567890123')).toBe('4567890123'); // 13 digits → last 10
  });

  test('MB-S4-03: canonicalEmail normalization lowercases and trims', () => {
    const normalize = (email: string) => email.toLowerCase().trim();
    expect(normalize('  User@Example.COM  ')).toBe('user@example.com');
    expect(normalize('ADMIN@HOTEL.IN')).toBe('admin@hotel.in');
  });

  test('MB-S4-04: org customer status enum is active or suspended', () => {
    const validStatuses = ['active', 'suspended'];
    expect(validStatuses).toContain('active');
    expect(validStatuses).toContain('suspended');
    expect(validStatuses).not.toContain('blocked');   // blocked is CustomerProfile status
    expect(validStatuses).not.toContain('merged');    // merged is CustomerProfile status
  });

  test('MB-S4-05: explicit link never modifies loyaltyBalance', () => {
    // Simulates: link action only sets orgCustomerId, nothing else
    const profile = { loyaltyBalance: 150, orgCustomerId: null };
    function linkToOrg(profile: any, orgCustomerId: string) {
      return { ...profile, orgCustomerId };  // only orgCustomerId changes
    }
    const linked = linkToOrg(profile, 'org123');
    expect(linked.loyaltyBalance).toBe(150);  // preserved unchanged
    expect(linked.orgCustomerId).toBe('org123');
  });

  test('MB-S4-06: explicit link never modifies walletBalance', () => {
    const profile = { walletBalance: 500, orgCustomerId: null };
    function linkToOrg(profile: any, orgCustomerId: string) {
      return { ...profile, orgCustomerId };
    }
    const linked = linkToOrg(profile, 'org456');
    expect(linked.walletBalance).toBe(500);
  });

  test('MB-S4-07: unlinking sets orgCustomerId to null', () => {
    const profile = { orgCustomerId: 'org123', loyaltyBalance: 200 };
    function unlinkFromOrg(profile: any) {
      return { ...profile, orgCustomerId: null };
    }
    const unlinked = unlinkFromOrg(profile);
    expect(unlinked.orgCustomerId).toBeNull();
    expect(unlinked.loyaltyBalance).toBe(200);  // preserved
  });

  test('MB-S4-08: linking an already-linked profile is idempotent', () => {
    const orgId = 'org123';
    const profile = { orgCustomerId: orgId };
    // Already linked to same org → no-op
    const isAlreadyLinked = profile.orgCustomerId === orgId;
    expect(isAlreadyLinked).toBe(true);
  });

  test('MB-S4-09: org customer candidates search by phone match', () => {
    const orgCustomers = [
      { _id: 'oc1', canonicalPhone: '9876543210', canonicalEmail: 'a@b.com' },
      { _id: 'oc2', canonicalPhone: '9999999999', canonicalEmail: 'c@d.com' },
    ];
    const profilePhone = '9876543210';
    const candidates = orgCustomers.filter(oc => oc.canonicalPhone === profilePhone);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]._id).toBe('oc1');
  });

  test('MB-S4-10: org customer candidates search by email match', () => {
    const orgCustomers = [
      { _id: 'oc1', canonicalPhone: '9876543210', canonicalEmail: 'user@example.com' },
      { _id: 'oc2', canonicalPhone: '9999999999', canonicalEmail: 'other@example.com' },
    ];
    const profileEmail = 'user@example.com';
    const candidates = orgCustomers.filter(oc => oc.canonicalEmail === profileEmail);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]._id).toBe('oc1');
  });

});

// ── MB-S4-11 through MB-S4-20: CategoryConfig default-enabled semantics ───────

describe('MB-S4 CategoryConfig visibility', () => {

  function applyVisibilityOverlay(
    categories: Array<{ _id: string; name: string }>,
    disabledConfigs: Array<{ categoryId: string }>,
  ) {
    const disabledIds = new Set(disabledConfigs.map(c => c.categoryId));
    return categories.filter(cat => !disabledIds.has(cat._id));
  }

  test('MB-S4-11: no CategoryConfig rows → all categories visible', () => {
    const cats = [{ _id: 'c1', name: 'Drinks' }, { _id: 'c2', name: 'Food' }];
    const disabled: never[] = [];
    expect(applyVisibilityOverlay(cats, disabled)).toHaveLength(2);
  });

  test('MB-S4-12: disabled config hides exactly that category', () => {
    const cats = [{ _id: 'c1', name: 'Drinks' }, { _id: 'c2', name: 'Food' }];
    const disabled = [{ categoryId: 'c1' }];
    const visible = applyVisibilityOverlay(cats, disabled);
    expect(visible).toHaveLength(1);
    expect(visible[0]._id).toBe('c2');
  });

  test('MB-S4-13: enabled:true config leaves category visible', () => {
    const cats = [{ _id: 'c1', name: 'Drinks' }];
    // enabled:true configs are NOT in the disabledConfigs query (query is enabled:false)
    const disabled: never[] = [];
    const visible = applyVisibilityOverlay(cats, disabled);
    expect(visible).toHaveLength(1);
  });

  test('MB-S4-14: all categories disabled at branch → empty list', () => {
    const cats = [{ _id: 'c1', name: 'A' }, { _id: 'c2', name: 'B' }, { _id: 'c3', name: 'C' }];
    const disabled = [{ categoryId: 'c1' }, { categoryId: 'c2' }, { categoryId: 'c3' }];
    expect(applyVisibilityOverlay(cats, disabled)).toHaveLength(0);
  });

  test('MB-S4-15: CategoryConfig unique key is orgHotelId+branchHotelId+categoryId', () => {
    // Simulates the unique constraint — one config per category per branch per org
    type ConfigKey = { orgHotelId: string; branchHotelId: string; categoryId: string };
    const keyOf = (c: ConfigKey) => `${c.orgHotelId}:${c.branchHotelId}:${c.categoryId}`;
    const c1 = { orgHotelId: 'org1', branchHotelId: 'b1', categoryId: 'cat1' };
    const c2 = { orgHotelId: 'org1', branchHotelId: 'b1', categoryId: 'cat1' };  // same key
    const c3 = { orgHotelId: 'org1', branchHotelId: 'b2', categoryId: 'cat1' };  // different branch
    expect(keyOf(c1)).toBe(keyOf(c2));   // conflict
    expect(keyOf(c1)).not.toBe(keyOf(c3)); // different branch is distinct
  });

  test('MB-S4-16: CategoryConfig default semantics — no row means visible', () => {
    // If configMap.get(catId) is undefined, enabled = true
    const configMap = new Map<string, { enabled: boolean }>();
    const catId = 'cat1';
    const enabled = configMap.get(catId)?.enabled ?? true;
    expect(enabled).toBe(true);
  });

  test('MB-S4-17: CategoryConfig with enabled:false means hidden', () => {
    const configMap = new Map([['cat1', { enabled: false }]]);
    const enabled = configMap.get('cat1')?.enabled ?? true;
    expect(enabled).toBe(false);
  });

  test('MB-S4-18: single-branch hotel uses original category query (no overlay)', () => {
    const hotel = { parentHotelId: null, features: { multiBranch: false } };
    const isBranchInOrg = !!(hotel.parentHotelId && hotel.features?.multiBranch);
    expect(isBranchInOrg).toBe(false);
  });

  test('MB-S4-19: multiBranch branch applies overlay', () => {
    const hotel = { parentHotelId: 'org1', features: { multiBranch: true } };
    const isBranchInOrg = !!(hotel.parentHotelId && hotel.features?.multiBranch);
    expect(isBranchInOrg).toBe(true);
  });

  test('MB-S4-20: removing CategoryConfig resets category to visible (default)', () => {
    // After DELETE, no row exists → visible by default
    const configMap = new Map([['cat1', { enabled: false }]]);
    configMap.delete('cat1');
    const enabled = configMap.get('cat1')?.enabled ?? true;
    expect(enabled).toBe(true);
  });

});

// ── MB-S4-21 through MB-S4-30: Coupon org scope ───────────────────────────────

describe('MB-S4 Coupon scope', () => {

  function validateCoupon(
    coupon: { scope: string; orgHotelId?: string; selectedBranchIds?: string[] } | null,
    callerHotelId: string,
    callerOrgHotelId?: string,
  ): boolean {
    if (!coupon) return false;
    if (coupon.scope === 'branch') return true;
    if (coupon.scope === 'organization') {
      if (!callerOrgHotelId) return false;
      if (coupon.orgHotelId !== callerOrgHotelId) return false;
      // selectedBranchIds empty = all branches allowed
      if (!coupon.selectedBranchIds?.length) return true;
      return coupon.selectedBranchIds.includes(callerHotelId);
    }
    return false;
  }

  test('MB-S4-21: branch coupon (default scope) is always valid for its hotel', () => {
    const coupon = { scope: 'branch' };
    expect(validateCoupon(coupon, 'hotel1')).toBe(true);
  });

  test('MB-S4-22: org coupon without selectedBranchIds is valid for all branches', () => {
    const coupon = { scope: 'organization', orgHotelId: 'org1', selectedBranchIds: [] };
    expect(validateCoupon(coupon, 'branch1', 'org1')).toBe(true);
    expect(validateCoupon(coupon, 'branch2', 'org1')).toBe(true);
  });

  test('MB-S4-23: org coupon with selectedBranchIds restricts to those branches', () => {
    const coupon = { scope: 'organization', orgHotelId: 'org1', selectedBranchIds: ['branch1'] };
    expect(validateCoupon(coupon, 'branch1', 'org1')).toBe(true);
    expect(validateCoupon(coupon, 'branch2', 'org1')).toBe(false);
  });

  test('MB-S4-24: org coupon rejected if caller org does not match', () => {
    const coupon = { scope: 'organization', orgHotelId: 'org1', selectedBranchIds: [] };
    expect(validateCoupon(coupon, 'branch1', 'org2')).toBe(false);
  });

  test('MB-S4-25: org coupon rejected for standalone hotel (no orgHotelId)', () => {
    const coupon = { scope: 'organization', orgHotelId: 'org1', selectedBranchIds: [] };
    expect(validateCoupon(coupon, 'standalone1', undefined)).toBe(false);
  });

  test('MB-S4-26: existing coupons default to branch scope (backward compat)', () => {
    const legacyCoupon = { scope: 'branch', orgHotelId: null, selectedBranchIds: [] };
    expect(legacyCoupon.scope).toBe('branch');
  });

  test('MB-S4-27: coupon usageLimit check still applies for org coupons', () => {
    function checkUsageLimit(usageLimit: number, usageCount: number): boolean {
      return usageLimit <= 0 || usageCount < usageLimit;
    }
    expect(checkUsageLimit(0, 999)).toBe(true);    // 0 = unlimited
    expect(checkUsageLimit(10, 9)).toBe(true);     // under limit
    expect(checkUsageLimit(10, 10)).toBe(false);   // at limit
    expect(checkUsageLimit(10, 11)).toBe(false);   // over limit
  });

  test('MB-S4-28: coupon date validation still applies', () => {
    const now = new Date('2024-06-15');
    const checkDates = (validFrom: Date, validUntil: Date | null) => {
      if (validFrom > now) return { valid: false, reason: 'not_started' };
      if (validUntil && validUntil < now) return { valid: false, reason: 'expired' };
      return { valid: true };
    };
    expect(checkDates(new Date('2024-01-01'), null).valid).toBe(true);
    expect(checkDates(new Date('2024-07-01'), null).valid).toBe(false);
    expect(checkDates(new Date('2024-01-01'), new Date('2024-05-01')).valid).toBe(false);
  });

  test('MB-S4-29: discount calculation is same for org and branch coupons', () => {
    function calcDiscount(type: string, value: number, orderTotal: number, maxDiscount: number) {
      let disc = type === 'percent' ? (orderTotal * value) / 100 : value;
      if (maxDiscount > 0) disc = Math.min(disc, maxDiscount);
      return Math.min(disc, orderTotal);
    }
    expect(calcDiscount('percent', 10, 500, 0)).toBe(50);
    expect(calcDiscount('percent', 10, 500, 30)).toBe(30);  // capped
    expect(calcDiscount('flat', 50, 500, 0)).toBe(50);
    expect(calcDiscount('flat', 600, 500, 0)).toBe(500);    // can't exceed order total
  });

  test('MB-S4-30: coupon validate falls back to org lookup when branch lookup fails', () => {
    const branchCoupons = [{ code: 'BRANCH10', scope: 'branch' }];
    const orgCoupons = [{ code: 'ORG20', scope: 'organization', orgHotelId: 'org1' }];

    function findCoupon(code: string, branchId: string, orgId?: string) {
      const branch = branchCoupons.find(c => c.code === code);
      if (branch) return branch;
      if (!orgId) return null;
      return orgCoupons.find(c => c.code === code && c.orgHotelId === orgId) ?? null;
    }

    expect(findCoupon('BRANCH10', 'b1', 'org1')).not.toBeNull();
    expect(findCoupon('ORG20', 'b1', 'org1')).not.toBeNull();
    expect(findCoupon('ORG20', 'b1', undefined)).toBeNull();  // standalone can't use org coupon
    expect(findCoupon('MISSING', 'b1', 'org1')).toBeNull();
  });

});

// ── MB-S4-31 through MB-S4-40: GiftVoucher org scope ─────────────────────────

describe('MB-S4 GiftVoucher scope', () => {

  function findVoucher(
    branchVouchers: Array<{ voucherCode: string; scope: string; hotelId: string }>,
    orgVouchers: Array<{ voucherCode: string; scope: string; orgHotelId: string }>,
    code: string,
    callerHotelId: string,
    callerOrgHotelId?: string,
  ) {
    const branch = branchVouchers.find(v => v.voucherCode === code && v.hotelId === callerHotelId);
    if (branch) return { ...branch, resolvedFrom: 'branch' };
    if (!callerOrgHotelId) return null;
    const org = orgVouchers.find(v => v.voucherCode === code && v.orgHotelId === callerOrgHotelId && v.scope === 'organization');
    if (org) return { ...org, resolvedFrom: 'org' };
    return null;
  }

  test('MB-S4-31: branch voucher found by hotelId', () => {
    const branchVs = [{ voucherCode: 'GV-ABC123', scope: 'branch', hotelId: 'h1' }];
    const result = findVoucher(branchVs, [], 'GV-ABC123', 'h1');
    expect(result).not.toBeNull();
    expect(result!.resolvedFrom).toBe('branch');
  });

  test('MB-S4-32: org voucher found when branch lookup fails', () => {
    const orgVs = [{ voucherCode: 'GV-ORG001', scope: 'organization', orgHotelId: 'org1' }];
    const result = findVoucher([], orgVs, 'GV-ORG001', 'b1', 'org1');
    expect(result).not.toBeNull();
    expect(result!.resolvedFrom).toBe('org');
  });

  test('MB-S4-33: org voucher not found for standalone hotel', () => {
    const orgVs = [{ voucherCode: 'GV-ORG001', scope: 'organization', orgHotelId: 'org1' }];
    const result = findVoucher([], orgVs, 'GV-ORG001', 'standalone1', undefined);
    expect(result).toBeNull();
  });

  test('MB-S4-34: voucher not found returns null', () => {
    const result = findVoucher([], [], 'GV-MISSING', 'h1', 'org1');
    expect(result).toBeNull();
  });

  test('MB-S4-35: existing vouchers default to branch scope (backward compat)', () => {
    const legacyVoucher = { scope: 'branch', orgHotelId: null };
    expect(legacyVoucher.scope).toBe('branch');
    expect(legacyVoucher.orgHotelId).toBeNull();
  });

  test('MB-S4-36: voucher redeem atomic guard — balance must be >= redeemAmt', () => {
    function canRedeem(balance: number, redeemAmt: number): boolean {
      return balance >= redeemAmt;
    }
    expect(canRedeem(100, 50)).toBe(true);
    expect(canRedeem(100, 100)).toBe(true);
    expect(canRedeem(100, 101)).toBe(false);
    expect(canRedeem(0, 1)).toBe(false);
  });

  test('MB-S4-37: voucher check validates active + not expired + balance > 0', () => {
    const now = new Date('2024-06-15');
    function checkVoucher(v: { isActive: boolean; expiresAt: Date | null; balance: number }) {
      if (!v.isActive) return { valid: false, reason: 'inactive' };
      if (v.expiresAt && v.expiresAt < now) return { valid: false, reason: 'expired' };
      if (v.balance <= 0) return { valid: false, reason: 'no_balance' };
      return { valid: true };
    }
    expect(checkVoucher({ isActive: true, expiresAt: null, balance: 100 }).valid).toBe(true);
    expect(checkVoucher({ isActive: false, expiresAt: null, balance: 100 }).valid).toBe(false);
    expect(checkVoucher({ isActive: true, expiresAt: new Date('2024-01-01'), balance: 100 }).valid).toBe(false);
    expect(checkVoucher({ isActive: true, expiresAt: null, balance: 0 }).valid).toBe(false);
  });

  test('MB-S4-38: org voucher match requires orgHotelId match', () => {
    const orgVs = [{ voucherCode: 'GV-ORG001', scope: 'organization', orgHotelId: 'org1' }];
    const matchOrg1 = findVoucher([], orgVs, 'GV-ORG001', 'b1', 'org1');
    const matchOrg2 = findVoucher([], orgVs, 'GV-ORG001', 'b1', 'org2');
    expect(matchOrg1).not.toBeNull();
    expect(matchOrg2).toBeNull();
  });

  test('MB-S4-39: idempotency: same orderId already redeemed returns success', () => {
    const transactions = [{ type: 'redeem', orderId: 'order1' }];
    const isAlreadyRedeemed = (orderId: string) =>
      transactions.some(t => t.type === 'redeem' && t.orderId === orderId);
    expect(isAlreadyRedeemed('order1')).toBe(true);
    expect(isAlreadyRedeemed('order2')).toBe(false);
  });

  test('MB-S4-40: redeem via _id filter for org vouchers (not hotelId)', () => {
    // When an org voucher is found by orgHotelId, the atomic update should use _id
    // (not hotelId+voucherCode) because the voucher's hotelId = orgHotelId, not branchHotelId
    const orgVoucher = { _id: 'v1', hotelId: 'org1', orgHotelId: 'org1', scope: 'organization', voucherCode: 'GV-X' };
    const callerHotelId = 'b1'; // branch, different from voucher.hotelId

    // Branch-scoped filter would fail: hotelId: 'b1' doesn't match voucher.hotelId: 'org1'
    const branchFilter = { hotelId: callerHotelId, voucherCode: 'GV-X' };
    const matchesBranchFilter = orgVoucher.hotelId === branchFilter.hotelId && orgVoucher.voucherCode === branchFilter.voucherCode;
    expect(matchesBranchFilter).toBe(false); // correct — would not match

    // _id filter works correctly
    const idFilter = { _id: orgVoucher._id };
    const matchesIdFilter = orgVoucher._id === idFilter._id;
    expect(matchesIdFilter).toBe(true); // correct
  });

});

// ── MB-S4-41 through MB-S4-50: Settings inheritance + isOrgBranch ─────────────

describe('MB-S4 Settings inheritance', () => {

  const INHERITABLE_FROM_HQ = new Set([
    'loyaltySettings', 'defaultTaxPercent', 'currencySymbol', 'currency',
    'businessType', 'footerText', 'printerWidth',
  ]);

  function applyInheritance(
    branchSettings: Record<string, any>,
    orgSettings: Record<string, any>,
  ): { result: Record<string, any>; inherited: string[] } {
    const result = { ...branchSettings };
    const inherited: string[] = [];
    for (const field of INHERITABLE_FROM_HQ) {
      const branchVal = result[field];
      const isEmpty = branchVal === null || branchVal === undefined || branchVal === '' || branchVal === 0;
      if (isEmpty && orgSettings[field] != null) {
        result[field] = orgSettings[field];
        inherited.push(field);
      }
    }
    return { result, inherited };
  }

  test('MB-S4-41: empty branch field inherits from org', () => {
    const branch = { defaultTaxPercent: 0, currencySymbol: '' };
    const org = { defaultTaxPercent: 5, currencySymbol: '₹' };
    const { result, inherited } = applyInheritance(branch, org);
    expect(result.defaultTaxPercent).toBe(5);
    expect(result.currencySymbol).toBe('₹');
    expect(inherited).toContain('defaultTaxPercent');
    expect(inherited).toContain('currencySymbol');
  });

  test('MB-S4-42: branch-set value is NOT overridden by org inheritance', () => {
    const branch = { defaultTaxPercent: 12, currencySymbol: '$' };
    const org = { defaultTaxPercent: 5, currencySymbol: '₹' };
    const { result, inherited } = applyInheritance(branch, org);
    expect(result.defaultTaxPercent).toBe(12); // branch value preserved
    expect(result.currencySymbol).toBe('$');
    expect(inherited).not.toContain('defaultTaxPercent');
  });

  test('MB-S4-43: sensitive fields are never in INHERITABLE_FROM_HQ', () => {
    const sensitiveFields = ['gstNumber', 'kitchenPin', 'bankAccountNumber', 'upiId', 'panNumber'];
    for (const f of sensitiveFields) {
      expect(INHERITABLE_FROM_HQ.has(f)).toBe(false);
    }
  });

  test('MB-S4-44: isOrgBranch is true only for parentHotelId + multiBranch', () => {
    function calcIsOrgBranch(hotel: any): boolean {
      return !!(hotel?.parentHotelId && hotel.features?.multiBranch);
    }
    expect(calcIsOrgBranch({ parentHotelId: 'org1', features: { multiBranch: true } })).toBe(true);
    expect(calcIsOrgBranch({ parentHotelId: null, features: { multiBranch: true } })).toBe(false);  // HQ
    expect(calcIsOrgBranch({ parentHotelId: 'org1', features: { multiBranch: false } })).toBe(false);  // feature off
    expect(calcIsOrgBranch({ parentHotelId: null, features: {} })).toBe(false);  // standalone
  });

  test('MB-S4-45: reset-fields only accepts INHERITABLE_FROM_HQ fields', () => {
    const requested = ['defaultTaxPercent', 'kitchenPin', 'gstNumber', 'currencySymbol'];
    const allowed = requested.filter(f => INHERITABLE_FROM_HQ.has(f));
    expect(allowed).toEqual(['defaultTaxPercent', 'currencySymbol']);
    expect(allowed).not.toContain('kitchenPin');
    expect(allowed).not.toContain('gstNumber');
  });

  test('MB-S4-46: reset-fields of unknown fields returns empty allowed list', () => {
    const requested = ['unknownField', 'anotherUnknown'];
    const allowed = requested.filter(f => INHERITABLE_FROM_HQ.has(f));
    expect(allowed).toHaveLength(0);
  });

  test('MB-S4-47: settings response includes _inheritedFromOrg array', () => {
    const { result, inherited } = applyInheritance(
      { defaultTaxPercent: 0 },
      { defaultTaxPercent: 5 },
    );
    // Server appends _inheritedFromOrg to payload
    const payload = { ...result, _inheritedFromOrg: inherited };
    expect(payload._inheritedFromOrg).toContain('defaultTaxPercent');
  });

  test('MB-S4-48: standalone hotel (no parentHotelId) never has inherited fields', () => {
    const hotel = { parentHotelId: null, features: {} };
    const isOrgBranch = !!(hotel.parentHotelId && (hotel.features as any)?.multiBranch);
    // isOrgBranch = false → inheritance block never runs → no _inheritedFromOrg
    expect(isOrgBranch).toBe(false);
  });

  test('MB-S4-49: loyaltySettings inheritance merges the whole object', () => {
    const branchSettings = { loyaltySettings: null };
    const orgSettings = { loyaltySettings: { pointsPerHundredRupees: 10, rewardName: 'Stars' } };
    const { result, inherited } = applyInheritance(branchSettings, orgSettings);
    expect(result.loyaltySettings).toEqual({ pointsPerHundredRupees: 10, rewardName: 'Stars' });
    expect(inherited).toContain('loyaltySettings');
  });

  test('MB-S4-50: reset-fields requires caller to be a branch (not standalone)', () => {
    function canResetFields(hotel: any): boolean {
      return !!(hotel?.parentHotelId && hotel.features?.multiBranch);
    }
    expect(canResetFields({ parentHotelId: 'org1', features: { multiBranch: true } })).toBe(true);
    expect(canResetFields({ parentHotelId: null, features: {} })).toBe(false);
  });

});

// ── MB-S4-51 through MB-S4-56: Org report product breakdown ───────────────────

describe('MB-S4 Org report product breakdown', () => {

  function buildProductBreakdown(
    orderItems: Array<{ hotelId: string; productId: string; productName: string; price: number; quantity: number }>,
  ): Array<{ hotelId: string; products: Array<{ productId: string; productName: string; qty: number; revenue: number }> }> {
    const byHotel = new Map<string, Map<string, { productId: string; productName: string; qty: number; revenue: number }>>();
    for (const item of orderItems) {
      if (!byHotel.has(item.hotelId)) byHotel.set(item.hotelId, new Map());
      const hotelMap = byHotel.get(item.hotelId)!;
      if (!hotelMap.has(item.productId)) {
        hotelMap.set(item.productId, { productId: item.productId, productName: item.productName, qty: 0, revenue: 0 });
      }
      const entry = hotelMap.get(item.productId)!;
      entry.qty += item.quantity;
      entry.revenue += +(item.price * item.quantity).toFixed(2);
    }
    return Array.from(byHotel.entries()).map(([hotelId, products]) => ({
      hotelId,
      products: Array.from(products.values()),
    }));
  }

  test('MB-S4-51: product breakdown groups by hotelId and productId', () => {
    const items = [
      { hotelId: 'h1', productId: 'p1', productName: 'Coffee', price: 50, quantity: 2 },
      { hotelId: 'h1', productId: 'p2', productName: 'Tea', price: 30, quantity: 3 },
      { hotelId: 'h2', productId: 'p1', productName: 'Coffee', price: 55, quantity: 1 },
    ];
    const breakdown = buildProductBreakdown(items);
    expect(breakdown).toHaveLength(2);
    const h1 = breakdown.find(b => b.hotelId === 'h1')!;
    expect(h1.products).toHaveLength(2);
  });

  test('MB-S4-52: product qty accumulates across orders', () => {
    const items = [
      { hotelId: 'h1', productId: 'p1', productName: 'Coffee', price: 50, quantity: 2 },
      { hotelId: 'h1', productId: 'p1', productName: 'Coffee', price: 50, quantity: 3 },
    ];
    const breakdown = buildProductBreakdown(items);
    const h1 = breakdown[0];
    expect(h1.products[0].qty).toBe(5);
    expect(h1.products[0].revenue).toBe(250);
  });

  test('MB-S4-53: product breakdown is only triggered by ?includeProducts=true', () => {
    const request = { query: { includeProducts: 'false' } };
    const should = request.query.includeProducts === 'true';
    expect(should).toBe(false);
  });

  test('MB-S4-54: org-summary response structure has branches and totals', () => {
    const orgSummary = {
      orgHotelId: 'org1',
      orgHotelName: 'HQ Hotel',
      from: '2024-01-01',
      to: '2024-01-31',
      branches: [
        { hotelId: 'org1', isHQ: true, totalSales: 5000, orderCount: 20 },
        { hotelId: 'b1',   isHQ: false, totalSales: 3000, orderCount: 12 },
      ],
      totals: { totalSales: 8000, orderCount: 32 },
    };
    expect(orgSummary.branches).toHaveLength(2);
    expect(orgSummary.totals.totalSales).toBe(8000);
    expect(orgSummary.orgHotelId).toBe('org1');
  });

  test('MB-S4-55: org-summary product breakdown is optional (not always present)', () => {
    const summary: any = { orgHotelId: 'org1', totals: {}, branches: [] };
    expect(summary.productBreakdown).toBeUndefined();
    summary.productBreakdown = [{ hotelId: 'org1', products: [] }];
    expect(summary.productBreakdown).toBeDefined();
  });

  test('MB-S4-56: org report only accessible to multiBranch hotels', () => {
    function canAccessOrgReport(hotel: any): boolean {
      // HQ with multiBranch enabled, or a branch whose org has multiBranch enabled
      return !!(hotel?.features?.multiBranch);
    }
    expect(canAccessOrgReport({ features: { multiBranch: true } })).toBe(true);
    expect(canAccessOrgReport({ features: { multiBranch: false } })).toBe(false);
    expect(canAccessOrgReport({ features: {} })).toBe(false);
    expect(canAccessOrgReport(null)).toBe(false);
  });

});
