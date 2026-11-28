import { useEffect, useMemo, useState } from 'react';
import { getPermissions, type CashierPermissions } from '../utils/cashierPermissions';
import { getCashierId } from '../utils/cashierIdentity';
import { useAuth } from '../context/AuthContext';
import { fetchDiscountPolicy } from '../api/orders';

// Returns the POS permissions for the current session.
//
// Batch 3 (3D): the discount permission follows the SERVER policy (GET /orders/discount-policy):
// an admin may always discount; a cashier only when the hotel allows cashier discounts
// (maxCashierDiscountPercent > 0, and the server still enforces the % limit). Before, the
// permission came only from a local cache that nothing ever filled, so even admins saw
// "Not permitted" and cashiers were offered discount fields the server then refused.
// An admin session gets every POS permission.
export function useCashierPermissions(): CashierPermissions & { maxDiscountPercent: number } {
  const { role } = useAuth();
  const base = useMemo(() => getPermissions(getCashierId()), []);
  const [policy, setPolicy] = useState<{ canDiscount: boolean; maxPercent: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDiscountPolicy()
      .then(p => { if (!cancelled) setPolicy({ canDiscount: p.canDiscount, maxPercent: p.maxPercent }); })
      .catch(() => { /* offline: keep the cached / default permissions */ });
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => {
    if (role === 'admin') {
      return {
        canApplyDiscount: true, canCancelOrder: true, canVoidOrder: true, canAccessDrawer: true,
        canAccessKitchen: true, canManagePrinters: true, canIssueRefunds: true, canViewSalesData: true,
        maxDiscountPercent: 100,
      };
    }
    return {
      ...base,
      canApplyDiscount: policy ? policy.canDiscount : base.canApplyDiscount,
      maxDiscountPercent: policy ? policy.maxPercent : 0,
    };
  }, [role, base, policy]);
}
