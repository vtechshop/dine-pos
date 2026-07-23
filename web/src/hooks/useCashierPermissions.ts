import { useMemo } from 'react';
import { getPermissions, type CashierPermissions } from '../utils/cashierPermissions';
import { getCashierId } from '../utils/cashierIdentity';

// Returns the cashier's permissions for the current session.
// Permissions are read once on mount. They default to all-enabled
// until the backend provides per-cashier permission data.
export function useCashierPermissions(): CashierPermissions {
  return useMemo(() => getPermissions(getCashierId()), []);
}
