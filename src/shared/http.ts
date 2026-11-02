/**
 * Parse a Retry-After header. Accepts delta-seconds or an HTTP date.
 * Returns milliseconds, clamped to a sane range for a browser extension.
 */
export function parseRetryAfterMs(
  raw: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return null;
    return Math.min(Math.max(seconds, 0) * 1000, 10 * 60 * 1000);
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - now, 0), 10 * 60 * 1000);
}
