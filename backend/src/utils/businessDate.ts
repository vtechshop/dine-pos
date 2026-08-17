// ─── Business Date Utility ────────────────────────────────────────────────────
// All revenue aggregation uses the hotel's LOCAL business date, not UTC.
// Business day boundary: midnight in the hotel's configured timezone.
// IST (+5:30) default means the business day resets at 18:30 UTC, not 00:00 UTC.
//
// HOW IT WORKS:
//   UTC timestamp → shift by timezone offset → extract YYYY-MM-DD
//   All MongoDB timestamps remain stored as UTC; only date BUCKETING uses local tz.

const TZ_OFFSETS_MINUTES: Record<string, number> = {
  'Asia/Kolkata':      330,   // +5:30
  'Asia/Dubai':        240,   // +4:00
  'America/New_York': -300,   // -5:00 (EST; DST not handled — extend if needed)
  'Europe/London':       0,   // GMT
  'UTC':                 0,
};

const DEFAULT_TZ = 'Asia/Kolkata';

function tzOffsetMinutes(timezone: string): number {
  if (TZ_OFFSETS_MINUTES[timezone] !== undefined) {
    return TZ_OFFSETS_MINUTES[timezone];
  }
  // Try to parse "UTC+HH:MM" / "UTC-HH:MM" as a fallback
  const m = timezone.match(/^UTC([+-])(\d{1,2}):(\d{2})$/);
  if (m) {
    const sign = m[1] === '+' ? 1 : -1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  }
  return TZ_OFFSETS_MINUTES[DEFAULT_TZ];
}

/**
 * Convert a UTC Date to a "YYYY-MM-DD" business date in the given timezone.
 * e.g. businessDate(new Date('2024-08-17T20:00:00Z'), 'Asia/Kolkata')
 *      → '2024-08-18' (because 20:00 UTC = 01:30 IST next day)
 */
export function toBusinessDate(utcDate: Date, timezone: string = DEFAULT_TZ): string {
  const offsetMs = tzOffsetMinutes(timezone) * 60_000;
  const localMs  = utcDate.getTime() + offsetMs;
  const local    = new Date(localMs);
  const yy = local.getUTCFullYear();
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(local.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Today's business date in the given timezone.
 */
export function todayBusinessDate(timezone: string = DEFAULT_TZ): string {
  return toBusinessDate(new Date(), timezone);
}

/**
 * Yesterday's business date in the given timezone.
 */
export function yesterdayBusinessDate(timezone: string = DEFAULT_TZ): string {
  return toBusinessDate(new Date(Date.now() - 86_400_000), timezone);
}

/**
 * The UTC start of a business day (midnight local → UTC).
 * e.g. '2024-08-17' in IST starts at 2024-08-16T18:30:00Z
 */
export function startOfBusinessDay(dateStr: string, timezone: string = DEFAULT_TZ): Date {
  const offsetMs = tzOffsetMinutes(timezone) * 60_000;
  const localMidnightMs = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  return new Date(localMidnightMs - offsetMs);
}

/**
 * The UTC end of a business day (23:59:59.999 local → UTC).
 */
export function endOfBusinessDay(dateStr: string, timezone: string = DEFAULT_TZ): Date {
  const offsetMs = tzOffsetMinutes(timezone) * 60_000;
  const localEndMs = new Date(`${dateStr}T23:59:59.999Z`).getTime();
  return new Date(localEndMs - offsetMs);
}

/**
 * Convert a UTC hour (0-23) to local hour display string for a timezone.
 */
export function utcHourToLocalDisplay(utcHour: number, timezone: string = DEFAULT_TZ): string {
  const offsetMinutes = tzOffsetMinutes(timezone);
  const localHour     = ((utcHour * 60 + offsetMinutes) / 60) % 24;
  const h             = Math.floor(((localHour % 24) + 24) % 24);
  const ampm          = h >= 12 ? 'PM' : 'AM';
  const display       = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${ampm}`;
}

export { DEFAULT_TZ };
