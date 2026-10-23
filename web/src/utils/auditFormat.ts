// Plain-language rendering for audit log entries. Backend action codes look
// like "cashier.toggled" or "aggregator.order.accept"; owners shouldn't have
// to read those.

type Meta = Record<string, unknown> | undefined;

const SUBJECTS: Record<string, string> = {
  po:                'purchase order',
  grn:               'goods receipt (GRN)',
  purchaseinvoice:   'purchase invoice',
  giftvoucher:       'gift voucher',
  ai_menu:           'AI menu',
  org_customer:      'customer',
  vendor_ledger:     'vendor ledger',
  vendor_payment:    'vendor payment',
  vendor_return:     'vendor return',
  whatsapp_receipts: 'WhatsApp receipts',
  remote_config:     'app config',
  superadmin:        'super admin',
  auto_sync:         'auto-sync',
};

const VERBS: Record<string, string> = {
  create: 'added',        created: 'added',     add: 'added',        added: 'added',
  update: 'updated',      updated: 'updated',
  delete: 'deleted',      deleted: 'deleted',
  cancel: 'cancelled',    accept: 'accepted',   reject: 'rejected',  dispatch: 'dispatched',
  ready: 'marked ready',  sync: 'synced',       test: 'tested',      disconnect: 'disconnected',
  retry: 'retried',       issue: 'issued',      redeem: 'redeemed',  topup: 'topped up',
  deduct: 'deducted',     refund: 'refunded',   deactivate: 'deactivated', reactivate: 'reactivated',
  link: 'linked',         unlink: 'unlinked',   verify: 'verified',  paid: 'marked paid',
  extract: 'extracted',   import: 'imported',   config: 'settings changed',
  pin_reset: 'PIN reset', availability: 'availability changed',
  bulk_availability: 'availability changed (bulk)',
  config_changed: 'settings changed', manual_retry: 'resent manually', test_sent: 'test sent',
  status_changed: 'status changed',   payment_updated: 'payment updated',
  opening_balance: 'opening balance set', reset_fields: 'fields reset',
};

const words = (s: string) => SUBJECTS[s] ?? s.replace(/_/g, ' ');
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "cashier.toggled" + {isActive:true} → "Cashier activated" */
export function humanizeAction(action: string, meta: Meta): string {
  const parts = action.split('.');

  // On/off toggles: the direction lives in metadata.
  if (parts[parts.length - 1] === 'toggled') {
    const subject = parts.slice(0, -1).map(words).join(' ');
    const dir = meta?.isActive === true ? 'activated' : meta?.isActive === false ? 'deactivated' : 'toggled';
    return capitalise(`${subject} ${dir}`);
  }

  // "login.success" / "cashier.login.failure"
  const loginIdx = parts.indexOf('login');
  if (loginIdx !== -1 && loginIdx === parts.length - 2) {
    const who = parts.slice(0, loginIdx).map(words).join(' ') || 'admin';
    return capitalise(parts[parts.length - 1] === 'success' ? `${who} logged in` : `${who} login failed`);
  }

  const verb    = parts[parts.length - 1];
  const subject = parts.slice(0, -1).map(words).join(' ');
  return capitalise(`${subject} ${VERBS[verb] ?? verb.replace(/_/g, ' ')}`.trim());
}

const FIELD_LABELS: Record<string, string> = {
  isActive:     'Active',
  employeeCode: 'Employee code',
  updated:      'Changed fields',
  changes:      'Changes',
};

/** "isActive" → "Active", "grandTotal" → "Grand total" */
export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return capitalise(spaced);
}

/** Booleans → Yes/No, arrays → comma list, objects → "Label: value; …" */
export function formatValue(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(x => (typeof x === 'object' ? formatValue(x) : fieldLabelIfKey(x))).join(', ');
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${fieldLabel(k)}: ${formatValue(x)}`)
      .join('; ');
  }
  return String(v);
}

// "updated: ['name','mobile']" lists field keys — show them as labels too.
function fieldLabelIfKey(x: unknown): string {
  return typeof x === 'string' && /^[a-z][a-zA-Z_]*$/.test(x) ? fieldLabel(x) : String(x);
}

const HIDDEN = new Set(['hotelId', '_id', 'createdAt', 'updatedAt', '__v']);

/** Readable [label, value] rows for the expanded view. */
export function metaEntries(meta: Meta): Array<[string, string]> {
  if (!meta) return [];
  return Object.entries(meta)
    .filter(([k, v]) => !HIDDEN.has(k) && v != null)
    .map(([k, v]) => [fieldLabel(k), formatValue(v)]);
}
