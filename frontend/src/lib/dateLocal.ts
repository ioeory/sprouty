/**
 * Local calendar helpers — avoid `toISOString().split('T')[0]` which uses **UTC**
 * and is wrong for `<input type="date">` defaults in positive-offset timezones
 * (e.g. Asia/Shanghai after local midnight but before UTC midnight).
 */

/** `YYYY-MM-DD` for `<input type="date">` from a Date in the user's local TZ. */
export function formatLocalDateForInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** `YYYY-MM` for `<input type="month">` from local calendar. */
export function formatLocalYearMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Turn a date-only field value into an ISO instant for the API.
 * Uses local noon to avoid DST edge cases when the server stores timestamps.
 */
export function dateInputValueToISO(yyyyMmDd: string): string {
  const parts = yyyyMmDd.split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return new Date(yyyyMmDd).toISOString();
  }
  const [y, mo, d] = parts;
  return new Date(y, mo - 1, d, 12, 0, 0, 0).toISOString();
}
