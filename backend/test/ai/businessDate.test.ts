/**
 * test/ai/businessDate.test.ts
 *
 * Unit tests for src/utils/businessDate.ts
 *
 * These are pure-function tests — no network, no database, no mocks required.
 * They verify that UTC→local date conversion is arithmetically correct for the
 * timezones the utility hard-codes.
 */

import {
  toBusinessDate,
  yesterdayBusinessDate,
  startOfBusinessDay,
  endOfBusinessDay,
  utcHourToLocalDisplay,
} from '../../src/utils/businessDate';

// ─── toBusinessDate ───────────────────────────────────────────────────────────

describe('toBusinessDate', () => {
  it('converts UTC 2024-08-16T20:00:00Z to 2024-08-17 in IST (+5:30)', () => {
    // 20:00 UTC + 5:30 = 01:30 IST next day → business date is 2024-08-17
    const result = toBusinessDate(new Date('2024-08-16T20:00:00Z'), 'Asia/Kolkata');
    expect(result).toBe('2024-08-17');
  });

  it('converts UTC midnight (00:00Z) to the SAME calendar day in IST (05:30 IST)', () => {
    // 2024-08-17T00:00:00Z + 5:30 = 2024-08-17T05:30 IST → still 2024-08-17
    const result = toBusinessDate(new Date('2024-08-17T00:00:00Z'), 'Asia/Kolkata');
    expect(result).toBe('2024-08-17');
  });

  it('converts the last second before IST midnight (18:29:59Z) to the SAME calendar day', () => {
    // 2024-08-17T18:29:59Z + 5:30 = 2024-08-17T23:59:59 IST → still 2024-08-17
    const result = toBusinessDate(new Date('2024-08-17T18:29:59Z'), 'Asia/Kolkata');
    expect(result).toBe('2024-08-17');
  });

  it('rolls over to the next calendar day exactly at 18:30Z in IST', () => {
    // 2024-08-17T18:30:00Z + 5:30 = 2024-08-18T00:00:00 IST → 2024-08-18
    const result = toBusinessDate(new Date('2024-08-17T18:30:00Z'), 'Asia/Kolkata');
    expect(result).toBe('2024-08-18');
  });

  it('works for UTC timezone (zero offset)', () => {
    const result = toBusinessDate(new Date('2024-08-17T12:00:00Z'), 'UTC');
    expect(result).toBe('2024-08-17');
  });

  it('works for Asia/Dubai (+4:00)', () => {
    // 2024-08-17T21:00:00Z + 4:00 = 2024-08-18T01:00 Dubai → 2024-08-18
    const result = toBusinessDate(new Date('2024-08-17T21:00:00Z'), 'Asia/Dubai');
    expect(result).toBe('2024-08-18');
  });

  it('works for America/New_York (-5:00, EST, no DST adjustment)', () => {
    // 2024-08-17T03:00:00Z - 5:00 = 2024-08-16T22:00 EST → 2024-08-16
    const result = toBusinessDate(new Date('2024-08-17T03:00:00Z'), 'America/New_York');
    expect(result).toBe('2024-08-16');
  });

  it('falls back to IST for an unknown timezone', () => {
    // Unknown tz → IST offset applied
    // 2024-08-16T20:00:00Z + 5:30 → 2024-08-17
    const result = toBusinessDate(new Date('2024-08-16T20:00:00Z'), 'Unknown/Zone');
    expect(result).toBe('2024-08-17');
  });

  it('parses UTC+05:30 string as an IST equivalent', () => {
    const result = toBusinessDate(new Date('2024-08-16T20:00:00Z'), 'UTC+05:30');
    expect(result).toBe('2024-08-17');
  });

  it('parses UTC-05:00 string as EST equivalent', () => {
    // 2024-08-17T03:00:00Z - 5:00 → 2024-08-16
    const result = toBusinessDate(new Date('2024-08-17T03:00:00Z'), 'UTC-05:00');
    expect(result).toBe('2024-08-16');
  });

  it('defaults to IST when no timezone argument is given', () => {
    // 2024-08-16T20:00:00Z → 2024-08-17 in IST
    const result = toBusinessDate(new Date('2024-08-16T20:00:00Z'));
    expect(result).toBe('2024-08-17');
  });

  it('produces a YYYY-MM-DD string with zero-padded month and day', () => {
    // January 5th → month=01 day=05
    const result = toBusinessDate(new Date('2024-01-04T20:00:00Z'), 'Asia/Kolkata');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).toBe('2024-01-05');
  });
});

// ─── yesterdayBusinessDate ────────────────────────────────────────────────────

describe('yesterdayBusinessDate', () => {
  it('returns the day before todayBusinessDate in IST', () => {
    // Compute expected: subtract 86400 seconds from now, convert to IST date
    const nowMs  = Date.now();
    const offset = 330 * 60_000; // IST +5:30
    const localToday = new Date(nowMs + offset);
    const localYest  = new Date(nowMs - 86_400_000 + offset);

    const todayStr = `${localToday.getUTCFullYear()}-${String(localToday.getUTCMonth() + 1).padStart(2, '0')}-${String(localToday.getUTCDate()).padStart(2, '0')}`;
    const yestStr  = `${localYest.getUTCFullYear()}-${String(localYest.getUTCMonth() + 1).padStart(2, '0')}-${String(localYest.getUTCDate()).padStart(2, '0')}`;

    expect(yesterdayBusinessDate('Asia/Kolkata')).toBe(yestStr);
    // Sanity: yesterday should be strictly less than today
    expect(yesterdayBusinessDate('Asia/Kolkata') < todayStr).toBe(true);
  });

  it('returns a valid YYYY-MM-DD string', () => {
    expect(yesterdayBusinessDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── startOfBusinessDay ───────────────────────────────────────────────────────

describe('startOfBusinessDay', () => {
  it('maps IST business-day start to 18:30 UTC of the PREVIOUS calendar day', () => {
    // IST business day 2024-08-17 starts at 2024-08-16T18:30:00.000Z
    const result = startOfBusinessDay('2024-08-17', 'Asia/Kolkata');
    expect(result.toISOString()).toBe('2024-08-16T18:30:00.000Z');
  });

  it('maps UTC business-day start to 00:00:00.000Z of the same calendar day', () => {
    const result = startOfBusinessDay('2024-08-17', 'UTC');
    expect(result.toISOString()).toBe('2024-08-17T00:00:00.000Z');
  });

  it('maps Dubai (+4:00) business-day start to 20:00 UTC of the PREVIOUS calendar day', () => {
    const result = startOfBusinessDay('2024-08-17', 'Asia/Dubai');
    expect(result.toISOString()).toBe('2024-08-16T20:00:00.000Z');
  });

  it('returns a Date object', () => {
    expect(startOfBusinessDay('2024-08-17') instanceof Date).toBe(true);
  });
});

// ─── endOfBusinessDay ─────────────────────────────────────────────────────────

describe('endOfBusinessDay', () => {
  it('maps IST business-day end to 18:29:59.999Z of the SAME UTC calendar day', () => {
    // IST 2024-08-17 23:59:59.999 → UTC 2024-08-17T18:29:59.999Z
    const result = endOfBusinessDay('2024-08-17', 'Asia/Kolkata');
    expect(result.toISOString()).toBe('2024-08-17T18:29:59.999Z');
  });

  it('maps UTC business-day end to 23:59:59.999Z of the same calendar day', () => {
    const result = endOfBusinessDay('2024-08-17', 'UTC');
    expect(result.toISOString()).toBe('2024-08-17T23:59:59.999Z');
  });

  it('end is always after start for the same date and timezone', () => {
    const start = startOfBusinessDay('2024-08-17', 'Asia/Kolkata');
    const end   = endOfBusinessDay('2024-08-17', 'Asia/Kolkata');
    expect(end.getTime() > start.getTime()).toBe(true);
  });

  it('the window is exactly 86399999 ms wide (24 h − 1 ms)', () => {
    const start = startOfBusinessDay('2024-08-17', 'UTC');
    const end   = endOfBusinessDay('2024-08-17', 'UTC');
    expect(end.getTime() - start.getTime()).toBe(86_399_999);
  });

  it('returns a Date object', () => {
    expect(endOfBusinessDay('2024-08-17') instanceof Date).toBe(true);
  });
});

// ─── utcHourToLocalDisplay (bonus) ───────────────────────────────────────────

describe('utcHourToLocalDisplay', () => {
  it('converts UTC 0 to 5:30 AM IST → "5:00 AM" (integer hour, floor)', () => {
    // UTC 0 + 5.5 h = 5.5 h IST → floor to 5 → "5:00 AM"
    expect(utcHourToLocalDisplay(0, 'Asia/Kolkata')).toBe('5:00 AM');
  });

  it('converts UTC 18 to 11:30 PM IST → "11:00 PM"', () => {
    // UTC 18 + 5.5 = 23.5 → floor to 23 → "11:00 PM"
    expect(utcHourToLocalDisplay(18, 'Asia/Kolkata')).toBe('11:00 PM');
  });

  it('returns "12:00 PM" for UTC noon in UTC timezone', () => {
    expect(utcHourToLocalDisplay(12, 'UTC')).toBe('12:00 PM');
  });

  it('returns "12:00 AM" for UTC midnight in UTC timezone', () => {
    expect(utcHourToLocalDisplay(0, 'UTC')).toBe('12:00 AM');
  });
});
