// NYSE trading calendar, shared by the dashboard (staleness badge) and
// scripts/screener-cron.mjs (holiday vs. late-data skips). Covers the regular
// full-day closures; one-off closures (e.g. national days of mourning) are not
// known here and would show as a late scan for that day.

const DAY_MS = 864e5;
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
const utc = (y, m, d) => Date.UTC(y, m - 1, d);
const dow = (y, m, d) => new Date(utc(y, m, d)).getUTCDay();

// Day of month of the n-th weekday `wd` (0 = Sunday) in month m.
const nthWeekday = (y, m, wd, n) => 1 + ((wd - dow(y, m, 1) + 7) % 7) + 7 * (n - 1);

function lastWeekday(y, m, wd) {
  const last = new Date(utc(y, m + 1, 0)).getUTCDate();
  return last - ((dow(y, m, last) - wd + 7) % 7);
}

// Easter Sunday (anonymous Gregorian algorithm), as [month, day].
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return [Math.floor(n / 31), (n % 31) + 1];
}

// Fixed-date holiday: Saturday is observed on Friday, Sunday on Monday.
function observed(y, m, d) {
  const w = dow(y, m, d);
  return isoOf(utc(y, m, d) + (w === 6 ? -1 : w === 0 ? 1 : 0) * DAY_MS);
}

const cache = new Map();

/** Set of ISO dates (YYYY-MM-DD) the NYSE is closed in year y (weekdays only). */
export function nyseHolidays(y) {
  if (!cache.has(y)) {
    const [em, ed] = easter(y);
    const h = new Set([
      isoOf(utc(y, 1, nthWeekday(y, 1, 1, 3))), // Martin Luther King Jr. Day
      isoOf(utc(y, 2, nthWeekday(y, 2, 1, 3))), // Presidents' Day
      isoOf(utc(y, em, ed) - 2 * DAY_MS), // Good Friday
      isoOf(utc(y, 5, lastWeekday(y, 5, 1))), // Memorial Day
      observed(y, 7, 4), // Independence Day
      isoOf(utc(y, 9, nthWeekday(y, 9, 1, 1))), // Labor Day
      isoOf(utc(y, 11, nthWeekday(y, 11, 4, 4))), // Thanksgiving
      observed(y, 12, 25), // Christmas
    ]);
    // New Year's Day on a Saturday is not observed (no Dec 31 closure).
    if (dow(y, 1, 1) !== 6) h.add(observed(y, 1, 1));
    if (y >= 2022) h.add(observed(y, 6, 19)); // Juneteenth
    cache.set(y, h);
  }
  return cache.get(y);
}

/** True if the NYSE holds a session on the ISO date. */
export function isTradingDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const w = dow(y, m, d);
  return w !== 0 && w !== 6 && !nyseHolidays(y).has(iso);
}

/**
 * Latest trading session whose primary scan time (22:15 UTC on the session
 * date) is at or before `t`. Returns { session: 'YYYY-MM-DD', scanAt: Date }.
 */
export function latestScannableSession(t = new Date()) {
  let c = utc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) + (22 * 60 + 15) * 60e3;
  if (c > t.getTime()) c -= DAY_MS;
  while (!isTradingDay(isoOf(c))) c -= DAY_MS;
  return { session: isoOf(c), scanAt: new Date(c) };
}
