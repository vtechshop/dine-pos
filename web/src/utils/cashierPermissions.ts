export interface CashierPermissions {
  canApplyDiscount:  boolean;
  canCancelOrder:    boolean;
  canVoidOrder:      boolean;
  canAccessDrawer:   boolean;
  canAccessKitchen:  boolean;
  canManagePrinters: boolean;
  canIssueRefunds:   boolean;
  canViewSalesData:  boolean;
}

// Deny-by-default: only the two permissions a cashier truly needs to
// operate (cancel own mistakes, view kitchen tickets) are on by default.
// Everything elevated must be explicitly granted by an admin.
export const DEFAULT_PERMISSIONS: CashierPermissions = {
  canApplyDiscount:  false,
  canCancelOrder:    true,   // basic — cashier can cancel their own mistake orders
  canVoidOrder:      false,
  canAccessDrawer:   false,
  canAccessKitchen:  true,   // basic — cashier needs to see kitchen ticket flow
  canManagePrinters: false,
  canIssueRefunds:   false,
  canViewSalesData:  false,
};

// NOTE: cashier permissions are enforced client-side only.
// Server-side enforcement for canApplyDiscount is a known gap (M9).
// Admin must audit discount usage via shift reports.

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const permKey = (cashierId: string) => `pos_perms_${cashierId}`;

interface PermissionsCacheEntry {
  perms: CashierPermissions;
  savedAt: number;
}

/** Returns true if the cached permissions for this cashier are still within the 30-minute TTL. */
export function isPermissionsCacheValid(cashierId: string): boolean {
  try {
    const raw = localStorage.getItem(permKey(cashierId));
    if (!raw) return false;
    const entry = JSON.parse(raw) as Partial<PermissionsCacheEntry>;
    if (typeof entry.savedAt !== 'number') return false;
    return Date.now() - entry.savedAt < CACHE_TTL_MS;
  } catch { return false; }
}

export function getPermissions(cashierId: string | null): CashierPermissions {
  if (!cashierId) return DEFAULT_PERMISSIONS;
  try {
    const raw = localStorage.getItem(permKey(cashierId));
    if (!raw) return DEFAULT_PERMISSIONS;
    const entry = JSON.parse(raw) as Partial<PermissionsCacheEntry>;
    // If the stored value has no savedAt it is the old format — treat as stale and evict.
    if (typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt >= CACHE_TTL_MS) {
      localStorage.removeItem(permKey(cashierId));
      return DEFAULT_PERMISSIONS;
    }
    return { ...DEFAULT_PERMISSIONS, ...entry.perms };
  } catch { return DEFAULT_PERMISSIONS; }
}

// Used by admin-facing tooling (when backend permissions API ships,
// this localStorage layer should be replaced by an API call).
export function setPermissions(cashierId: string, perms: CashierPermissions): void {
  const entry: PermissionsCacheEntry = { perms, savedAt: Date.now() };
  localStorage.setItem(permKey(cashierId), JSON.stringify(entry));
}
