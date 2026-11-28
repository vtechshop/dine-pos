import { describe, it, expect } from 'vitest';
import { bootRedirect } from '../bootRoleGuard';

const store = (o: Record<string, string>) => ({ getItem: (k: string) => o[k] ?? null });
const sa = store({ pos_role: 'superadmin', sa_token: 't' });
const waiter = store({ pos_role: 'waiter', pos_token: 't' });

describe('bootRedirect (Phase 5 · Batch 7, P4-AUTH-01/02)', () => {
  it('keeps a Super Admin session out of hotel pages', () => {
    for (const p of ['/dashboard', '/cashier', '/kitchen', '/settings', '/']) expect(bootRedirect(p, sa)).toBe('/super-admin/hotels');
    expect(bootRedirect('/super-admin/tickets', sa)).toBeNull();
    expect(bootRedirect('/login', sa)).toBeNull();
  });

  it('keeps a waiter session on Tables (and Help)', () => {
    for (const p of ['/cashier', '/kitchen', '/dashboard', '/reports']) expect(bootRedirect(p, waiter)).toBe('/tables');
    expect(bootRedirect('/tables', waiter)).toBeNull();
    expect(bootRedirect('/help', waiter)).toBeNull();
  });

  it('leaves other sessions, signed-out visitors and public pages alone', () => {
    expect(bootRedirect('/dashboard', store({ pos_role: 'admin', pos_token: 't' }))).toBeNull();
    expect(bootRedirect('/cashier', store({ pos_role: 'cashier', pos_token: 't' }))).toBeNull();
    expect(bootRedirect('/dashboard', store({ pos_role: 'superadmin' }))).toBeNull();   // no token: normal login flow
    expect(bootRedirect('/register/success', waiter)).toBeNull();
  });
});
