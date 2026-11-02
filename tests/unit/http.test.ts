import { describe, expect, it } from 'vitest';
import { parseRetryAfterMs } from '../../src/shared/http';

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('5')).toBe(5000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('parses an HTTP date', () => {
    const now = Date.parse('2026-11-02T10:00:00Z');
    expect(parseRetryAfterMs('Mon, 02 Nov 2026 10:00:10 GMT', now)).toBe(10_000);
  });

  it('returns null for missing or invalid values', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs('not-a-date')).toBeNull();
  });

  it('clamps very large waits to ten minutes', () => {
    expect(parseRetryAfterMs('99999')).toBe(600_000);
  });
});
