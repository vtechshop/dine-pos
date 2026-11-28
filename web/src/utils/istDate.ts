// Phase 5 · Batch 7 (P4-RPT-09): the hotel's business day is the Indian (IST) calendar day.
// `new Date().toISOString().slice(0, 10)` is the UTC date, which is still "yesterday" from
// 00:00 to 05:30 IST — so "today" widgets asked for the previous day in those hours.
const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** The IST calendar date of `at` (default: now) as YYYY-MM-DD. */
export function istDateString(at: Date = new Date()): string {
  return IST_DATE.format(at);
}
