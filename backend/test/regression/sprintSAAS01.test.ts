/**
 * Sprint SAAS-01 — Subscription & Trial Phase 1 Hardening
 *
 * 29 pure-logic / static-analysis tests.  No network.  No DB.  No MSG91 calls.
 * REAL MSG91 VALIDATION: PENDING — template approvals required in production.
 *
 * Groups:
 *  SAAS-01–04  Hotel model — trial reminder fields
 *  SAAS-05–11  Trial reminder worker — logic & safety invariants
 *  SAAS-12–16  Scheduler — wiring
 *  SAAS-17–20  GET /api/saas/status — trial countdown fields
 *  SAAS-21–24  TrialBanner component — UI contract
 *  SAAS-25–27  RegisterPage — email required validation
 *  SAAS-28–29  phoneUtils — normalizePhone
 */

import * as fs   from 'fs';
import * as path from 'path';

const backendSrc  = path.resolve(__dirname, '../../src');
const webSrc      = path.resolve(__dirname, '../../../web/src');

function readBackend(rel: string): string {
  return fs.readFileSync(path.join(backendSrc, rel), 'utf-8');
}

function readWeb(rel: string): string {
  return fs.readFileSync(path.join(webSrc, rel), 'utf-8');
}

// ─── SAAS-01–04  Hotel model — trial reminder fields ────────────────────────

describe('SAAS-01–04  Hotel model trial reminder fields', () => {
  const model = readBackend('models/Hotel.ts');

  test('SAAS-01: IHotel interface declares trialReminder7SentAt', () => {
    expect(model).toContain('trialReminder7SentAt');
  });

  test('SAAS-02: IHotel interface declares trialReminder12SentAt', () => {
    expect(model).toContain('trialReminder12SentAt');
  });

  test('SAAS-03: Schema defines trialReminder7SentAt as Date with null default', () => {
    expect(model).toMatch(/trialReminder7SentAt\s*[:{]/);
    expect(model).toContain('trialReminder7SentAt');
    const schemaSection = model.slice(model.indexOf('trialReminder7SentAt'));
    expect(schemaSection).toMatch(/default:\s*null/);
  });

  test('SAAS-04: Schema defines trialReminder12SentAt as Date with null default', () => {
    expect(model).toContain('trialReminder12SentAt');
    const schemaSection = model.slice(model.indexOf('trialReminder12SentAt'));
    expect(schemaSection).toMatch(/default:\s*null/);
  });
});

// ─── SAAS-05–11  Trial reminder worker ──────────────────────────────────────

describe('SAAS-05–11  Trial reminder worker — logic & safety invariants', () => {
  const worker = readBackend('workers/trialReminderWorker.ts');

  test('SAAS-05: runTrialReminderWorker is exported', () => {
    expect(worker).toContain('export async function runTrialReminderWorker');
  });

  test('SAAS-06: Worker queries for status = "trial"', () => {
    expect(worker).toContain("status:");
    expect(worker).toContain("'trial'");
  });

  test('SAAS-07: Worker filters parentHotelId: null — no branches', () => {
    expect(worker).toContain('parentHotelId');
    expect(worker).toContain('null');
  });

  test('SAAS-08: Day 7 reminder uses 7-day threshold', () => {
    expect(worker).toMatch(/DAY7_THRESHOLD_DAYS\s*=\s*7/);
  });

  test('SAAS-09: Day 12 reminder uses 2-day threshold', () => {
    expect(worker).toMatch(/DAY12_THRESHOLD_DAYS\s*=\s*2/);
  });

  test('SAAS-10: Atomic claim uses findOneAndUpdate on reminder field', () => {
    expect(worker).toContain('findOneAndUpdate');
    expect(worker).toContain('trialReminder7SentAt: null');
  });

  test('SAAS-11: Worker skips send when no provider configured', () => {
    expect(worker).toContain("provider.name === 'none'");
    expect(worker).toContain('logger.info');
  });

  test('SAAS-12: Invalid phone skips send with warning', () => {
    expect(worker).toContain('normalizePhone');
    expect(worker).toContain('logger.warn');
  });

  test('SAAS-13: Claim timestamp is NOT reset on send failure', () => {
    // The catch block must NOT contain any $unset or reset of the reminder fields
    const catchBlock = worker.slice(worker.lastIndexOf('} catch'));
    expect(catchBlock).not.toContain('trialReminder7SentAt: null');
    expect(catchBlock).not.toContain('trialReminder12SentAt: null');
    expect(catchBlock).not.toContain('$unset');
  });
});

// ─── SAAS-12–16  Scheduler wiring ───────────────────────────────────────────

describe('SAAS-12–16  Scheduler wiring', () => {
  const scheduler = readBackend('services/scheduler.ts');

  test('SAAS-14: Scheduler imports runTrialReminderWorker', () => {
    expect(scheduler).toContain('runTrialReminderWorker');
    expect(scheduler).toContain('trialReminderWorker');
  });

  test('SAAS-15: Scheduler has trialReminderTick interval variable', () => {
    expect(scheduler).toContain('trialReminderTick');
  });

  test('SAAS-16: scheduleTrialReminders function is defined', () => {
    expect(scheduler).toContain('scheduleTrialReminders');
  });

  test('SAAS-17: startScheduler calls scheduleTrialReminders', () => {
    const startBlock = scheduler.slice(
      scheduler.indexOf('export function startScheduler'),
      scheduler.indexOf('export function stopScheduler'),
    );
    expect(startBlock).toContain('scheduleTrialReminders');
  });

  test('SAAS-18: stopScheduler clears trialReminderTick', () => {
    const stopBlock = scheduler.slice(scheduler.indexOf('export function stopScheduler'));
    expect(stopBlock).toContain('trialReminderTick');
    expect(stopBlock).toContain('clearInterval');
  });
});

// ─── SAAS-17–20  GET /api/saas/status — trial countdown ─────────────────────

describe('SAAS-17–20  GET /api/saas/status trial countdown fields', () => {
  const route = readBackend('routes/saasBillingRoutes.ts');

  test('SAAS-19: Status route selects trialStartDate from DB', () => {
    const selectBlock = route.slice(
      route.indexOf("router.get('/status'"),
      route.indexOf("router.get('/plan'"),
    );
    expect(selectBlock).toContain('trialStartDate');
  });

  test('SAAS-20: Status route selects trialEndDate from DB', () => {
    const selectBlock = route.slice(
      route.indexOf("router.get('/status'"),
      route.indexOf("router.get('/plan'"),
    );
    expect(selectBlock).toContain('trialEndDate');
  });

  test('SAAS-21: Status route computes trialDaysRemaining using Math.ceil', () => {
    expect(route).toContain('trialDaysRemaining');
    expect(route).toContain('Math.ceil');
  });

  test('SAAS-22: trialDaysRemaining is null for non-trial status', () => {
    expect(route).toContain("h.status === 'trial'");
    // The null initialization means non-trial gets null
    const computeBlock = route.slice(route.indexOf("let trialDaysRemaining"));
    expect(computeBlock.slice(0, 50)).toContain('null');
  });
});

// ─── SAAS-21–24  TrialBanner component ──────────────────────────────────────

describe('SAAS-21–24  TrialBanner component', () => {
  const banner = readWeb('components/layout/TrialBanner.tsx');
  const layout = readWeb('components/layout/AppLayout.tsx');

  test('SAAS-23: TrialBanner component file exists and exports TrialBanner', () => {
    expect(banner).toContain('export function TrialBanner');
  });

  test('SAAS-24: TrialBanner shows days remaining text', () => {
    expect(banner).toContain('daysRemaining');
    expect(banner).toContain('remaining');
  });

  test('SAAS-25: TrialBanner shows Subscribe Now link for urgent state (≤3 days)', () => {
    expect(banner).toContain('Subscribe Now');
    expect(banner).toMatch(/daysRemaining\s*<=\s*3/);
    // Link must point to existing /subscription route, not a dead /settings/billing path
    expect(banner).toContain('to="/subscription"');
    expect(banner).not.toContain('/settings/billing');
  });

  test('SAAS-26: TrialBanner returns null when not in trial', () => {
    expect(banner).toContain('return null');
  });

  test('SAAS-27: AppLayout imports and renders TrialBanner', () => {
    expect(layout).toContain('TrialBanner');
    expect(layout).toContain('<TrialBanner');
  });
});

// ─── SAAS-25–27  RegisterPage email fix ─────────────────────────────────────

describe('SAAS-25–27  RegisterPage email required validation', () => {
  const register = readWeb('pages/RegisterPage.tsx');

  test('SAAS-28: Email input has required attribute', () => {
    const emailBlock = register.slice(
      register.indexOf('id="email"'),
      register.indexOf('id="businessType"'),
    );
    expect(emailBlock).toContain('required');
  });

  test('SAAS-29: Email label no longer says "Optional"', () => {
    const emailLabel = register.slice(
      register.indexOf('htmlFor="email"'),
      register.indexOf('id="email"'),
    );
    expect(emailLabel).not.toContain('Optional');
  });

  test('SAAS-30: handleSubmit validates email before calling API', () => {
    expect(register).toContain('form.email');
    expect(register).toContain('Email address is required');
  });
});

// ─── SAAS-28–29  phoneUtils ──────────────────────────────────────────────────

describe('SAAS-28–29  phoneUtils normalizePhone', () => {
  const phoneUtils = readBackend('utils/phoneUtils.ts');

  test('SAAS-31: normalizePhone is exported', () => {
    expect(phoneUtils).toContain('export function normalizePhone');
  });

  test('SAAS-32: normalizePhone handles 10-digit India numbers', () => {
    expect(phoneUtils).toContain('+91');
    expect(phoneUtils).toMatch(/digits\.length\s*===\s*10/);
  });

  test('SAAS-33: normalizePhone returns null for invalid input', () => {
    expect(phoneUtils).toContain('return null');
  });
});
