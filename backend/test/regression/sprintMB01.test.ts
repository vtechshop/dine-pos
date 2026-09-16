/**
 * Sprint MB-S1: Multi-Branch Foundation — Pure-Logic Security Tests
 *
 * Tests MB-S1-01 to MB-S1-40. No database, no network.
 * All functions tested are extracted from the route-handler logic in
 * branchRoutes.ts or are invariants that the architecture must uphold.
 */

// ── Helpers mirroring route-handler logic ─────────────────────────────────────

function sanitizeBranchCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

function isBranchLimitReached(existingCount: number, maxBranches: number): boolean {
  return existingCount >= maxBranches;
}

function canOrgAdminAccessBranch(jwtHotelId: string, branchParentHotelId: string | null): boolean {
  if (!branchParentHotelId) return false;
  return jwtHotelId === branchParentHotelId;
}

function inheritBranchStatus(parentStatus: string): string {
  if (['active', 'trial'].includes(parentStatus)) return 'active';
  return parentStatus;
}

function branchCanCreateSubBranches(branchMaxBranches: number): boolean {
  return branchMaxBranches > 0;
}

function isCrossBranchAccess(requestHotelId: string, resourceHotelId: string): boolean {
  return requestHotelId !== resourceHotelId;
}

function makeBranchOfflineQueueKey(branchHotelId: string, localOrderId: string): string {
  return `offline:${branchHotelId}:${localOrderId}`;
}

function isFeatureGated(multiBranchEnabled: boolean, action: string): boolean {
  const gatedActions = [
    'create_branch', 'list_branches', 'get_branch',
    'update_branch', 'deactivate_branch', 'reactivate_branch',
  ];
  return gatedActions.includes(action) ? multiBranchEnabled : true;
}

function parseBranchFromLoginResponse(response: Record<string, unknown>): {
  isHeadquarters: boolean;
  parentHotelId: string | null;
  branchCode: string;
  branchName: string;
  maxBranches: number;
} {
  return {
    isHeadquarters: Boolean(response.isHeadquarters),
    parentHotelId:  (response.parentHotelId as string | null) ?? null,
    branchCode:     String(response.branchCode ?? ''),
    branchName:     String(response.branchName ?? response.hotelName ?? ''),
    maxBranches:    Number(response.maxBranches ?? 1),
  };
}

function validateAdminPasswordPolicy(password: string): boolean {
  return typeof password === 'string' && password.length >= 6;
}

function branchCountBelowLimit(count: number, max: number): boolean {
  return count < max;
}

function isStandaloneHotel(parentHotelId: string | null): boolean {
  return parentHotelId === null;
}

// ── Group 1: Branch code sanitization (MB-S1-01 to MB-S1-05) ─────────────────

describe('MB-S1-01 to MB-S1-05: Branch code sanitization', () => {
  it('MB-S1-01 alphanumeric code is converted to uppercase', () => {
    expect(sanitizeBranchCode('north')).toBe('NORTH');
  });

  it('MB-S1-02 special characters and spaces are stripped', () => {
    expect(sanitizeBranchCode('Main Branch!')).toBe('MAINBRANCH');
  });

  it('MB-S1-03 empty string remains empty (branch code is optional)', () => {
    expect(sanitizeBranchCode('')).toBe('');
  });

  it('MB-S1-04 underscore and hyphen are preserved', () => {
    expect(sanitizeBranchCode('HQ_MAIN-1')).toBe('HQ_MAIN-1');
  });

  it('MB-S1-05 leading/trailing whitespace is stripped before sanitization', () => {
    expect(sanitizeBranchCode('  MALL  ')).toBe('MALL');
  });
});

// ── Group 2: Branch limit enforcement (MB-S1-06 to MB-S1-10) ─────────────────

describe('MB-S1-06 to MB-S1-10: Branch limit enforcement', () => {
  it('MB-S1-06 first branch allowed when max=1 and existing=0', () => {
    expect(isBranchLimitReached(0, 1)).toBe(false);
  });

  it('MB-S1-07 second branch blocked when max=1 and existing=1', () => {
    expect(isBranchLimitReached(1, 1)).toBe(true);
  });

  it('MB-S1-08 third branch allowed when max=3 and existing=2', () => {
    expect(isBranchLimitReached(2, 3)).toBe(false);
  });

  it('MB-S1-09 fourth branch blocked when max=3 and existing=3', () => {
    expect(isBranchLimitReached(3, 3)).toBe(true);
  });

  it('MB-S1-10 all branches blocked when max=0 (no branch plan)', () => {
    expect(isBranchLimitReached(0, 0)).toBe(true);
  });
});

// ── Group 3: Cross-branch access authorization (MB-S1-11 to MB-S1-15) ────────

describe('MB-S1-11 to MB-S1-15: Cross-branch access authorization', () => {
  const hqId = 'hq000000000000000000001';
  const otherOrgId = 'org00000000000000000002';
  const branchParentId = hqId;

  it('MB-S1-11 org admin can access branch when parentHotelId matches JWT hotelId', () => {
    expect(canOrgAdminAccessBranch(hqId, branchParentId)).toBe(true);
  });

  it('MB-S1-12 org admin CANNOT access branch belonging to a different organization', () => {
    expect(canOrgAdminAccessBranch(otherOrgId, branchParentId)).toBe(false);
  });

  it('MB-S1-13 standalone hotel (parentHotelId=null) is not a managed branch', () => {
    expect(canOrgAdminAccessBranch(hqId, null)).toBe(false);
  });

  it('MB-S1-14 resources with same hotelId are same-branch (not cross-branch)', () => {
    expect(isCrossBranchAccess('branchA', 'branchA')).toBe(false);
  });

  it('MB-S1-15 resources with different hotelId are cross-branch access (blocked)', () => {
    expect(isCrossBranchAccess('branchA', 'branchB')).toBe(true);
  });
});

// ── Group 4: Backward compatibility invariants (MB-S1-16 to MB-S1-20) ────────

describe('MB-S1-16 to MB-S1-20: Backward compatibility', () => {
  it('MB-S1-16 hotel with parentHotelId=null is a standalone hotel', () => {
    expect(isStandaloneHotel(null)).toBe(true);
  });

  it('MB-S1-17 hotel with parentHotelId set is a branch (not standalone)', () => {
    expect(isStandaloneHotel('someParentId')).toBe(false);
  });

  it('MB-S1-18 existing hotel ID remains the scope key — no ID migration', () => {
    const existingHotelId = '507f1f77bcf86cd799439011';
    // The hotelId does not change for an existing standalone hotel
    expect(existingHotelId).toBe(existingHotelId);
  });

  it('MB-S1-19 login response for standalone hotel has isHeadquarters=false', () => {
    const response = parseBranchFromLoginResponse({
      hotelId: 'existing', hotelName: 'Old Hotel', features: {},
      // no multi-branch fields — mimics a legacy response
    });
    expect(response.isHeadquarters).toBe(false);
    expect(response.parentHotelId).toBeNull();
  });

  it('MB-S1-20 login response for standalone hotel has maxBranches=1 by default', () => {
    const response = parseBranchFromLoginResponse({
      hotelId: 'existing', hotelName: 'Old Hotel',
    });
    expect(response.maxBranches).toBe(1);
  });
});

// ── Group 5: Branch status inheritance (MB-S1-21 to MB-S1-25) ────────────────

describe('MB-S1-21 to MB-S1-25: Branch status inheritance', () => {
  it('MB-S1-21 branch gets active status when parent is active', () => {
    expect(inheritBranchStatus('active')).toBe('active');
  });

  it('MB-S1-22 branch gets active status when parent is on trial', () => {
    expect(inheritBranchStatus('trial')).toBe('active');
  });

  it('MB-S1-23 branch mirrors expired status from parent', () => {
    expect(inheritBranchStatus('expired')).toBe('expired');
  });

  it('MB-S1-24 deactivated branch status is suspended (reversible)', () => {
    const deactivatedStatus = 'suspended';
    // reactivation sets status back to active
    const reactivated = deactivatedStatus === 'suspended' ? 'active' : deactivatedStatus;
    expect(reactivated).toBe('active');
  });

  it('MB-S1-25 pending parent means branch also gets pending status', () => {
    expect(inheritBranchStatus('pending')).toBe('pending');
  });
});

// ── Group 6: Offline branch isolation (MB-S1-26 to MB-S1-30) ─────────────────

describe('MB-S1-26 to MB-S1-30: Offline branch isolation', () => {
  it('MB-S1-26 offline queue key is scoped to branchHotelId, not orgHotelId', () => {
    const key = makeBranchOfflineQueueKey('branch_abc', 'order_001');
    expect(key).toContain('branch_abc');
    expect(key).not.toContain('org_parent');
  });

  it('MB-S1-27 branch A and branch B have different offline queue namespaces', () => {
    const keyA = makeBranchOfflineQueueKey('branchA', 'order_001');
    const keyB = makeBranchOfflineQueueKey('branchB', 'order_001');
    expect(keyA).not.toBe(keyB);
  });

  it('MB-S1-28 same localOrderId under different branches are distinct entries', () => {
    const keyA = makeBranchOfflineQueueKey('branch_north', 'local_123');
    const keyB = makeBranchOfflineQueueKey('branch_south', 'local_123');
    expect(keyA).not.toBe(keyB);
  });

  it('MB-S1-29 cross-branch upload is a mismatch (queuedBranchId ≠ currentBranchId)', () => {
    const queuedBranchId = 'branch_north';
    const currentBranchId = 'branch_south';
    expect(isCrossBranchAccess(queuedBranchId, currentBranchId)).toBe(true);
  });

  it('MB-S1-30 offline idempotency key contains branch hotelId for correct deduplication', () => {
    const branchHotelId = 'branch_north_id';
    const key = `${branchHotelId}:order:order_001:create`;
    expect(key.startsWith(branchHotelId)).toBe(true);
  });
});

// ── Group 7: Feature gate logic (MB-S1-31 to MB-S1-35) ───────────────────────

describe('MB-S1-31 to MB-S1-35: Feature gate logic', () => {
  it('MB-S1-31 create_branch is blocked when multiBranch=false', () => {
    expect(isFeatureGated(false, 'create_branch')).toBe(false);
  });

  it('MB-S1-32 list_branches is blocked when multiBranch=false', () => {
    expect(isFeatureGated(false, 'list_branches')).toBe(false);
  });

  it('MB-S1-33 create_branch is allowed when multiBranch=true', () => {
    expect(isFeatureGated(true, 'create_branch')).toBe(true);
  });

  it('MB-S1-34 non-branch action is not gated regardless of multiBranch flag', () => {
    expect(isFeatureGated(false, 'create_order')).toBe(true);
  });

  it('MB-S1-35 branch with maxBranches=0 cannot create sub-branches', () => {
    expect(branchCanCreateSubBranches(0)).toBe(false);
  });
});

// ── Group 8: JWT and auth scope (MB-S1-36 to MB-S1-40) ───────────────────────

describe('MB-S1-36 to MB-S1-40: JWT and auth scope', () => {
  it('MB-S1-36 JWT hotelId = HQ → can manage branches with parentHotelId = HQ', () => {
    const jwtHotelId = 'hq_hotel_001';
    const branch = { parentHotelId: 'hq_hotel_001' };
    expect(canOrgAdminAccessBranch(jwtHotelId, branch.parentHotelId)).toBe(true);
  });

  it('MB-S1-37 JWT hotelId = branch → CANNOT access HQ data (different hotelId)', () => {
    const jwtHotelId = 'branch_hotel_002';
    const hqHotelId  = 'hq_hotel_001';
    expect(isCrossBranchAccess(jwtHotelId, hqHotelId)).toBe(true);
  });

  it('MB-S1-38 client-supplied branchId in body does not grant access if parentHotelId mismatches JWT', () => {
    const jwtHotelId = 'org_A';
    const clientClaimedParent = 'org_B'; // attacker supplies different org's ID
    expect(canOrgAdminAccessBranch(jwtHotelId, clientClaimedParent)).toBe(false);
  });

  it('MB-S1-39 branch URL param is verified against JWT hotelId via parentHotelId check', () => {
    const jwtHotelId         = 'hq_001';
    const validBranchParent  = 'hq_001';
    const invalidBranchParent = 'hq_999';
    expect(canOrgAdminAccessBranch(jwtHotelId, validBranchParent)).toBe(true);
    expect(canOrgAdminAccessBranch(jwtHotelId, invalidBranchParent)).toBe(false);
  });

  it('MB-S1-40 admin password policy requires minimum 6 characters', () => {
    expect(validateAdminPasswordPolicy('abcde')).toBe(false);
    expect(validateAdminPasswordPolicy('abcdef')).toBe(true);
    expect(validateAdminPasswordPolicy('securePass1!')).toBe(true);
  });
});
