/** Legacy API timestamps without an offset represent UTC, never browser local time. */
export function parseApiUtcDate(value: string): Date {
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  return new Date(normalized);
}
