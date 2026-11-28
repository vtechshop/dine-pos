// Phase 5 · Batch 7 (remaining confirmed bugs) — server rules behind the browser fixes.
// The browser tests (tests/regression/b7-remaining.spec.js and the Phase 4 specs) check the
// behaviour end to end; these pin the server-side rules so they cannot quietly come back.
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import Order from '../../src/models/Order';

const src = (rel: string) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');
const route = (file: string, marker: string) => {
  const s = src(`routes/${file}`);
  const i = s.indexOf(marker);
  if (i < 0) throw new Error(`${marker} not found in ${file}`);
  return s.slice(i, s.indexOf('\nrouter.', i + marker.length));
};

describe('Batch 7: Super Admin', () => {
  it('P4-SA-04: "Activate" puts a trial hotel back on its trial, a paid hotel back to active', () => {
    const r = route('superAdminRoutes.ts', "router.put('/hotels/:id/activate'");
    expect(r).toMatch(/const restored = onTrial \? 'trial' : 'active'/);
    // merged with main: a trial that has already ended is not re-activated (or made paid)
    expect(r).toMatch(/TRIAL_ENDED/);
    expect(r).toMatch(/\{ status: restored \}/);
    expect(r).not.toMatch(/\{ status: 'active' \}, \{ new: true \}/);
  });

  it('P4-SA-06: supplyChain, tally and multiBranch can be switched', () => {
    const r = route('superAdminRoutes.ts', "router.put('/hotels/:id/features'");
    for (const f of ['supplyChain', 'tally', 'multiBranch']) expect(r).toContain(`'${f}'`);
  });

  it('P4-SA-08: a lead timeline entry is added only when the status really changes', () => {
    const r = route('superAdminRoutes.ts', "router.patch('/leads/:id'");
    expect(r).toMatch(/statusChanged = !!req\.body\.status && req\.body\.status !== \(current as any\)\.status/);
    expect(r).toMatch(/const timelineEntry = statusChanged/);
  });

  it('P4-SA-09: the ticket status must be one the screens know', () => {
    const r = route('ticketRoutes.ts', "router.put('/:id/status'");
    expect(r).toMatch(/if \(!TICKET_STATUSES\.includes\(status\)\)/);
    expect(r).toMatch(/status\(400\)/);
    expect(src('routes/ticketRoutes.ts')).toMatch(/TICKET_STATUSES = \['open', 'in-progress', 'resolved', 'closed'\]/);
  });

  it('P4-SA-10: hotel search matches part of a name or phone, with the term escaped', () => {
    const r = route('superAdminRoutes.ts', "router.get('/hotels'");
    expect(r).not.toMatch(/filter\.\$text/);
    expect(r).toMatch(/term\.replace\(\/\[\.\*\+\?\^\$\{\}\(\)\|\[\\\]\\\\\]\/g, '\\\\\$&'\)/);
    expect(r).toMatch(/\{ phone: rx \}/);
    expect(r).toMatch(/\.slice\(0, 60\)/);
  });
});

describe('Batch 7: customers and loyalty', () => {
  it('P4-CATALOG-02: a blank birthday / anniversary / email on edit is stored as "not set"', () => {
    const r = route('loyaltyRoutes.ts', "router.patch('/customers/:customerId'");
    expect(r).toMatch(/BLANK_IS_NULL = new Set\(\['email', 'birthday', 'anniversary'\]\)/);
    expect(r).toMatch(/v\.trim\(\) === '' \? null : v/);
  });

  it('P4-CATALOG-03: a POS sale finds the profile by the normalised phone and counts the visit', () => {
    const s = src('routes/orderRoutes.ts');
    const earn = s.slice(s.indexOf('const earnProfile = await CustomerProfile.findOne'), s.indexOf('const earnOrgCtx'));
    expect(earn).toMatch(/phone:\s+\{ \$in: \[phone, normalizePhone\(phone\)\]/);
    expect(earn).toMatch(/\$inc: \{ lifetimeSpend: existing\.grandTotal, visitCount: 1 \}/);
  });
});

describe('Batch 7: categories', () => {
  it('P4-CATALOG-05: a category with live products cannot be deleted', () => {
    const r = route('categoryRoutes.ts', "router.delete('/:id'");
    expect(r.indexOf('Product.countDocuments')).toBeLessThan(r.indexOf('Category.findOneAndUpdate'));
    expect(r).toMatch(/CATEGORY_HAS_PRODUCTS/);
  });

  it('P4-CATALOG-06/07: a live duplicate is refused by name; a deleted one with that name is restored', () => {
    const r = route('categoryRoutes.ts', "router.post('/'");
    expect(r).toMatch(/if \(await nameTaken\(req\.hotelId!, cleanName\)\) return duplicateName\(res, cleanName\)/);
    expect(r).toMatch(/isDeleted: true \}\);[\s\S]*deleted\.set\(\{ \.\.\.fields, isDeleted: false \}\)/);
    expect(src('routes/categoryRoutes.ts')).toMatch(/A category named "\$\{name\.trim\(\)\}" already exists/);
  });
});

describe('Batch 7: settings, coupons, audit log, orders', () => {
  it('P4-CATALOG-11: the hotel name cannot be saved blank', () => {
    const r = route('settingsRoutes.ts', "router.put('/'");
    expect(r).toMatch(/if \('hotelName' in body\)/);
    expect(r).toMatch(/HOTEL_NAME_REQUIRED/);
  });

  it('P4-CATALOG-15: "Valid From" may be left blank (valid from now); a bad date is refused', () => {
    const r = route('couponRoutes.ts', "router.post('/'");
    expect(r).not.toMatch(/!validFrom\)/);
    expect(r).toMatch(/const startsAt = validFrom \? new Date\(validFrom\) : new Date\(\)/);
    expect(r).toMatch(/Valid From is not a valid date/);
  });

  it('P4-RPT-08: an audit-log date filter covers the whole IST day, "To" included', () => {
    const r = route('auditRoutes.ts', "router.get('/'");
    expect(r).toMatch(/istDay\(str, end\)/);
    expect(r).toMatch(/bound\(req\.query\.to, true\)/);
  });

  it('dine-in guest count is stored on the order (1–999 only)', () => {
    const ok = new Order({ guestCount: 4 } as any);
    expect(ok.guestCount).toBe(4);
    expect(ok.validateSync()?.errors?.guestCount).toBeUndefined();
    expect(new Order({ guestCount: 0 } as any).validateSync()?.errors?.guestCount).toBeDefined();
    expect(new Order({} as any).guestCount).toBeNull();   // older orders: not set
    const s = src('routes/orderRoutes.ts');
    expect(s).toMatch(/guestCount:\s+b\.orderSource === 'dine-in' && Number\.isInteger\(Number\(b\.guestCount\)\)/);
  });
});

describe('Batch 7: delivery integrations list', () => {
  it('find-or-create is one atomic upsert (two first loads at once no longer give HTTP 500)', () => {
    const s = src('routes/aggregatorRoutes.ts');
    const r = s.slice(s.indexOf("'/integrations',"), s.indexOf("'/status',"));
    expect(r).toMatch(/findOneAndUpdate\(\s*\{ hotelId, platform \},\s*\{ \$setOnInsert: \{ hotelId, platform \} \},\s*\{ upsert: true/);
    expect(r).not.toMatch(/AggregatorIntegration\.create\(/);
  });
});

afterAll(async () => { await mongoose.disconnect().catch(() => {}); });

describe('Batch 7: delivery integration settings', () => {
  it('P4-CATALOG-22: a store ID used by another outlet → 409 with a plain message, never the raw error', () => {
    const s = src('routes/aggregatorRoutes.ts');
    const r = s.slice(s.indexOf('// PUT /api/aggregator/integrations/:platform'));
    const put = r.slice(0, r.indexOf('\n);'));
    expect(put).toMatch(/err\?\.code === 11000 && \(err\?\.keyPattern\?\.storeId/);
    expect(put).toMatch(/STORE_ID_TAKEN/);
    expect(put).not.toMatch(/err\.message \|\|/);
  });
});
