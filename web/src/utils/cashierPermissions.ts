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

// All permissions on by default — preserves existing behaviour until
// the backend provides per-cashier permission data.
export const DEFAULT_PERMISSIONS: CashierPermissions = {
  canApplyDiscount:  true,
  canCancelOrder:    true,
  canVoidOrder:      true,
  canAccessDrawer:   true,
  canAccessKitchen:  true,
  canManagePrinters: true,
  canIssueRefunds:   true,
  canViewSalesData:  true,
};

const permKey = (cashierId: string) => `pos_perms_${cashierId}`;

export function getPermissions(cashierId: string | null): CashierPermissions {
  if (!cashierId) return DEFAULT_PERMISSIONS;
  try {
    const raw = localStorage.getItem(permKey(cashierId));
    if (!raw) return DEFAULT_PERMISSIONS;
    return { ...DEFAULT_PERMISSIONS, ...(JSON.parse(raw) as Partial<CashierPermissions>) };
  } catch { return DEFAULT_PERMISSIONS; }
}

// Used by admin-facing tooling (when backend permissions API ships,
// this localStorage layer should be replaced by an API call).
export function setPermissions(cashierId: string, perms: CashierPermissions): void {
  localStorage.setItem(permKey(cashierId), JSON.stringify(perms));
}
