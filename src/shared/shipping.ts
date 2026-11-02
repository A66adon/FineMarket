import type {
  Cents,
  OptimizerPolicy,
  PlanLine,
  SelectedMethod,
  SellerInfo,
  ShippingMethod,
} from './types';
import { parseEuroToCents, tryParseEuroToCents } from './money';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Normalize a raw shipping-costs API payload.
 *
 * The endpoint is unauthenticated and lightly validated, so every entry is
 * checked independently. Bad entries are dropped rather than poisoning the
 * whole table. `price` is the buyer-facing EUR number; `stampPrice` is kept for
 * display only and is null when the origin stamp is not in EUR (for example a
 * UK seller's "£3.60").
 */
export function parseShippingMethods(raw: unknown): ShippingMethod[] {
  if (!Array.isArray(raw)) return [];

  const methods: ShippingMethod[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) continue;

    const name = entry.name;
    const isTracked = entry.isTracked;
    const maxValue = entry.maxValue;
    const maxWeight = entry.maxWeight;
    const price = entry.price;
    const isLetter = entry.isLetter;
    const isVirtual = entry.isVirtual;

    if (typeof name !== 'string') continue;
    if (typeof isTracked !== 'boolean') continue;
    if (typeof maxValue !== 'string') continue;
    if (typeof maxWeight !== 'number' || !Number.isFinite(maxWeight) || maxWeight < 0) {
      continue;
    }
    if (typeof price !== 'string') continue;
    if (typeof isLetter !== 'boolean') continue;
    if (typeof isVirtual !== 'boolean') continue;

    let maxValueCents: Cents;
    let priceCents: Cents;
    try {
      maxValueCents = parseEuroToCents(maxValue);
      priceCents = parseEuroToCents(price);
    } catch {
      continue;
    }

    if (maxValueCents < 0 || priceCents < 0) continue;

    const stampPriceRaw = typeof entry.stampPrice === 'string' ? entry.stampPrice : '';
    const stampPriceCents = tryParseEuroToCents(stampPriceRaw);

    const methodKey = [
      name,
      String(isTracked),
      String(maxValueCents),
      String(maxWeight),
      String(priceCents),
      String(isLetter),
      String(isVirtual),
    ].join('|');

    methods.push({
      methodKey,
      name,
      isTracked,
      maxValueCents,
      maxWeightG: maxWeight,
      stampPriceRaw,
      stampPriceCents,
      priceCents,
      isLetter,
      isVirtual,
    });
  }

  return methods;
}

/** Planning weight in grams, using the policy's safety factor. */
export function estimateWeightG(cardCount: number, policy: OptimizerPolicy): number {
  return (
    Math.ceil(cardCount * policy.gramsPerCard * policy.weightSafetyFactor) +
    policy.extraPackagingG
  );
}

/**
 * How many cards fit in a letter, given the (missing) dimension data.
 *
 * `conservative` uses Cardmarket's published 4/17/40 limits and never goes above
 * 40, because the API exposes no thickness. `published` extrapolates larger
 * letter tiers from their weight. `weight` ignores the published card caps.
 */
export function letterCardCapacity(
  method: ShippingMethod,
  policy: OptimizerPolicy,
): number {
  if (!method.isLetter) return Number.POSITIVE_INFINITY;

  const effectiveGramsPerCard = policy.gramsPerCard * policy.weightSafetyFactor;

  if (policy.letterCapacityMode === 'weight') {
    return effectiveGramsPerCard > 0
      ? Math.floor(method.maxWeightG / effectiveGramsPerCard)
      : 0;
  }

  if (method.maxWeightG <= 20) return 4;
  if (method.maxWeightG <= 50) return 17;
  if (method.maxWeightG <= 100) return 40;

  if (policy.letterCapacityMode === 'conservative') return 40;

  return effectiveGramsPerCard > 0
    ? Math.floor(method.maxWeightG / effectiveGramsPerCard)
    : 40;
}

/** Reasons why a basket must use a tracked shipping method. */
export function trackingReasons(
  itemsValueCents: Cents,
  seller: SellerInfo,
  policy: OptimizerPolicy,
): string[] {
  const reasons: string[] = [];
  if (itemsValueCents > policy.trackingThresholdCents) {
    reasons.push('value_over_threshold');
  }
  if (seller.requiresTracking) reasons.push('seller_requires_tracking');
  if (policy.alwaysTrack) reasons.push('user_always_track');
  return reasons;
}

/**
 * Trustee Service fee for a tracked method. `priceCents` never includes it.
 * The real rate is 0.5%-1%; the policy default is the conservative 1%.
 */
export function trusteeFeeCents(
  itemsValueCents: Cents,
  method: ShippingMethod,
  policy: OptimizerPolicy,
): Cents {
  if (!method.isTracked || itemsValueCents <= 0) return 0;

  // The type exposes a number, but the research model also allows a rate
  // function so a caller can map individual methods to the published table.
  const configured = policy.trusteeRateBps as
    | number
    | ((method: ShippingMethod) => number);
  const bps = typeof configured === 'function' ? configured(method) : configured;

  return Math.max(
    policy.minTrusteeFeeCents,
    Math.ceil((itemsValueCents * bps) / 10_000),
  );
}

export interface BasketEstimate {
  itemsValueCents: Cents;
  cardCount: number;
  estimatedWeightG: number;
  trackingRequired: boolean;
  trackingReasons: string[];
}

export function estimateBasket(
  lines: readonly PlanLine[],
  seller: SellerInfo,
  policy: OptimizerPolicy,
): BasketEstimate {
  let itemsValueCents = 0;
  let cardCount = 0;

  for (const line of lines) {
    itemsValueCents += line.priceCents * line.quantity;
    cardCount += line.quantity;
  }

  const reasons = trackingReasons(itemsValueCents, seller, policy);

  return {
    itemsValueCents,
    cardCount,
    estimatedWeightG: estimateWeightG(cardCount, policy),
    trackingRequired: reasons.length > 0,
    trackingReasons: reasons,
  };
}

/**
 * Pick the cheapest viable physical method for one seller basket.
 * The comparator ranks by postage plus Trustee, then deterministic tie-breaks.
 */
export function selectShippingMethod(
  methods: readonly ShippingMethod[],
  basket: BasketEstimate,
  policy: OptimizerPolicy,
): SelectedMethod | null {
  const candidates: SelectedMethod[] = [];

  for (const method of methods) {
    if (method.isVirtual) continue;
    if (method.maxValueCents < basket.itemsValueCents) continue;
    if (method.maxWeightG < basket.estimatedWeightG) continue;
    if (basket.trackingRequired && !method.isTracked) continue;

    if (
      method.isLetter &&
      basket.cardCount > letterCardCapacity(method, policy)
    ) {
      continue;
    }

    const trustee = trusteeFeeCents(basket.itemsValueCents, method, policy);

    candidates.push({
      methodKey: method.methodKey,
      name: method.name,
      priceCents: method.priceCents,
      trusteeFeeCents: trustee,
      comparableTotalCents: method.priceCents + trustee,
      maxValueCents: method.maxValueCents,
      maxWeightG: method.maxWeightG,
      isTracked: method.isTracked,
      isLetter: method.isLetter,
    });
  }

  candidates.sort(
    (a, b) =>
      a.comparableTotalCents - b.comparableTotalCents ||
      a.priceCents - b.priceCents ||
      Number(b.isTracked) - Number(a.isTracked) ||
      b.maxWeightG - a.maxWeightG ||
      codeUnitCompare(a.methodKey, b.methodKey),
  );

  return candidates[0] ?? null;
}
