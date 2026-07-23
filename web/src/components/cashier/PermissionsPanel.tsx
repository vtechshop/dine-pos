import { ShieldCheck, ShieldOff, AlertTriangle } from 'lucide-react';
import { useCashierPermissions } from '../../hooks/useCashierPermissions';
import { getCashierId } from '../../utils/cashierIdentity';
import type { CashierPermissions } from '../../utils/cashierPermissions';

interface PermRow {
  key: keyof CashierPermissions;
  label: string;
  description: string;
  affects: string;
}

const PERM_ROWS: PermRow[] = [
  {
    key: 'canApplyDiscount',
    label: 'Apply Discount',
    description: 'Enter a manual discount on new orders',
    affects: 'New Order — discount field',
  },
  {
    key: 'canCancelOrder',
    label: 'Cancel Order',
    description: 'Mark a pending order as cancelled',
    affects: 'Pending Bills — cancel button',
  },
  {
    key: 'canVoidOrder',
    label: 'Void / Reprint',
    description: 'Void a paid order or reprint its receipt',
    affects: 'Pending Bills — reprint button',
  },
  {
    key: 'canAccessDrawer',
    label: 'Cash Drawer',
    description: 'View and record cash drawer movements',
    affects: 'Drawer tab',
  },
  {
    key: 'canAccessKitchen',
    label: 'Kitchen Display',
    description: 'View and manage the live kitchen order queue',
    affects: 'Kitchen tab',
  },
  {
    key: 'canManagePrinters',
    label: 'Printer Management',
    description: 'View printer status and send test prints',
    affects: 'Printers tab',
  },
  {
    key: 'canIssueRefunds',
    label: 'Issue Refunds',
    description: 'Process a refund against a completed order',
    affects: 'Pending Bills — refund action',
  },
  {
    key: 'canViewSalesData',
    label: 'View Sales Data',
    description: 'See daily sales KPIs on the dashboard',
    affects: 'Dashboard — KPI chips',
  },
];

// ── Required backend endpoints ────────────────────────────────────────────────

const BACKEND_GAPS = [
  {
    method: 'GET',
    path: '/api/cashiers/:id/permissions',
    note: 'Returns the CashierPermissions object for a specific cashier',
  },
  {
    method: 'PATCH',
    path: '/api/cashiers/:id/permissions',
    note: 'Updates permissions for a cashier (admin-only)',
  },
  {
    method: 'JWT claim',
    path: 'permissions: {...}',
    note: 'Or include permissions in the cashier JWT payload at login',
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function PermissionsPanel() {
  const perms = useCashierPermissions();
  const cashierId = getCashierId();

  const grantedCount = (Object.keys(perms) as Array<keyof CashierPermissions>)
    .filter(k => perms[k]).length;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Backend gap notice */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
        <div>
          <p className="text-xs font-semibold text-amber-800">Backend permissions API not implemented</p>
          <p className="text-[11px] text-amber-700/80 mt-1 leading-relaxed">
            All permissions are currently set to their defaults (all enabled). Fine-grained
            per-cashier permissions require backend endpoints listed below. Once the API is
            available, the <code className="bg-amber-100 px-0.5 rounded font-mono">pos_perms_{'{cashierId}'}</code> localStorage
            key will be replaced by live API data.
          </p>
        </div>
      </div>

      {/* Current permissions summary */}
      <div className="rounded-xl border border-border bg-canvas p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold text-ink/70">Current Permissions</p>
          <span className="rounded-full bg-mist px-2 py-0.5 text-[10px] font-semibold text-ink/50">
            {grantedCount}/{PERM_ROWS.length} granted
          </span>
        </div>
        {cashierId && (
          <p className="mb-3 font-mono text-[10px] text-ink/35">Cashier ID: {cashierId}</p>
        )}

        <div className="space-y-1">
          {PERM_ROWS.map(row => {
            const granted = perms[row.key];
            return (
              <div
                key={row.key}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-mist/60"
              >
                {granted ? (
                  <ShieldCheck size={15} className="shrink-0 text-emerald-500" />
                ) : (
                  <ShieldOff size={15} className="shrink-0 text-red-400" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-ink leading-tight">{row.label}</p>
                  <p className="text-[10px] text-ink/45 mt-0.5">{row.description}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                    granted
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-red-50 text-red-600 border border-red-200'
                  }`}>
                    {granted ? 'Granted' : 'Denied'}
                  </span>
                  <p className="mt-0.5 text-[9px] text-ink/30">{row.affects}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Required backend work */}
      <div className="rounded-xl border border-border bg-canvas p-4">
        <p className="mb-3 text-xs font-semibold text-ink/70">Required Backend Endpoints</p>
        <div className="space-y-2">
          {BACKEND_GAPS.map(gap => (
            <div key={gap.path} className="rounded-lg border border-border bg-mist px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded bg-ink/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-ink/60">
                  {gap.method}
                </span>
                <code className="font-mono text-[11px] text-ink/70">{gap.path}</code>
              </div>
              <p className="mt-1 text-[10px] text-ink/45">{gap.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
