import type { Cents } from './types';

/**
 * Parse a Cardmarket EUR amount such as "0,95 €" or "1.234,56 €" into cents.
 * Never use parseFloat on these strings: "1.000,00" must mean 100000.
 */
export function parseEuroToCents(raw: string): Cents {
  const match = /^\s*([0-9][0-9.,]*)\s*€\s*$/.exec(raw);
  if (!match?.[1]) throw new Error(`Not a EUR amount: ${raw}`);

  const body = match[1];
  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? body.replace(/\./g, '').replace(',', '.')
        : body.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = body.replace(',', '.');
  } else if (lastDot >= 0) {
    const groups = body.split('.');
    const thousandsOnly =
      groups.length > 1 && groups.slice(1).every((group) => group.length === 3);
    normalized = thousandsOnly ? groups.join('') : body;
  } else {
    normalized = body;
  }

  const [whole, fraction = ''] = normalized.split('.');
  if (!whole || !/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new Error(`Invalid EUR amount: ${raw}`);
  }
  if (fraction.length > 2) throw new Error(`Too many decimals: ${raw}`);

  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount out of range: ${raw}`);
  return cents;
}

export function tryParseEuroToCents(raw: string | null | undefined): Cents | null {
  if (!raw) return null;
  try {
    return parseEuroToCents(raw);
  } catch {
    return null;
  }
}

export function formatCents(cents: Cents, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatSignedCents(cents: Cents): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '';
  return `${sign}${formatCents(Math.abs(cents))}`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
