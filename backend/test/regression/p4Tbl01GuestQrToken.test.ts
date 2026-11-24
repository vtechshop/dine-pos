/**
 * Regression — P4-TBL-01 (Phase 5, Batch 1)
 *
 * Guests without a QR token were stored with `qrSessionToken: null`. The unique *sparse*
 * index on qrSessionToken skips missing fields but indexes explicit nulls, so only ONE such
 * guest could exist across all hotels; every further staff guest failed with E11000 and
 * dine-in orders were saved without their table session.
 *
 * These checks need no database: they guard the model definition and the source code so the
 * explicit null can't come back. The end-to-end behaviour (real MongoDB) is covered by
 * automation/e2e/tests/regression/tbl-01-table-sessions.spec.js.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Guest, { UNSET_QR_TOKEN } from '../../src/models/Guest';

describe('P4-TBL-01 — guests without a QR token never store qrSessionToken: null', () => {
  const base = {
    sessionId: new mongoose.Types.ObjectId(),
    hotelId: new mongoose.Types.ObjectId(),
    tableId: new mongoose.Types.ObjectId(),
    tableNumber: '1',
    guestNumber: 1,
    displayLabel: 'Guest A',
  };

  it('a new staff guest has no qrSessionToken field at all (not null)', () => {
    const doc = new Guest(base).toObject();
    expect('qrSessionToken' in doc).toBe(false);
  });

  it('a QR guest keeps its token', () => {
    const doc = new Guest({ ...base, qrSessionToken: 'a'.repeat(64) }).toObject();
    expect(doc.qrSessionToken).toBe('a'.repeat(64));
  });

  it('the schema path has no default value', () => {
    const p: any = Guest.schema.path('qrSessionToken');
    expect(p.defaultValue).toBeUndefined();
  });

  it('the QR token index is still unique (uniqueness of real tokens is not weakened)', () => {
    const idx = Guest.schema.indexes().find(([keys]) => Object.keys(keys).length === 1 && (keys as any).qrSessionToken === 1);
    expect(idx).toBeDefined();
    expect(idx![1]).toMatchObject({ unique: true, sparse: true });
  });

  it('UNSET_QR_TOKEN removes the field', () => {
    expect(UNSET_QR_TOKEN).toEqual({ qrSessionToken: 1 });
  });

  it('no route or util writes qrSessionToken: null (reads with { qrSessionToken: null } are allowed in utils/sessionUtils.ts)', () => {
    const roots = ['routes', 'utils', 'services'].map(d => path.join(__dirname, '..', '..', 'src', d));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts')) continue;
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (/^\s*(\*|\/\*)/.test(line)) return;                 // block-comment line
          const code = line.replace(/\/\/.*$/, '');
          if (!/qrSessionToken\s*:\s*null/.test(code)) return;
          // The one allowed occurrence: the staff-guest lookup filter (matches missing fields).
          if (p.endsWith(path.join('utils', 'sessionUtils.ts')) && /Guest\.findOne|qrSessionToken:\s*null,\s*$/.test(code)) return;
          offenders.push(`${path.relative(path.join(__dirname, '..', '..'), p)}:${i + 1}`);
        });
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
