import type {
  BuyMode,
  CurvePoint,
  Offer,
  OptimizationResult,
  OptimizerPolicy,
  Plan,
  PlanLine,
  PlanMissing,
  PlanOrder,
  PlanVariant,
  Seller,
  SellerInfo,
  ShippingMethod,
  ShippingTable,
  Want,
} from './types';
import {
  estimateBasket,
  estimateWeightG,
  selectShippingMethod,
  trackingReasons,
} from './shipping';

export interface OptimizeInput {
  wants: Want[];
  buyerCountryId: number;
  shipping: ShippingTable;
  routeEta: ReadonlyMap<string, number>;
  policy: OptimizerPolicy;
  mode: BuyMode;
  variants?: PlanVariant[];
  maxOrdersCap?: number;
}

interface OfferRec {
  index: number;
  offer: Offer;
  want: Want;
  wantIndex: number;
  seller: Seller;
  sellerId: string;
  sellerIndex: number;
  sellerInfo: SellerInfo;
  methods: readonly ShippingMethod[];
  stock: number;
  lineEta: number | null;
}

interface WantDiag {
  want: Want;
  wantIndex: number;
  requested: number;
  rawOfferCount: number;
  routeOfferCount: number;
  eligibleStock: number;
}

interface Context {
  input: OptimizeInput;
  policy: OptimizerPolicy;
  diags: WantDiag[];
  recs: OfferRec[];
  byWant: Map<string, OfferRec[]>;
  recsBySeller: OfferRec[][];
  sellers: Seller[];
  sellerInfos: SellerInfo[];
  sellerMethods: Array<readonly ShippingMethod[]>;
  sellerOrder: number[];
  sellerStock: number[];
  generatedAt: string;
}

interface State {
  q: number[];
  missingQty: number;
  orderCount: number;
  totalCents: number;
  itemsCents: number;
  shippingCents: number;
  trusteeCents: number;
  cardCount: number;
  slowestEtaDays: number | null;
  etaKey: number;
  allocationKey: string;
}

interface Budget {
  left: number;
}

interface Session {
  ctx: Context;
  seeds: number[][];
  seedStates: State[] | null;
  emptyState: State;
  cache: Map<string, State>;
  bestCheapestState: State | null;
}

const VARIANT_ORDER: readonly PlanVariant[] = [
  'cheapest',
  'fewer-orders',
  'fastest',
];

// Plans are produced deterministically; the timestamp identifies the loaded
// optimizer session rather than varying between individual evaluations.
const GENERATED_AT = new Date().toISOString();

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeEta(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

function normalizeRequested(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function lookupTable<T>(
  table: ReadonlyMap<string, T>,
  key: string,
): T | undefined {
  const asObject = table as unknown as {
    get?: (entry: string) => T | undefined;
    [entry: string]: unknown;
  };
  if (typeof asObject.get === 'function') return asObject.get(key);
  return asObject[key] as T | undefined;
}

function qtyAt(q: number[], index: number): number {
  return q[index] ?? 0;
}

function addQty(q: number[], index: number, amount: number): void {
  q[index] = qtyAt(q, index) + amount;
}

function zeroAllocation(ctx: Context): number[] {
  return new Array<number>(ctx.recs.length).fill(0);
}

function makeBasket(
  ctx: Context,
  itemsValueCents: number,
  cardCount: number,
  sellerInfo: SellerInfo,
) {
  const reasons = trackingReasons(itemsValueCents, sellerInfo, ctx.policy);

  return {
    itemsValueCents,
    cardCount,
    estimatedWeightG: estimateWeightG(cardCount, ctx.policy),
    trackingRequired: reasons.length > 0,
    trackingReasons: reasons,
  };
}

function sellerStats(
  ctx: Context,
  q: number[],
  sellerIndex: number,
): { itemsCents: number; cardCount: number } {
  let itemsCents = 0;
  let cardCount = 0;

  for (const rec of ctx.recsBySeller[sellerIndex] ?? []) {
    const count = qtyAt(q, rec.index);
    if (count <= 0) continue;
    itemsCents += rec.offer.priceCents * count;
    cardCount += count;
  }

  return { itemsCents, cardCount };
}

function openSellerIndices(ctx: Context, q: number[]): number[] {
  const open: number[] = [];

  for (let sellerIndex = 0; sellerIndex < ctx.sellers.length; sellerIndex++) {
    const stats = sellerStats(ctx, q, sellerIndex);
    if (stats.cardCount > 0) open.push(sellerIndex);
  }

  return open;
}

/**
 * Largest number of copies we can add to one seller basket without making the
 * basket unshippable. Viability shrinks monotonically as value/weight/card count
 * grow, so a binary search is safe.
 */
function maxAddable(
  ctx: Context,
  q: number[],
  rec: OfferRec,
  desired: number,
): number {
  const room = rec.stock - qtyAt(q, rec.index);
  if (room <= 0 || desired <= 0) return 0;

  const limit = Math.min(Math.floor(desired), room);
  const seller = ctx.sellerInfos[rec.sellerIndex];
  if (!seller) return 0;

  const base = sellerStats(ctx, q, rec.sellerIndex);

  const canAdd = (delta: number): boolean => {
    const basket = makeBasket(
      ctx,
      base.itemsCents + rec.offer.priceCents * delta,
      base.cardCount + delta,
      seller,
    );
    return (
      selectShippingMethod(
        ctx.sellerMethods[rec.sellerIndex] ?? [],
        basket,
        ctx.policy,
      ) !== null
    );
  };

  if (!canAdd(0)) return 0;

  let low = 0;
  let high = limit;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (canAdd(mid)) low = mid;
    else high = mid - 1;
  }

  return low;
}

function priceComparator(a: OfferRec, b: OfferRec): number {
  return (
    a.offer.priceCents - b.offer.priceCents ||
    compareEtaForSort(a.lineEta, b.lineEta) ||
    codeUnitCompare(a.offer.id, b.offer.id) ||
    codeUnitCompare(a.sellerId, b.sellerId)
  );
}

function compareEtaForSort(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function fastestComparator(a: OfferRec, b: OfferRec, defaultEtaDays: number): number {
  return (
    (a.lineEta ?? defaultEtaDays) - (b.lineEta ?? defaultEtaDays) ||
    a.offer.priceCents - b.offer.priceCents ||
    codeUnitCompare(a.offer.id, b.offer.id) ||
    codeUnitCompare(a.sellerId, b.sellerId)
  );
}

function fillRemaining(
  ctx: Context,
  q: number[],
  remaining: number[],
  comparator: (a: OfferRec, b: OfferRec) => number,
  excludeSellerIndex?: number,
): void {
  const wantOrder = ctx.diags
    .map((_, index) => index)
    .filter((index) => (remaining[index] ?? 0) > 0)
    .sort(
      (a, b) =>
        (remaining[b] ?? 0) - (remaining[a] ?? 0) ||
        codeUnitCompare(ctx.diags[a]?.want.id ?? '', ctx.diags[b]?.want.id ?? ''),
    );

  for (const wantIndex of wantOrder) {
    const diag = ctx.diags[wantIndex];
    if (!diag) continue;

    const candidates = (ctx.byWant.get(diag.want.id) ?? [])
      .filter((rec) => rec.sellerIndex !== excludeSellerIndex)
      .slice()
      .sort(comparator);

    for (const rec of candidates) {
      const wantRemaining = remaining[wantIndex] ?? 0;
      if (wantRemaining <= 0) break;

      const room = rec.stock - qtyAt(q, rec.index);
      if (room <= 0) continue;

      const add = maxAddable(ctx, q, rec, Math.min(wantRemaining, room));
      if (add <= 0) continue;

      addQty(q, rec.index, add);
      remaining[wantIndex] = wantRemaining - add;
    }
  }
}

function priceSeed(ctx: Context): number[] {
  const q = zeroAllocation(ctx);
  const remaining = ctx.diags.map((diag) => diag.requested);
  fillRemaining(ctx, q, remaining, priceComparator);
  return q;
}

function fastestSeed(ctx: Context): number[] {
  const q = zeroAllocation(ctx);
  const remaining = ctx.diags.map((diag) => diag.requested);
  fillRemaining(ctx, q, remaining, (a, b) =>
    fastestComparator(a, b, ctx.policy.defaultEtaDays),
  );
  return q;
}

function shippingSeed(ctx: Context): number[] {
  const fallback = priceSeed(ctx);
  let shares = new Array<number>(ctx.sellers.length).fill(0);
  let bestState: State | null = null;
  let bestQ: number[] | null = null;
  let previousKey = '';

  for (let iteration = 0; iteration < 5; iteration++) {
    const q = zeroAllocation(ctx);
    const remaining = ctx.diags.map((diag) => diag.requested);

    fillRemaining(ctx, q, remaining, (a, b) => {
      const aShare = shares[a.sellerIndex] ?? 0;
      const bShare = shares[b.sellerIndex] ?? 0;
      return (
        a.offer.priceCents + aShare - (b.offer.priceCents + bShare) ||
        a.offer.priceCents - b.offer.priceCents ||
        compareEtaForSort(a.lineEta, b.lineEta) ||
        codeUnitCompare(a.offer.id, b.offer.id)
      );
    });

    const state = evaluateState(ctx, q);
    if (!state) break;

    if (
      !bestState ||
      compareStates(state, bestState, 'cheapest', ctx.policy.defaultEtaDays) < 0
    ) {
      bestState = state;
      bestQ = q;
    }

    if (state.allocationKey === previousKey) break;
    previousKey = state.allocationKey;

    const nextShares = new Array<number>(ctx.sellers.length).fill(0);
    for (const sellerIndex of openSellerIndices(ctx, q)) {
      const stats = sellerStats(ctx, q, sellerIndex);
      const seller = ctx.sellerInfos[sellerIndex];
      if (!seller || stats.cardCount <= 0) continue;

      const basket = makeBasket(
        ctx,
        stats.itemsCents,
        stats.cardCount,
        seller,
      );
      const method = selectShippingMethod(
        ctx.sellerMethods[sellerIndex] ?? [],
        basket,
        ctx.policy,
      );
      if (!method) continue;

      nextShares[sellerIndex] = Math.ceil(
        (method.priceCents + method.trusteeFeeCents) / stats.cardCount,
      );
    }

    shares = nextShares;
  }

  return bestQ ?? fallback;
}

function alternativeMinPrice(
  ctx: Context,
  wantId: string,
  excludeSellerIndex: number,
): number {
  let min = Number.POSITIVE_INFINITY;

  for (const rec of ctx.byWant.get(wantId) ?? []) {
    if (rec.sellerIndex === excludeSellerIndex) continue;
    if (rec.stock <= 0) continue;
    if (rec.offer.priceCents < min) min = rec.offer.priceCents;
  }

  return min;
}

/**
 * Seed that deliberately opens one seller with at most `cap` cards, then fills
 * the rest from the cheapest alternatives. This is what lets the search find
 * "four cheap cross-border cards in a letter + the rest at home" directly.
 */
function cappedSellerSeed(
  ctx: Context,
  sellerIndex: number,
  cap: number,
): number[] {
  const q = zeroAllocation(ctx);
  const remaining = ctx.diags.map((diag) => diag.requested);
  const seller = ctx.sellers[sellerIndex];
  if (!seller) return q;

  const alternativeMin = new Map<string, number>();
  for (const diag of ctx.diags) {
    alternativeMin.set(
      diag.want.id,
      alternativeMinPrice(ctx, diag.want.id, sellerIndex),
    );
  }

  const scored = (ctx.recsBySeller[sellerIndex] ?? [])
    .filter((rec) => rec.stock > 0 && (remaining[rec.wantIndex] ?? 0) > 0)
    .map((rec) => {
      const alternative = alternativeMin.get(rec.want.id);
      const advantage =
        alternative === undefined || !Number.isFinite(alternative)
          ? Number.MAX_SAFE_INTEGER
          : alternative - rec.offer.priceCents;
      return { rec, advantage };
    })
    .sort(
      (a, b) =>
        b.advantage - a.advantage ||
        a.rec.offer.priceCents - b.rec.offer.priceCents ||
        codeUnitCompare(a.rec.want.id, b.rec.want.id) ||
        codeUnitCompare(a.rec.offer.id, b.rec.offer.id),
    );

  let capLeft = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : Infinity;

  for (const { rec } of scored) {
    if (capLeft <= 0) break;
    const wantRemaining = remaining[rec.wantIndex] ?? 0;
    if (wantRemaining <= 0) continue;

    const room = rec.stock - qtyAt(q, rec.index);
    if (room <= 0) continue;

    const take = Math.min(capLeft, wantRemaining, room);
    if (take <= 0) continue;

    const add = maxAddable(ctx, q, rec, take);
    if (add <= 0) continue;

    addQty(q, rec.index, add);
    remaining[rec.wantIndex] = wantRemaining - add;
    capLeft -= add;
  }

  fillRemaining(
    ctx,
    q,
    remaining,
    priceComparator,
    Number.isFinite(cap) ? sellerIndex : undefined,
  );

  return q;
}

function buildSeeds(ctx: Context): number[][] {
  const seeds: number[][] = [];
  const seen = new Set<string>();

  const add = (q: number[]): void => {
    const key = q.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push(q);
  };

  add(priceSeed(ctx));
  add(shippingSeed(ctx));
  add(fastestSeed(ctx));

  for (const sellerIndex of ctx.sellerOrder.slice(0, 6)) {
    add(cappedSellerSeed(ctx, sellerIndex, Number.POSITIVE_INFINITY));
  }

  const sellersById = ctx.sellerOrder
    .slice()
    .sort((a, b) =>
      codeUnitCompare(ctx.sellers[a]?.id ?? '', ctx.sellers[b]?.id ?? ''),
    );
  for (const sellerIndex of sellersById) {
    add(cappedSellerSeed(ctx, sellerIndex, 4));
  }

  for (const sellerIndex of ctx.sellerOrder.slice(0, 4)) {
    const stock = ctx.sellerStock[sellerIndex] ?? 0;
    if (stock >= 17) add(cappedSellerSeed(ctx, sellerIndex, 17));
    if (stock >= 40) add(cappedSellerSeed(ctx, sellerIndex, 40));
  }

  return seeds;
}

/**
 * Internal allocation score. This is deliberately cheaper than building a
 * public Plan: local search evaluates thousands of these.
 */
function evaluateState(ctx: Context, q: number[]): State | null {
  if (q.length !== ctx.recs.length) return null;

  const sellerCount = ctx.sellers.length;
  const sellerItems = new Array<number>(sellerCount).fill(0);
  const sellerCards = new Array<number>(sellerCount).fill(0);
  const sellerEtaMax = new Array<number>(sellerCount).fill(-1);
  const sellerEtaUnknown = new Array<boolean>(sellerCount).fill(false);
  const filledByWant = new Array<number>(ctx.diags.length).fill(0);

  for (const rec of ctx.recs) {
    const count = qtyAt(q, rec.index);
    if (count === 0) continue;
    if (!Number.isFinite(count) || count < 0 || count > rec.stock) return null;
    if (!Number.isInteger(count)) return null;

    filledByWant[rec.wantIndex] = (filledByWant[rec.wantIndex] ?? 0) + count;
    sellerItems[rec.sellerIndex] =
      (sellerItems[rec.sellerIndex] ?? 0) + rec.offer.priceCents * count;
    sellerCards[rec.sellerIndex] =
      (sellerCards[rec.sellerIndex] ?? 0) + count;

    if (rec.lineEta === null) {
      sellerEtaUnknown[rec.sellerIndex] = true;
    } else if (rec.lineEta > (sellerEtaMax[rec.sellerIndex] ?? -1)) {
      sellerEtaMax[rec.sellerIndex] = rec.lineEta;
    }
  }

  let itemsCents = 0;
  let shippingCents = 0;
  let trusteeCents = 0;
  let orderCount = 0;
  let cardCount = 0;
  let planEtaUnknown = false;
  let planEtaMax = -1;

  for (let sellerIndex = 0; sellerIndex < sellerCount; sellerIndex++) {
    const cards = sellerCards[sellerIndex] ?? 0;
    if (cards <= 0) continue;

    const sellerInfo = ctx.sellerInfos[sellerIndex];
    if (!sellerInfo) return null;

    const basket = makeBasket(
      ctx,
      sellerItems[sellerIndex] ?? 0,
      cards,
      sellerInfo,
    );
    const method = selectShippingMethod(
      ctx.sellerMethods[sellerIndex] ?? [],
      basket,
      ctx.policy,
    );
    if (!method) return null;
    if (basket.itemsValueCents < sellerInfo.minOrderValueCents) return null;

    const maxSellerEta = sellerEtaMax[sellerIndex] ?? -1;
    const orderEta =
      sellerEtaUnknown[sellerIndex] || maxSellerEta < 0 ? null : maxSellerEta;

    if (orderEta === null) planEtaUnknown = true;
    else planEtaMax = Math.max(planEtaMax, orderEta);

    itemsCents += basket.itemsValueCents;
    shippingCents += method.priceCents;
    trusteeCents += method.trusteeFeeCents;
    cardCount += cards;
    orderCount++;
  }

  let missingQty = 0;
  for (let index = 0; index < ctx.diags.length; index++) {
    const requested = ctx.diags[index]?.requested ?? 0;
    const filled = filledByWant[index] ?? 0;
    if (filled < requested) missingQty += requested - filled;
  }

  const slowestEtaDays =
    orderCount === 0 || planEtaUnknown || planEtaMax < 0 ? null : planEtaMax;
  const totalCents = itemsCents + shippingCents + trusteeCents;
  const defaultEta = Number.isFinite(ctx.policy.defaultEtaDays)
    ? Math.max(0, Math.round(ctx.policy.defaultEtaDays))
    : 14;

  return {
    q,
    missingQty,
    orderCount,
    totalCents,
    itemsCents,
    shippingCents,
    trusteeCents,
    cardCount,
    slowestEtaDays,
    etaKey: slowestEtaDays ?? defaultEta,
    allocationKey: q.join(','),
  };
}

function compareStates(
  a: State,
  b: State,
  variant: PlanVariant,
  defaultEtaDays: number,
): number {
  if (a.missingQty !== b.missingQty) return a.missingQty - b.missingQty;

  if (variant === 'fewer-orders') {
    if (a.orderCount !== b.orderCount) return a.orderCount - b.orderCount;
    if (a.totalCents !== b.totalCents) return a.totalCents - b.totalCents;
    return codeUnitCompare(a.allocationKey, b.allocationKey);
  }

  if (variant === 'fastest') {
    const aEta = a.etaKey;
    const bEta = b.etaKey;
    if (aEta !== bEta) return aEta - bEta;
    if (a.totalCents !== b.totalCents) return a.totalCents - b.totalCents;
    if (a.orderCount !== b.orderCount) return a.orderCount - b.orderCount;
    return codeUnitCompare(a.allocationKey, b.allocationKey);
  }

  if (a.totalCents !== b.totalCents) return a.totalCents - b.totalCents;
  if (a.orderCount !== b.orderCount) return a.orderCount - b.orderCount;
  return codeUnitCompare(a.allocationKey, b.allocationKey);
}

function spend(budget: Budget): boolean {
  if (budget.left <= 0) return false;
  budget.left--;
  return true;
}

function transferQuantities(
  ctx: Context,
  state: State,
  source: OfferRec,
  target: OfferRec,
): number[] {
  const sourceRoom = qtyAt(state.q, source.index);
  const targetRoom = target.stock - qtyAt(state.q, target.index);
  const max = Math.min(sourceRoom, targetRoom);
  if (max <= 0) return [];

  const values = new Set<number>([1, max, sourceRoom]);
  const sourceStats = sellerStats(ctx, state.q, source.sellerIndex);
  const targetStats = sellerStats(ctx, state.q, target.sellerIndex);

  if (source.sellerIndex !== target.sellerIndex) {
    for (const cap of [4, 17, 40]) {
      if (sourceStats.cardCount > cap) {
        values.add(sourceStats.cardCount - cap);
      }
      if (targetStats.cardCount < cap) {
        values.add(cap - targetStats.cardCount);
      }
    }

    if (
      sourceStats.itemsCents > ctx.policy.trackingThresholdCents &&
      source.offer.priceCents > 0
    ) {
      values.add(
        Math.ceil(
          (sourceStats.itemsCents - ctx.policy.trackingThresholdCents) /
            source.offer.priceCents,
        ),
      );
    }

    const valueTiers = (ctx.sellerMethods[source.sellerIndex] ?? [])
      .map((method) => method.maxValueCents)
      .filter((tier) => tier < sourceStats.itemsCents)
      .sort((a, b) => b - a)
      .slice(0, 2);

    if (source.offer.priceCents > 0) {
      for (const tier of valueTiers) {
        values.add(
          Math.ceil(
            (sourceStats.itemsCents - tier) / source.offer.priceCents,
          ),
        );
      }
    }

    const estimatedWeight = estimateWeightG(
      sourceStats.cardCount,
      ctx.policy,
    );
    const effectiveGrams =
      ctx.policy.gramsPerCard * ctx.policy.weightSafetyFactor;
    if (effectiveGrams > 0) {
      const weightTiers = (ctx.sellerMethods[source.sellerIndex] ?? [])
        .map((method) => method.maxWeightG)
        .filter((tier) => tier < estimatedWeight)
        .sort((a, b) => b - a)
        .slice(0, 2);

      for (const tier of weightTiers) {
        const needed = Math.ceil(
          sourceStats.cardCount -
            (tier - ctx.policy.extraPackagingG) / effectiveGrams,
        );
        values.add(needed);
        values.add(needed + 1);
      }
    }
  }

  const quantities: number[] = [];
  for (const value of values) {
    const clamped = Math.max(1, Math.min(max, Math.ceil(value)));
    if (!quantities.includes(clamped)) quantities.push(clamped);
  }
  quantities.sort((a, b) => a - b);
  return quantities;
}

function transferTargets(
  ctx: Context,
  state: State,
  source: OfferRec,
  variant: PlanVariant,
): OfferRec[] {
  const candidates = (ctx.byWant.get(source.want.id) ?? []).filter(
    (rec) =>
      rec.index !== source.index &&
      rec.stock - qtyAt(state.q, rec.index) > 0,
  );

  const compare =
    variant === 'fastest'
      ? (a: OfferRec, b: OfferRec) =>
          fastestComparator(a, b, ctx.policy.defaultEtaDays)
      : priceComparator;

  candidates.sort(compare);

  const picked = new Map<number, OfferRec>();
  for (const rec of candidates) {
    if (picked.size >= 8) break;
    picked.set(rec.index, rec);
  }

  const cheapestBySeller = new Map<number, OfferRec>();
  for (const rec of candidates) {
    if (!cheapestBySeller.has(rec.sellerIndex)) {
      cheapestBySeller.set(rec.sellerIndex, rec);
    }
  }
  for (const rec of cheapestBySeller.values()) {
    picked.set(rec.index, rec);
  }

  return [...picked.values()].sort(compare);
}

function closeSellerStates(
  ctx: Context,
  state: State,
  sellerIndex: number,
  budget: Budget,
): State[] {
  const open = new Set(openSellerIndices(ctx, state.q));
  const lineRecs = (ctx.recsBySeller[sellerIndex] ?? [])
    .filter((rec) => qtyAt(state.q, rec.index) > 0)
    .sort(
      (a, b) =>
        qtyAt(state.q, b.index) - qtyAt(state.q, a.index) ||
        b.offer.priceCents - a.offer.priceCents ||
        codeUnitCompare(a.want.id, b.want.id) ||
        codeUnitCompare(a.offer.id, b.offer.id),
    );

  if (lineRecs.length === 0) return [];

  const strategies: Array<(a: OfferRec, b: OfferRec) => number> = [
    (a, b) =>
      a.offer.priceCents - b.offer.priceCents ||
      compareEtaForSort(a.lineEta, b.lineEta) ||
      codeUnitCompare(a.offer.id, b.offer.id),
    (a, b) =>
      compareEtaForSort(a.lineEta, b.lineEta) ||
      a.offer.priceCents - b.offer.priceCents ||
      codeUnitCompare(a.offer.id, b.offer.id),
  ];

  const states: State[] = [];

  for (const compare of strategies) {
    if (!spend(budget)) break;

    const candidate = state.q.slice();
    let complete = true;

    for (const source of lineRecs) {
      let remaining = qtyAt(candidate, source.index);
      if (remaining <= 0) continue;

      const targets = (ctx.byWant.get(source.want.id) ?? [])
        .filter(
          (rec) =>
            rec.sellerIndex !== sellerIndex &&
            open.has(rec.sellerIndex) &&
            rec.stock - qtyAt(candidate, rec.index) > 0,
        )
        .sort(compare);

      for (const target of targets) {
        if (remaining <= 0) break;
        const room = target.stock - qtyAt(candidate, target.index);
        if (room <= 0) continue;

        const add = maxAddable(
          ctx,
          candidate,
          target,
          Math.min(remaining, room),
        );
        if (add <= 0) continue;

        candidate[source.index] = qtyAt(candidate, source.index) - add;
        addQty(candidate, target.index, add);
        remaining -= add;
      }

      if (remaining > 0) {
        complete = false;
        break;
      }
    }

    if (!complete) continue;
    if ((ctx.recsBySeller[sellerIndex] ?? []).some((rec) => qtyAt(candidate, rec.index) > 0)) {
      continue;
    }

    const evaluated = evaluateState(ctx, candidate);
    if (evaluated) states.push(evaluated);
  }

  return states;
}

function consolidateToSellerState(
  ctx: Context,
  state: State,
  targetSellerIndex: number,
  budget: Budget,
): State | null {
  if (!spend(budget)) return null;

  const candidate = state.q.slice();
  const sourceSellers = openSellerIndices(ctx, candidate).filter(
    (sellerIndex) => sellerIndex !== targetSellerIndex,
  );

  for (const sourceSellerIndex of sourceSellers) {
    const lines = (ctx.recsBySeller[sourceSellerIndex] ?? [])
      .filter((rec) => qtyAt(candidate, rec.index) > 0)
      .sort(
        (a, b) =>
          qtyAt(candidate, b.index) - qtyAt(candidate, a.index) ||
          b.offer.priceCents - a.offer.priceCents ||
          codeUnitCompare(a.offer.id, b.offer.id),
      );

    for (const source of lines) {
      let remaining = qtyAt(candidate, source.index);

      const targets = (ctx.byWant.get(source.want.id) ?? [])
        .filter(
          (rec) =>
            rec.sellerIndex === targetSellerIndex &&
            rec.stock - qtyAt(candidate, rec.index) > 0,
        )
        .sort(priceComparator);

      for (const target of targets) {
        if (remaining <= 0) break;
        const room = target.stock - qtyAt(candidate, target.index);
        if (room <= 0) continue;

        const add = maxAddable(
          ctx,
          candidate,
          target,
          Math.min(remaining, room),
        );
        if (add <= 0) continue;

        candidate[source.index] = qtyAt(candidate, source.index) - add;
        addQty(candidate, target.index, add);
        remaining -= add;
      }

      if (remaining > 0) return null;
    }
  }

  return evaluateState(ctx, candidate);
}

function macroCandidates(
  ctx: Context,
  state: State,
  budget: Budget,
): State[] {
  const states: State[] = [];
  const open = openSellerIndices(ctx, state.q);

  for (const sellerIndex of open) {
    states.push(...closeSellerStates(ctx, state, sellerIndex, budget));
    if (budget.left <= 0) return states;
  }

  const targets = ctx.sellerOrder.slice(0, 8);
  for (const targetSellerIndex of targets) {
    if (open.length === 1 && open[0] === targetSellerIndex) continue;
    const consolidated = consolidateToSellerState(
      ctx,
      state,
      targetSellerIndex,
      budget,
    );
    if (consolidated) states.push(consolidated);
    if (budget.left <= 0) break;
  }

  return states;
}

function searchFrom(
  ctx: Context,
  start: State,
  variant: PlanVariant,
  maxOrders: number | undefined,
  budgetPoints: number,
): State {
  const budget: Budget = { left: Math.max(0, budgetPoints) };
  const iterations = Math.max(
    0,
    Math.min(ctx.policy.maxIterations, 12),
  );
  let current = start;

  for (let iteration = 0; iteration < iterations && budget.left > 0; iteration++) {
    let best = current;
    let bestQ: number[] | null = null;

    const consider = (candidate: State | null): void => {
      if (!candidate) return;
      if (maxOrders !== undefined && candidate.orderCount > maxOrders) return;
      if (
        compareStates(candidate, best, variant, ctx.policy.defaultEtaDays) < 0
      ) {
        best = candidate;
        bestQ = candidate.q;
      }
    };

    for (const candidate of macroCandidates(ctx, current, budget)) {
      consider(candidate);
    }

    if (budget.left > 0) {
      outer: for (const diag of ctx.diags) {
        const wantRecs = ctx.byWant.get(diag.want.id) ?? [];
        const sources = wantRecs
          .filter((rec) => qtyAt(current.q, rec.index) > 0)
          .sort(
            (a, b) =>
              qtyAt(current.q, b.index) - qtyAt(current.q, a.index) ||
              a.offer.priceCents - b.offer.priceCents ||
              codeUnitCompare(a.offer.id, b.offer.id),
          );

        for (const source of sources) {
          const targets = transferTargets(ctx, current, source, variant);

          for (const target of targets) {
            for (const quantity of transferQuantities(
              ctx,
              current,
              source,
              target,
            )) {
              if (budget.left <= 0) break outer;
              if (!spend(budget)) break outer;

              const candidate = current.q.slice();
              candidate[source.index] =
                qtyAt(candidate, source.index) - quantity;
              addQty(candidate, target.index, quantity);

              consider(evaluateState(ctx, candidate));
            }
          }
        }
      }
    }

    if (!bestQ) break;
    current = best;
  }

  return current;
}

function reduceToCap(
  ctx: Context,
  state: State,
  cap: number,
): State | null {
  let current = state;
  let guard = 0;

  while (current.orderCount > cap && guard < ctx.sellers.length + 1) {
    guard++;
    const budget: Budget = { left: 600 };
    const candidates = macroCandidates(ctx, current, budget).filter(
      (candidate) =>
        candidate.orderCount < current.orderCount &&
        candidate.missingQty <= current.missingQty,
    );

    if (candidates.length === 0) return null;

    candidates.sort((a, b) =>
      compareStates(a, b, 'cheapest', ctx.policy.defaultEtaDays),
    );
    const next = candidates[0];
    if (!next) return null;
    current = next;
  }

  return current.orderCount <= cap ? current : null;
}

function getSeedStates(session: Session): State[] {
  if (session.seedStates) return session.seedStates;

  const states: State[] = [];
  const seen = new Set<string>();

  for (const seed of session.seeds) {
    const state = evaluateState(session.ctx, seed);
    if (!state) continue;
    if (seen.has(state.allocationKey)) continue;
    seen.add(state.allocationKey);
    states.push(state);
  }

  session.seedStates = states;
  return states;
}

function solve(
  session: Session,
  variant: PlanVariant,
  maxOrders?: number,
): State {
  const cacheKey = `${variant}|${maxOrders ?? 'all'}`;
  const cached = session.cache.get(cacheKey);
  if (cached) return cached;

  const ctx = session.ctx;
  const seedStates = getSeedStates(session);
  const candidates: State[] = [];
  const overCap: State[] = [];
  const statesToConsider = session.bestCheapestState
    ? [...seedStates, session.bestCheapestState]
    : seedStates;

  for (const state of statesToConsider) {
    if (maxOrders !== undefined && state.orderCount > maxOrders) {
      overCap.push(state);
    } else {
      candidates.push(state);
    }
  }

  overCap.sort((a, b) =>
    compareStates(a, b, variant, ctx.policy.defaultEtaDays),
  );

  const reduceLimit = maxOrders === undefined ? overCap.length : 8;
  for (const state of overCap.slice(0, reduceLimit)) {
    const reduced = reduceToCap(ctx, state, maxOrders ?? 0);
    if (reduced) candidates.push(reduced);
  }

  candidates.push(session.emptyState);

  const unique = new Map<string, State>();
  for (const state of candidates) {
    const existing = unique.get(state.allocationKey);
    if (!existing) unique.set(state.allocationKey, state);
  }

  const pool = [...unique.values()].sort((a, b) =>
    compareStates(a, b, variant, ctx.policy.defaultEtaDays),
  );

  let best = pool[0] ?? session.emptyState;
  const startLimit = maxOrders === undefined ? 6 : 3;
  const budgetPerStart = maxOrders === undefined ? 2600 : 900;

  for (const start of pool.slice(0, startLimit)) {
    const improved = searchFrom(
      ctx,
      start,
      variant,
      maxOrders,
      budgetPerStart,
    );
    if (
      compareStates(improved, best, variant, ctx.policy.defaultEtaDays) < 0
    ) {
      best = improved;
    }
  }

  session.cache.set(cacheKey, best);

  if (
    variant === 'cheapest' &&
    (!session.bestCheapestState ||
      compareStates(
        best,
        session.bestCheapestState,
        'cheapest',
        ctx.policy.defaultEtaDays,
      ) < 0)
  ) {
    session.bestCheapestState = best;
  }

  return best;
}

function buildCurve(session: Session, maxOrders?: number): CurvePoint[] {
  const ctx = session.ctx;
  const requestedLimit = maxOrders ?? 12;
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) return [];

  const limit = Math.min(Math.floor(requestedLimit), ctx.sellers.length);
  if (limit <= 0) return [];

  const unrestricted = solve(session, 'cheapest');
  const statesByCap = new Map<number, State>();

  for (let cap = 1; cap <= limit; cap++) {
    if (unrestricted.orderCount <= cap) {
      statesByCap.set(cap, unrestricted);
    } else {
      statesByCap.set(cap, solve(session, 'cheapest', cap));
    }
  }

  const allStates = [...statesByCap.values()];
  if (session.bestCheapestState) allStates.push(session.bestCheapestState);
  const points: CurvePoint[] = [];

  for (let cap = 1; cap <= limit; cap++) {
    const feasible = allStates
      .filter((state) => state.orderCount <= cap && state.missingQty === 0)
      .sort(
        (a, b) =>
          a.totalCents - b.totalCents ||
          a.orderCount - b.orderCount ||
          codeUnitCompare(a.allocationKey, b.allocationKey),
      );

    const best = feasible[0];
    points.push({
      maxOrders: cap,
      totalCents: best ? best.totalCents : null,
      feasible: Boolean(best),
    });
  }

  return points;
}

function createContext(input: OptimizeInput): Context {
  const policy = input.policy;
  const buyerCountryId = input.buyerCountryId;
  const wants = input.wants
    .filter((want) => want && typeof want.id === 'string' && want.id.length > 0)
    .slice()
    .sort((a, b) => codeUnitCompare(a.id, b.id));

  const recs: OfferRec[] = [];
  const diags: WantDiag[] = [];
  const routeCache = new Map<string, readonly ShippingMethod[] | null>();
  const routeEtaCache = new Map<string, number | null>();

  const getRoute = (
    countryId: number,
  ): readonly ShippingMethod[] | null => {
    const key = `${countryId}->${buyerCountryId}`;
    const cached = routeCache.get(key);
    if (cached !== undefined) return cached;

    const methods = lookupTable(input.shipping, key);
    if (!methods || methods.length === 0 || methods.every((m) => m.isVirtual)) {
      routeCache.set(key, null);
      return null;
    }

    routeCache.set(key, methods);
    return methods;
  };

  const getRouteEta = (countryId: number): number | null => {
    const key = `${countryId}->${buyerCountryId}`;
    const cached = routeEtaCache.get(key);
    if (cached !== undefined) return cached;

    const eta = normalizeEta(lookupTable(input.routeEta, key));
    routeEtaCache.set(key, eta);
    return eta;
  };

  wants.forEach((want, wantIndex) => {
    const requested = normalizeRequested(want.quantity);
    const offers = Array.isArray(want.offers) ? want.offers : [];
    let routeOfferCount = 0;
    let eligibleStock = 0;

    for (const offer of offers) {
      if (!offer || typeof offer !== 'object') continue;

      const seller = offer.seller;
      if (!seller || typeof seller !== 'object') continue;

      const countryId = seller.countryId;
      if (
        typeof countryId !== 'number' ||
        !Number.isFinite(countryId) ||
        countryId <= 0
      ) {
        continue;
      }

      const methods = getRoute(countryId);
      if (!methods) continue;
      routeOfferCount++;

      if (typeof seller.id !== 'string' || seller.id.length === 0) continue;
      if (typeof offer.id !== 'string' || offer.id.length === 0) continue;
      if (
        typeof offer.priceCents !== 'number' ||
        !Number.isFinite(offer.priceCents) ||
        offer.priceCents < 0
      ) {
        continue;
      }
      if (
        typeof offer.stock !== 'number' ||
        !Number.isFinite(offer.stock) ||
        offer.stock <= 0
      ) {
        continue;
      }

      const stock = Math.floor(offer.stock);
      if (stock <= 0) continue;

      const sellerEta = normalizeEta(seller.etaDays);
      const offerEta = normalizeEta(offer.etaDays);
      const lineEta = offerEta ?? sellerEta ?? getRouteEta(countryId);

      const sellerInfo: SellerInfo = {
        id: seller.id,
        name: typeof seller.name === 'string' ? seller.name : seller.id,
        countryId,
        minOrderValueCents: 0,
        requiresTracking: false,
        etaDays: sellerEta,
      };

      const normalizedSeller: Seller = {
        id: seller.id,
        name: typeof seller.name === 'string' ? seller.name : seller.id,
        country: typeof seller.country === 'string' ? seller.country : '',
        countryId,
        isCommercial: Boolean(seller.isCommercial),
        isPowerseller: Boolean(seller.isPowerseller),
      };
      if (seller.salesCount !== undefined) {
        normalizedSeller.salesCount = seller.salesCount;
      }
      if (seller.rating !== undefined) normalizedSeller.rating = seller.rating;
      if (seller.etaDays !== undefined) {
        normalizedSeller.etaDays = seller.etaDays;
      }

      eligibleStock += stock;
      recs.push({
        index: -1,
        offer,
        want,
        wantIndex,
        seller: normalizedSeller,
        sellerId: seller.id,
        sellerIndex: -1,
        sellerInfo,
        methods,
        stock,
        lineEta,
      });
    }

    diags.push({
      want,
      wantIndex,
      requested,
      rawOfferCount: offers.length,
      routeOfferCount,
      eligibleStock,
    });
  });

  recs.sort(
    (a, b) =>
      codeUnitCompare(a.want.id, b.want.id) ||
      a.offer.priceCents - b.offer.priceCents ||
      codeUnitCompare(a.offer.id, b.offer.id) ||
      codeUnitCompare(a.sellerId, b.sellerId),
  );
  recs.forEach((rec, index) => {
    rec.index = index;
  });

  const sellerById = new Map<
    string,
    { seller: Seller; info: SellerInfo; methods: readonly ShippingMethod[] }
  >();
  for (const rec of recs) {
    if (!sellerById.has(rec.sellerId)) {
      sellerById.set(rec.sellerId, {
        seller: rec.seller,
        info: rec.sellerInfo,
        methods: rec.methods,
      });
    }
  }

  const sellers = [...sellerById.values()]
    .map((entry) => entry.seller)
    .sort((a, b) => codeUnitCompare(a.id, b.id));
  const sellerInfos = sellers.map((seller) => {
    const entry = sellerById.get(seller.id);
    return (
      entry?.info ?? {
        id: seller.id,
        name: seller.name,
        countryId: seller.countryId,
        minOrderValueCents: 0,
        requiresTracking: false,
        etaDays: normalizeEta(seller.etaDays),
      }
    );
  });
  const sellerMethods = sellers.map(
    (seller) => sellerById.get(seller.id)?.methods ?? [],
  );
  const sellerIndexById = new Map(
    sellers.map((seller, index) => [seller.id, index]),
  );

  for (const rec of recs) {
    rec.sellerIndex = sellerIndexById.get(rec.sellerId) ?? -1;
  }

  const recsBySeller = sellers.map(() => [] as OfferRec[]);
  for (const rec of recs) {
    if (rec.sellerIndex >= 0) recsBySeller[rec.sellerIndex]?.push(rec);
  }

  const byWant = new Map<string, OfferRec[]>();
  for (const rec of recs) {
    const list = byWant.get(rec.want.id);
    if (list) list.push(rec);
    else byWant.set(rec.want.id, [rec]);
  }

  const sellerStock = new Array<number>(sellers.length).fill(0);
  for (const rec of recs) {
    if (rec.sellerIndex >= 0) {
      sellerStock[rec.sellerIndex] =
        (sellerStock[rec.sellerIndex] ?? 0) + rec.stock;
    }
  }

  const sellerOrder = sellers
    .map((_, index) => index)
    .sort((a, b) => {
      const aRecs = recsBySeller[a] ?? [];
      const bRecs = recsBySeller[b] ?? [];
      const aCoverage = new Set(aRecs.map((rec) => rec.want.id)).size;
      const bCoverage = new Set(bRecs.map((rec) => rec.want.id)).size;
      if (aCoverage !== bCoverage) return bCoverage - aCoverage;

      const priceScore = (list: OfferRec[]): number => {
        const cheapest = new Map<string, number>();
        for (const rec of list) {
          const current = cheapest.get(rec.want.id);
          if (current === undefined || rec.offer.priceCents < current) {
            cheapest.set(rec.want.id, rec.offer.priceCents);
          }
        }
        let sum = 0;
        for (const price of cheapest.values()) sum += price;
        return sum;
      };

      const aPrice = priceScore(aRecs);
      const bPrice = priceScore(bRecs);
      if (aPrice !== bPrice) return aPrice - bPrice;
      return codeUnitCompare(
        sellers[a]?.id ?? '',
        sellers[b]?.id ?? '',
      );
    });

  return {
    input,
    policy,
    diags,
    recs,
    byWant,
    recsBySeller,
    sellers,
    sellerInfos,
    sellerMethods,
    sellerOrder,
    sellerStock,
    generatedAt: GENERATED_AT,
  };
}

function missingReason(diag: WantDiag): string {
  if (diag.rawOfferCount === 0) return 'no_offer';
  if (diag.routeOfferCount === 0) return 'no_shipping_route';
  if (diag.eligibleStock < diag.requested) return 'insufficient_stock';
  return 'no_feasible_method';
}

function buildMissingLines(ctx: Context, q: number[]): PlanMissing[] {
  const missing: PlanMissing[] = [];

  for (const diag of ctx.diags) {
    let filled = 0;
    for (const rec of ctx.byWant.get(diag.want.id) ?? []) {
      filled += qtyAt(q, rec.index);
    }

    const shortfall = Math.max(0, diag.requested - filled);
    if (shortfall === 0) continue;

    missing.push({
      wantId: diag.want.id,
      name: diag.want.name,
      requested: diag.requested,
      filled,
      shortfall,
      reason: missingReason(diag),
    });
  }

  return missing;
}

function buildPlan(
  ctx: Context,
  state: State,
  variant: PlanVariant,
): Plan {
  const orders: PlanOrder[] = [];

  for (let sellerIndex = 0; sellerIndex < ctx.sellers.length; sellerIndex++) {
    const seller = ctx.sellers[sellerIndex];
    const sellerInfo = ctx.sellerInfos[sellerIndex];
    if (!seller || !sellerInfo) continue;

    const recs = (ctx.recsBySeller[sellerIndex] ?? []).filter(
      (rec) => qtyAt(state.q, rec.index) > 0,
    );
    if (recs.length === 0) continue;

    const lines: PlanLine[] = recs
      .map((rec) => {
        const line: PlanLine = {
          wantId: rec.want.id,
          name: rec.want.name,
          quantity: qtyAt(state.q, rec.index),
          offerId: rec.offer.id,
          condition: rec.offer.condition,
          finish: rec.offer.finish,
          priceCents: rec.offer.priceCents,
        };
        if (rec.offer.productId !== undefined) {
          line.productId = rec.offer.productId;
        }
        if (rec.offer.expansion !== undefined) {
          line.expansion = rec.offer.expansion;
        }
        return line;
      })
      .sort(
        (a, b) =>
          codeUnitCompare(a.wantId, b.wantId) ||
          codeUnitCompare(a.offerId, b.offerId),
      );

    const basket = estimateBasket(lines, sellerInfo, ctx.policy);
    const method = selectShippingMethod(
      ctx.sellerMethods[sellerIndex] ?? [],
      basket,
      ctx.policy,
    );
    if (!method) continue;

    let etaUnknown = false;
    let etaMax = -1;
    for (const rec of recs) {
      if (rec.lineEta === null) etaUnknown = true;
      else if (rec.lineEta > etaMax) etaMax = rec.lineEta;
    }
    const etaDays = etaUnknown || etaMax < 0 ? null : etaMax;

    orders.push({
      seller: { ...seller },
      lines,
      itemsCents: basket.itemsValueCents,
      cardCount: basket.cardCount,
      shippingCents: method.priceCents,
      trusteeCents: method.trusteeFeeCents,
      totalCents:
        basket.itemsValueCents + method.priceCents + method.trusteeFeeCents,
      etaDays,
      shippingMethod: {
        name: method.name,
        isTracked: method.isTracked,
        priceCents: method.priceCents,
      },
    });
  }

  orders.sort((a, b) => codeUnitCompare(a.seller.id, b.seller.id));

  const itemsCents = orders.reduce(
    (sum, order) => sum + order.itemsCents,
    0,
  );
  const shippingCents = orders.reduce(
    (sum, order) => sum + order.shippingCents,
    0,
  );
  const trusteeCents = orders.reduce(
    (sum, order) => sum + order.trusteeCents,
    0,
  );
  const cardCount = orders.reduce(
    (sum, order) => sum + order.cardCount,
    0,
  );

  let slowestEtaDays: number | null = null;
  if (orders.length > 0) {
    let unknown = false;
    let slowest = -1;
    for (const order of orders) {
      if (order.etaDays === null) unknown = true;
      else slowest = Math.max(slowest, order.etaDays);
    }
    slowestEtaDays = unknown || slowest < 0 ? null : slowest;
  }

  const totalCents = itemsCents + shippingCents + trusteeCents;
  const sellerNames = orders
    .map((order) => order.seller.name)
    .sort(codeUnitCompare);
  const id = `${variant}|${sellerNames.join(',')}|${totalCents}`;

  return {
    id,
    variant,
    orders,
    missing: buildMissingLines(ctx, state.q),
    totals: {
      itemsCents,
      shippingCents,
      trusteeCents,
      totalCents,
      orderCount: orders.length,
      cardCount,
      slowestEtaDays,
    },
    mode: ctx.input.mode,
    generatedAt: ctx.generatedAt,
  };
}

function createSession(input: OptimizeInput): Session {
  const ctx = createContext(input);
  const empty = zeroAllocation(ctx);
  const emptyState = evaluateState(ctx, empty);
  if (!emptyState) {
    throw new Error('Unable to evaluate an empty plan');
  }

  return {
    ctx,
    seeds: buildSeeds(ctx),
    seedStates: null,
    emptyState,
    cache: new Map(),
    bestCheapestState: null,
  };
}

/**
 * Optimize a deck into one plan per requested variant plus a max-orders curve.
 * All objectives minimize missing cards first, then their own key.
 */
export function optimize(input: OptimizeInput): OptimizationResult {
  const session = createSession(input);
  const requested = input.variants ?? VARIANT_ORDER;
  const variants: PlanVariant[] = [];
  const seen = new Set<PlanVariant>();

  for (const variant of requested) {
    if (!VARIANT_ORDER.includes(variant) || seen.has(variant)) continue;
    seen.add(variant);
    variants.push(variant);
  }

  // The curve also gives us capped cheap plans; building it first lets the
  // unconstrained cheapest variant benefit from those consolidation paths.
  const maxOrdersCurve = buildCurve(session, input.maxOrdersCap);

  const statesByVariant = new Map<PlanVariant, State>();
  for (const variant of variants) {
    let state = solve(session, variant, input.maxOrdersCap);

    if (variant === 'cheapest') {
      if (input.maxOrdersCap === undefined) {
        if (session.bestCheapestState) state = session.bestCheapestState;
      } else if (
        session.bestCheapestState &&
        session.bestCheapestState.orderCount <= input.maxOrdersCap &&
        compareStates(
          session.bestCheapestState,
          state,
          'cheapest',
          session.ctx.policy.defaultEtaDays,
        ) < 0
      ) {
        state = session.bestCheapestState;
      }
    }

    statesByVariant.set(variant, state);
  }

  // Any plan found for one variant is also a valid candidate for the others.
  // Sharing candidates guarantees the objective ordering properties
  // (cheapest <= fewer-orders cost, fastest <= cheapest ETA, ...).
  const pool = new Map<string, State>();
  const cap = input.maxOrdersCap;
  const addToPool = (state: State | null | undefined): void => {
    if (!state) return;
    if (cap !== undefined && state.orderCount > cap) return;
    if (!pool.has(state.allocationKey)) pool.set(state.allocationKey, state);
  };
  for (const state of statesByVariant.values()) addToPool(state);
  addToPool(session.bestCheapestState);

  for (const variant of variants) {
    let best = statesByVariant.get(variant);
    for (const candidate of pool.values()) {
      if (
        !best ||
        compareStates(
          candidate,
          best,
          variant,
          session.ctx.policy.defaultEtaDays,
        ) < 0
      ) {
        best = candidate;
      }
    }
    if (best) statesByVariant.set(variant, best);
  }

  const plans = variants.map((variant) =>
    buildPlan(
      session.ctx,
      statesByVariant.get(variant) ?? session.emptyState,
      variant,
    ),
  );

  return {
    plans,
    maxOrdersCurve,
  };
}

/**
 * Cost/order trade-off curve. For every cap k it shows the cheapest plan with
 * at most k seller orders. A cap that cannot cover every wanted card is
 * reported as infeasible (`totalCents: null`).
 */
export function buildMaxOrdersCurve(
  input: OptimizeInput,
  maxOrders?: number,
): CurvePoint[] {
  return buildCurve(createSession(input), maxOrders ?? input.maxOrdersCap);
}
