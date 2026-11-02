# Deterministic greedy + local-search optimizer

Research proposal, not production code. Snapshot date: 2026-11-02.

This is the optimizer proposal for turning a Moxfield deck (20–120 cards) into a
Cardmarket cart that minimises the **landed cost** — card prices, per-seller
shipping, and Trustee fees — subject to stock, condition/finish, seller minimum
order value, tracking rules, and an optional cap on the number of orders.

It is deliberately a heuristic. The problem contains fixed-charge facility
location / set cover: opening a seller adds a postage cost, and one extra card
can cross the 25 EUR tracking threshold or a method `maxValue`/`maxWeight` tier
and jump to a much more expensive method. Exact optimisation is not practical
inside a browser extension. The proposal is:

1. Build several deterministic seed allocations.
2. Improve each seed with a local search over quantity transfers and
   seller-level macro moves.
3. Keep the best plan for each requested variant.
4. Derive the max-orders curve by closing sellers one at a time and
   re-optimising under each cap.

Shipping parsing and method viability are defined in
[`README.md`](./README.md) §2–§4; this document focuses on the combinatorial
optimizer.

---

## 1. Inputs and assumptions

### 1.1 What the optimizer receives

- **Wants**: one row per deck requirement, with a quantity. A want is already
  specific about printing, language, finish, and minimum condition. The
  optimizer does **not** choose a different printing, language, condition, or
  finish; it only allocates the requested quantity among eligible offers.
- **Offers**: one row per Cardmarket offer: seller, unit price in EUR cents,
  stock, condition, finish, language, optional seller ETA. Offers have already
  been read from Cardmarket pages.
- **Sellers**: seller country, minimum order value, and a `requiresTracking`
  flag for seller-risk cases (new seller, loss rate, too many unarrived
  shipments). If unknown, leave false and warn.
- **Shipping tables**: normalized method lists for each
  `(sellerCountry, buyerCountry)` pair, plus optional pair-level ETA.
- **Policy**: economics and search limits (grams per card, tracking threshold,
  Trustee rate, letter-cap mode, max orders, search budget).

### 1.2 Hard rules

1. Never substitute a different language, condition, finish, or printing.
2. Never choose a method whose `maxValue` is below the basket's article value.
3. Never choose a method whose `maxWeight` is below the estimated shipment
   weight.
4. If the basket's article value is **strictly greater than 25.00 EUR**, the
   selected method must be tracked. If a seller has `requiresTracking`, the
   basket must be tracked regardless of value.
5. A seller is either open (one order, one shipping charge) or closed. There is
   no such thing as a partial seller order.
6. A seller basket must meet the seller's minimum order value if it is open.
   Assume the minimum applies to the article value, not shipping; verify at
   checkout.
7. Never choose `isVirtual` for physical cards.
8. A plan with missing cards is allowed only if `allowPartial` is true; even
   then, missing cards are reported, never hidden.
9. All money is integer EUR cents; all weights are integer grams; all ETAs are
   integer days. No floating-point money.

---

## 2. TypeScript types

```ts
// ---------- primitives ----------
export type Cents = number;       // integer EUR cents
export type Grams = number;       // integer grams
export type CountryId = number;   // Cardmarket externalId (DE=7, GB=13, ...)
export type WantId = string;
export type OfferId = string;
export type SellerId = string;

export type Condition = 'PO' | 'PL' | 'LP' | 'GD' | 'EX' | 'NM';
export type Finish = 'nonfoil' | 'foil' | 'etched';
export type Language = 'EN';

// ---------- normalized shipping ----------
export interface ShippingMethod {
  methodKey: string;       // stable full-tuple key, never just the name
  name: string;
  isTracked: boolean;
  maxValueCents: Cents;
  maxWeightG: Grams;
  stampPriceRaw: string;
  stampPriceCents: Cents | null; // only when the stamp is in EUR
  priceCents: Cents;       // includes packaging; excludes Trustee
  isLetter: boolean;
  isVirtual: boolean;
}

export interface ShippingTable {
  get(
    fromCountry: CountryId,
    toCountry: CountryId,
  ): readonly ShippingMethod[] | undefined;
}

/** Key is `${fromCountryId}>${toCountryId}`. */
export type RouteEtaTable = ReadonlyMap<string, number>;

// ---------- problem input ----------
export interface Want {
  id: WantId;
  name: string;                  // display only
  quantity: number;              // requested copies
  minCondition: Condition;       // EX by default
  finish: Finish;
  language: Language;
}

export interface Offer {
  id: OfferId;
  wantId: WantId;
  sellerId: SellerId;
  unitPriceCents: Cents;
  stock: number;
  condition: Condition;
  finish: Finish;
  language: Language;
  etaDays?: number;              // seller's total estimate, if known
}

export interface SellerInfo {
  id: SellerId;
  countryId: CountryId;
  minOrderValueCents: Cents;     // 0 if none
  requiresTracking: boolean;     // new seller / loss rate / too many open shipments
  etaDays?: number;              // fallback if an offer has no ETA
}

// ---------- policy ----------
export type PlanVariant = 'cheapest' | 'fewerOrders' | 'fastest';
export type RequestedVariant = PlanVariant | 'maxOrdersCurve';
export type LetterCapacityMode = 'published' | 'weight' | 'conservative';

export interface OptimizerPolicy {
  gramsPerCard: number;            // 2.5 planning estimate
  weightSafetyFactor: number;      // 1.0; use 1.05 for a conservative run
  extraPackagingG: Grams;          // top loaders / cardboard, usually 0 in the base run
  trackingThresholdCents: Cents;   // 2500; strict >
  alwaysTrack: boolean;            // user preference
  trusteeRateBps: number | ((method: ShippingMethod) => number); // 100 = 1%
  minTrusteeFeeCents: Cents;       // 1
  letterCapacityMode: LetterCapacityMode; // 'conservative' (safe default)
  allowPartial: boolean;           // false = full deck required
  maxOffersPerWant: number;        // 10; prune long offer lists
  maxIterations: number;           // 100
  maxEvaluations: number;          // 2_000_000 operation budget
  defaultEtaDays: number;          // 14, used when no seller/route ETA exists
}

export interface OptimizerInput {
  wants: readonly Want[];
  offers: readonly Offer[];
  sellers: readonly SellerInfo[];
  buyerCountryId: CountryId;
  shipping: ShippingTable;
  routeEta: RouteEtaTable;
  policy: OptimizerPolicy;
}

export interface OptimizationRequest {
  input: OptimizerInput;
  variants: readonly RequestedVariant[];
  /** Hard cap for every variant. The curve is truncated to this value. */
  maxOrders?: number;
}

// ---------- output ----------
export type TrackingReason =
  | 'value_over_threshold'
  | 'seller_requires_tracking'
  | 'user_always_track';

export interface SelectedMethod {
  methodKey: string;
  name: string;
  priceCents: Cents;
  trusteeFeeCents: Cents;
  /** price + trustee, for ranking methods only; do not add to plan total twice. */
  comparableTotalCents: Cents;
  maxValueCents: Cents;
  maxWeightG: Grams;
  isTracked: boolean;
  isLetter: boolean;
}

export interface PlannedLine {
  offerId: OfferId;
  wantId: WantId;
  quantity: number;
  unitPriceCents: Cents;
  etaDays?: number;
}

export interface PlannedOrder {
  sellerId: SellerId;
  sellerCountryId: CountryId;
  lines: PlannedLine[];
  itemsValueCents: Cents;
  cardCount: number;
  estimatedWeightG: Grams;
  trackingReasons: TrackingReason[];
  shipping: SelectedMethod;
  slowestEtaDays: number;
  etaEstimated: boolean;
}

export type MissingReason =
  | 'no_offer'
  | 'insufficient_stock'
  | 'no_shipping_route'
  | 'seller_minimum'
  | 'no_feasible_method';

export interface MissingLine {
  wantId: WantId;
  requested: number;
  filled: number;
  shortfall: number;
  reason: MissingReason;
  detail?: string;
}

export type PlanWarning =
  | { code: 'weight_near_limit'; sellerId: SellerId; headroomG: Grams }
  | { code: 'letter_cap_near_limit'; sellerId: SellerId; headroom: number }
  | { code: 'trustee_rate_uncertain'; sellerId: SellerId; lowBps: number; highBps: number }
  | { code: 'eta_unknown'; sellerId: SellerId; assumedDays: number }
  | { code: 'non_eu_customs'; sellerId: SellerId }
  | { code: 'shipping_estimate'; sellerId: SellerId };

export interface PlanTotals {
  itemsCents: Cents;
  shippingCents: Cents;   // sum of method.priceCents (packaging already included)
  trusteeCents: Cents;    // sum of trustee fees
  totalCents: Cents;      // items + shipping + trustee
  orderCount: number;
  cardCount: number;
  slowestEtaDays: number;
}

export interface Plan {
  variant: PlanVariant;
  orders: PlannedOrder[];
  missing: MissingLine[];
  missingQty: number;       // sum of missing.shortfall; comparator key
  coverage: 'complete' | 'partial' | 'infeasible';
  totals: PlanTotals;
  warnings: PlanWarning[];
  /** Stable key for tie-breaking and tests. */
  canonicalKey: string;
}

export interface CurvePoint {
  maxOrders: number;      // the cap this plan satisfies: orderCount <= maxOrders
  plan: Plan | null;      // null when no plan with this cap covers the wants
  feasible: boolean;
}

export interface OptimizationResult {
  plans: Plan[];          // requested variants, each deterministic
  maxOrdersCurve: CurvePoint[];
}
```

### 2.1 Notes on the types

- `Offer.unitPriceCents` must already be the buyer-facing EUR price. Do not
  convert `stampPrice` here; that is a shipping-table concern.
- `SellerInfo.countryId` is the **seller's** country. The shipping key is
  `seller.countryId → buyerCountryId`.
- `Want` is already constrained (English, EX+, chosen printing/finish). If the
  UI allows "any printing" or "any finish", expand that upstream into separate
  wants/offers; the optimizer must not silently mix them.
- `SelectedMethod.comparableTotalCents` is for ranking methods. In
  `PlanTotals`, `shippingCents` and `trusteeCents` are separate; do not sum
  `comparableTotalCents` into the plan total as well.

---

## 3. Cost and feasibility functions

### 3.1 Weight and letter capacity

```ts
export function estimateWeightG(
  cardCount: number,
  policy: OptimizerPolicy,
): Grams {
  return (
    Math.ceil(cardCount * policy.gramsPerCard * policy.weightSafetyFactor) +
    policy.extraPackagingG
  );
}

export function letterCardCapacity(
  method: ShippingMethod,
  policy: OptimizerPolicy,
): number {
  if (!method.isLetter) return Number.POSITIVE_INFINITY;

  const effectiveGramsPerCard =
    policy.gramsPerCard * policy.weightSafetyFactor;

  if (policy.letterCapacityMode === 'weight') {
    return Math.floor(method.maxWeightG / effectiveGramsPerCard);
  }

  if (method.maxWeightG <= 20) return 4;
  if (method.maxWeightG <= 50) return 17;
  if (method.maxWeightG <= 100) return 40;

  if (policy.letterCapacityMode === 'conservative') return 40;

  // Published table only goes to 100 g. For 500 g/1000 g letters, use the
  // weight bound as a low-confidence extrapolation.
  return Math.floor(method.maxWeightG / effectiveGramsPerCard);
}
```

The recommended default is `conservative`: 4/17/40 cards for 20/50/100 g
letters, then **40 cards for every larger letter**. The API exposes no
dimensions, and a 100+ card sleeved stack can exceed a Grossbrief's thickness
even when its weight fits. `published` extrapolates the 500 g/1000 g letter
tiers with `floor(maxWeight / gramsPerCard)`; it is cheaper but optimistic.
`weight` ignores the published card caps entirely. Treat `published`/`weight`
as sensitivity modes and verify the cart; do not use them silently.

The UI can run a sensitivity check with `weightSafetyFactor = 1.05` or
`gramsPerCard = 3.0` and warn if the selected method changes.

### 3.2 Tracking and Trustee

```ts
export function trackingReasons(
  itemsValueCents: Cents,
  seller: SellerInfo,
  policy: OptimizerPolicy,
): TrackingReason[] {
  const reasons: TrackingReason[] = [];
  if (itemsValueCents > policy.trackingThresholdCents) {
    reasons.push('value_over_threshold');
  }
  if (seller.requiresTracking) reasons.push('seller_requires_tracking');
  if (policy.alwaysTrack) reasons.push('user_always_track');
  return reasons;
}

export function trusteeFeeCents(
  itemsValueCents: Cents,
  method: ShippingMethod,
  policy: OptimizerPolicy,
): Cents {
  if (!method.isTracked) return 0;
  if (itemsValueCents <= 0) return 0;

  const bps =
    typeof policy.trusteeRateBps === 'function'
      ? policy.trusteeRateBps(method)
      : policy.trusteeRateBps;

  return Math.max(
    policy.minTrusteeFeeCents,
    Math.ceil((itemsValueCents * bps) / 10_000),
  );
}
```

The default `trusteeRateBps` should be **100 (1%)** for ranking. The real rate is
0.5%–1% depending on the method and is not in the shipping API. A tracked method
chosen voluntarily below 25 EUR also pays the fee; an untracked method pays
nothing. If the cart/checkout preview exposes the exact fee, prefer it and
re-rank.

### 3.3 Basket estimate and method selection

```ts
export interface BasketEstimate {
  itemsValueCents: Cents;
  cardCount: number;
  estimatedWeightG: Grams;
  trackingRequired: boolean;
  trackingReasons: TrackingReason[];
}

export function estimateBasket(
  lines: readonly PlannedLine[],
  seller: SellerInfo,
  policy: OptimizerPolicy,
): BasketEstimate {
  const itemsValueCents = lines.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0,
  );
  const cardCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const reasons = trackingReasons(itemsValueCents, seller, policy);

  return {
    itemsValueCents,
    cardCount,
    estimatedWeightG: estimateWeightG(cardCount, policy),
    trackingRequired: reasons.length > 0,
    trackingReasons: reasons,
  };
}

export function selectMethod(
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

    const trustee = trusteeFeeCents(
      basket.itemsValueCents,
      method,
      policy,
    );

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
      (a.methodKey < b.methodKey ? -1 : a.methodKey > b.methodKey ? 1 : 0),
  );

  return candidates[0] ?? null;
}
```

A basket is feasible only when `selectMethod` returns a method and
`itemsValueCents >= seller.minOrderValueCents`. A seller with no physical
method (empty table, only virtual methods, or an unknown country) cannot be
opened; its offers become missing with `no_shipping_route`.

### 3.4 Plan total

```ts
export function planTotals(orders: readonly PlannedOrder[]): PlanTotals {
  const itemsCents = orders.reduce((s, o) => s + o.itemsValueCents, 0);
  const shippingCents = orders.reduce(
    (s, o) => s + o.shipping.priceCents,
    0,
  );
  const trusteeCents = orders.reduce(
    (s, o) => s + o.shipping.trusteeFeeCents,
    0,
  );
  const cardCount = orders.reduce((s, o) => s + o.cardCount, 0);
  const slowestEtaDays = orders.reduce(
    (m, o) => Math.max(m, o.slowestEtaDays),
    0,
  );

  return {
    itemsCents,
    shippingCents,
    trusteeCents,
    totalCents: itemsCents + shippingCents + trusteeCents,
    orderCount: orders.length,
    cardCount,
    slowestEtaDays,
  };
}
```

`shippingCents` is `priceCents` (which already includes packaging). The
Trustee fee is the only additional per-order cost. Import VAT/customs is not
modelled; a non-EU order gets a warning instead.

---

## 4. Plan variants and objective order

All variants minimise **missing cards first**, then their own objective:

| Variant | Objective (lexicographic) | Use |
| ------- | ------------------------- | --- |
| `cheapest` | missing, totalCents, orderCount, canonicalKey | Lowest landed cost; default. |
| `fewerOrders` | missing, orderCount, totalCents, canonicalKey | Fewest seller orders; may cost much more. |
| `fastest` | missing, slowestEtaDays, totalCents, orderCount, canonicalKey | Minimise the slowest delivery estimate. |
| max-orders curve | For each `k`: missing, totalCents, orderCount, canonicalKey, subject to `orderCount <= k` | Shows the cost/order trade-off. |

The missing-first rule is important: a plan that covers 9 cards for 1 EUR must
not beat a plan that covers all 10 for 100 EUR when the user asked to buy the
deck. If full coverage is impossible, the least-missing plan wins, then cost.

`fewerOrders` is intentionally lexicographic. For cross-border routes, the
minimum-order plan can be dramatically more expensive (see the DE→GB tracking
cliff), so the UI must display the delta versus `cheapest`. The max-orders curve
is the proper way to choose a compromise.

`fastest` uses the slowest order ETA, not the average:

```
orderEta = max(
  line.etaDays ??
  seller.etaDays ??
  routeEta[`${seller.countryId}>${buyerCountryId}`] ??
  policy.defaultEtaDays
)
planEta = max(orderEta over all orders)
```

If an ETA is estimated from a fallback, set `etaEstimated = true` and add an
`eta_unknown` warning. The shipping API has no per-method ETA; the pair-level
average is a fallback, not a guarantee.

---

## 5. Greedy construction: multiple seeds

A single greedy rule is fragile because shipping is non-linear. Build several
deterministic seeds, evaluate each, and keep the best after local search.

### 5.1 Preparation

```
function prepare(input):
  wants = input.wants sorted by (id)                 // canonical order
  sellers = index input.sellers by id
  offers = []

  for offer in input.offers:
    if offer.stock <= 0: continue
    want = wantsById[offer.wantId]
    seller = sellers[offer.sellerId]
    if want == null or seller == null: continue
    if offer.language != want.language: continue
    if offer.finish != want.finish: continue
    if conditionRank(offer.condition) < conditionRank(want.minCondition): continue
    if offer.unitPriceCents < 0: continue
    methods = shipping.get(seller.countryId, buyerCountryId)
    if methods == null or methods.every(m => m.isVirtual):
      record rejectedOffer(offer, reason = no_shipping_route)
      continue
    offers.push(offer)

  offersByWant = group offers by wantId
  for each want:
    sort offers by (unitPriceCents, -conditionRank, etaDays ?? INF, id)
    keep first policy.maxOffersPerWant
    // Do not prune only by unit price: always keep the cheapest offer from
    // each seller (or at least each seller country) even if it falls outside
    // the top D. Shipping can dominate the unit-price difference.

  sellersWithOffers = group offers by sellerId
  sort each seller's offers by wantId, unitPrice, id
  return context
```

`conditionRank`: `PO=0, PL=1, LP=2, GD=3, EX=4, NM=5`. The filter uses
`offer.condition >= want.minCondition`; an EX want accepts EX/NM, not GD.
The effective per-want candidate count is therefore `D + (number of seller
countries)`, not just `D`. Use that in the complexity estimate if you keep the
per-seller guard.

### 5.2 Seed A — price-only

```
function priceSeed(ctx):
  alloc = empty
  remainingStock = offer.stock for all offers
  for want in wants sorted by (-quantity, id):
    remaining = want.quantity
    for offer in offersByWant[want.id]:
      take = min(remaining, remainingStock[offer.id])
      if take > 0:
        alloc[offer.id] += take
        remainingStock[offer.id] -= take
        remaining -= take
      if remaining == 0: break
    missing[want.id] = remaining
  return alloc
```

This is the cheapest card-price allocation, ignoring shipping and seller
minimums. It gives a lower bound on item cost and a useful starting point.

### 5.3 Seed B — shipping-aware effective cost

```
function shippingSeed(ctx, iterations = 5):
  share = map sellerId -> 0          // estimated shipping+trustee per card
  best = null
  previousAlloc = null

  for iter in 1..iterations:
    alloc = empty
    remainingStock = offer.stock
    for want in wants sorted by (-quantity, id):
      remaining = want.quantity
      candidates = offersByWant[want.id] sorted by:
        (offer.unitPriceCents + share[offer.sellerId],
         offer.unitPriceCents, offer.etaDays ?? INF, offer.id)
      for offer in candidates:
        take = min(remaining, remainingStock[offer.id])
        if take > 0:
          alloc[offer.id] += take
          remainingStock[offer.id] -= take
          remaining -= take
        if remaining == 0: break
      missing[want.id] = remaining

    plan = evaluate(ctx, alloc)
    if plan != null:
      if isBetter(plan, best, 'cheapest'): best = plan

      // Recompute each seller's per-card share from the actual basket.
      // Closed sellers reset to 0 so they can be reconsidered next iteration.
      newShare = map sellerId -> 0
      for order in plan.orders:
        newShare[order.sellerId] = ceil(
          (order.shipping.priceCents + order.shipping.trusteeFeeCents) /
          max(1, order.cardCount)
        )
      share = newShare

    if alloc == previousAlloc: break
    previousAlloc = alloc

  return best != null ? best.alloc : priceSeed(ctx)
```

This seed penalises sellers with expensive postage early. It can oscillate
because shipping is a step function; keep the best evaluated plan and stop when
the allocation repeats. It is still deterministic.

### 5.4 Seed C — single-seller plans

For each seller with broad coverage, try to cover as much as possible from that
seller, then fill the remainder with the price seed:

```
function singleSellerSeed(ctx, sellerId):
  alloc = empty
  remainingStock = offer.stock for all offers
  for want in wants:
    remaining = want.quantity
    for offer in offersByWant[want.id] where offer.sellerId == sellerId:
      take = min(remaining, remainingStock[offer.id])
      alloc[offer.id] += take
      remainingStock[offer.id] -= take
      remaining -= take
    if remaining > 0:
      fill remaining from the cheapest other offers with remainingStock
  return alloc
```

Evaluate the top `min(8, sellersWithOffers.length)` sellers by
`(coverageCount desc, totalOfferPrice asc, sellerId)`. `coverageCount` is the
number of wants the seller can supply at least one copy of. This captures the
"one big domestic seller" solution that pure per-want greedy can miss.

### 5.5 Seed D — fastest

```
function fastestSeed(ctx):
  alloc = empty
  for want in wants sorted by (-quantity, id):
    remaining = want.quantity
    candidates = offersByWant[want.id] sorted by:
      (etaDays ?? seller.etaDays ?? routeEta ?? defaultEtaDays,
       unitPriceCents, id)
    take greedily up to stock
  return alloc
```

This seed is used mainly by the `fastest` variant, but it can also produce a
useful starting point for the others.

### 5.6 Seed selection

Deduplicate seeds by canonical allocation key, repair each seed, evaluate, and
run local search. The `cheapest` variant should always include the price and
shipping seeds plus the best single-seller seeds. The `fewerOrders` variant
should also include the single-seller seeds (it is looking for a small seller
set). The `fastest` variant includes the fastest seed and the cheapest seed.

**Seed repair (seller minimum).** A price-only seed can put fewer euros into a
seller than that seller's minimum order value, making the basket illegal even
though a valid plan exists. Before evaluating a seed, for each open basket below
its seller minimum:

1. Try to add wants from other baskets where this seller has a competitive
   offer (respecting stock and keeping the source basket feasible or closing
   it); this raises the basket value without a new order.
2. If that is not enough, run the `closeSeller` macro for that seller and
   redistribute its lines to other offers.
3. If neither works, drop the basket and mark its cards missing with reason
   `seller_minimum`; do not invent filler cards.

This repair is deterministic (process sellers by `sellerId`, wants by
`(-quantity, id)`). It is cheap and prevents good seeds from being discarded
just because of a minimum order value.

---

## 6. Local search

### 6.1 State

The search keeps:

- `alloc: Map<OfferId, number>` — quantity per offer.
- `baskets: Map<SellerId, BasketState>` with:
  - `lines: Map<OfferId, number>`
  - `itemsValueCents`, `cardCount`, `estimatedWeightG`
  - `trackingReasons`
  - `shipping: SelectedMethod`
  - `slowestEtaDays`
- `plan: Plan` with totals, missing, canonical key.

A move updates only the affected baskets (usually two), recomputes their
`selectMethod`, and updates the totals. Seller-level macro moves may affect
several baskets, so they re-evaluate the whole plan.

### 6.2 Move set

```ts
type Move =
  | {
      kind: 'transfer';
      wantId: WantId;
      fromOfferId: OfferId;
      toOfferId: OfferId;
      qty: number;
    }
  | { kind: 'closeSeller'; sellerId: SellerId }
  | { kind: 'swapSeller'; fromSellerId: SellerId; toSellerId: SellerId };
```

1. **Transfer** — move `qty` copies of one want from one offer to another.
   The target may be from an already-open seller or a closed seller (which
   opens a new order). This is the workhorse move.
2. **CloseSeller** — redistribute every line of a seller to other offers and
   close the order. This is a macro move that can escape a local minimum where
   no single transfer is profitable but closing the whole basket is.
3. **SwapSeller** — replace seller A with closed seller B: move all of A's
   lines to B, close A, open B. This is important when the seller country (and
   therefore the shipping table) changes, e.g. replacing a UK seller with a
   domestic seller to avoid a 27.99 EUR parcel.

`transfer` to a closed seller covers "open a new seller for one want" without a
separate move. `closeSeller` and `swapSeller` are the only macro moves; keep the
move set small enough to evaluate deterministically.

### 6.3 Candidate quantities

For a transfer from offer `o` (seller A) to offer `o2` (seller B), do not only
try the full quantity. Try:

```
qty candidates =
  1
  min(alloc[o], remainingStock[o2])
  alloc[o]

  // cross the 25 EUR tracking threshold downward
  if basketA.value > trackingThreshold and o.unitPrice > 0:
    ceil((basketA.value - trackingThreshold) / o.unitPrice)

  // cross the nearest lower maxValue tier of A
  for the 2 nearest tiers T < basketA.value:
    ceil((basketA.value - T) / o.unitPrice)

  // cross the nearest lower maxWeight tier of A
  for the 2 nearest tiers W < basketA.weight:
    ceil((basketA.weight - W) / gramsPerCard)

  // cross a published letter card-cap tier (4, 17, 40)
  for cap in [4, 17, 40] where cap < basketA.cardCount:
    basketA.cardCount - cap

  // fill the target up to a published letter cap, so opening a new seller
  // with a 4-card letter is one move (not four individually-worse moves)
  for cap in [4, 17, 40] where cap > basketB.cardCount:
    cap - basketB.cardCount
```

Clamp each to `1..min(alloc[o], remainingStock[o2])`, deduplicate, and evaluate.
The threshold candidates are what let the search find the exact move that drops
a basket from a 27.99 EUR tracked parcel to a 1.55 EUR letter. The target-cap
candidates let it open a new seller directly at a 4-card letter, instead of
taking four individually-worse one-card moves. Without both, a steepest-descent
search can walk past the split that is cheaper overall.

### 6.4 Evaluating a transfer

For a transfer of `q` units from offer `o` to `o2`:

```
itemDelta = q * (o2.unitPrice - o.unitPrice)

update A's and B's lines/value/count/weight
recompute A.shipping = selectMethod(A)
recompute B.shipping = selectMethod(B)
if either is null or A/B violates seller minimum: infeasible

shippingDelta = (A.newPrice + B.newPrice) - (A.oldPrice + B.oldPrice)
trusteeDelta = (A.newTrustee + B.newTrustee) - (A.oldTrustee + B.oldTrustee)
totalDelta = itemDelta + shippingDelta + trusteeDelta
```

If A becomes empty, remove it from `orders`; if B was closed, add it. Check the
`maxOrders` cap. Recompute `slowestEtaDays` only for the affected orders and
then take the max over orders (or maintain a multiset if profiling shows it is
hot).

### 6.5 CloseSeller

```
function closeSeller(ctx, plan, sellerId):
  candidate = clone(plan)
  lines = candidate.baskets[sellerId].lines
          sorted by (unitPrice desc, wantId, offerId)

  for line in lines:
    remaining = line.qty
    targets = eligible offers for line.want, excluding sellerId,
              sorted by (target.unitPrice + share[target.sellerId],
                         target.unitPrice, target.id)

    for target in targets:
      room = target.stock - candidate.alloc[target.id]
      take = min(remaining, room)
      if take > 0:
        applyTransfer(candidate, line, target, take)
        remaining -= take
      if remaining == 0: break

    if remaining > 0:
      return null                 // cannot redistribute this seller

  if candidate.baskets[sellerId].cardCount > 0:
    return null

  return evaluate(candidate)      // full re-evaluation: target sellers changed
```

`share[sellerId]` is the current per-card shipping+Trustee estimate from the
previous evaluation. After each tentative transfer, check the target's seller
minimum and method; if it is infeasible, revert that transfer and try the next
target. If all targets fail, the close move is infeasible. For small baskets,
try the top 3 targets by exact delta rather than the score; the score is a
deterministic ordering heuristic.

### 6.6 SwapSeller

```
function swapSeller(ctx, plan, fromSellerId, toSellerId):
  candidate = clone(plan)
  for line in candidate.baskets[fromSellerId].lines:
    target = best offer from toSellerId for line.want with room
    if target == null: return null
    applyTransfer(candidate, line, target, line.qty)

  if candidate.baskets[fromSellerId].cardCount > 0: return null
  return evaluate(candidate)      // opens `toSellerId`, closes `fromSellerId`
```

This is a country-aware move. It is especially useful when the current seller
is cross-border and a domestic seller can avoid the tracked-parcel cliff. Only
try the top 8 closed sellers by `(sameCountry, coverageCount, sellerId)` to keep
the move set small.

### 6.7 Move generation and acceptance

```
function localSearch(ctx, plan, variant, maxOrders):
  evaluations = 0

  for iter in 1..policy.maxIterations:
    bestMove = null
    bestDelta = null

    for move in generateMoves(ctx, plan, variant):
      if evaluations++ >= policy.maxEvaluations: return plan
      delta = evaluateMove(ctx, plan, move, maxOrders)
      if delta == null: continue
      if !improves(delta.plan, plan, variant): continue
      if bestDelta == null or isBetterDelta(delta, bestDelta, variant):
        bestMove = move
        bestDelta = delta

    if bestMove == null: break
    plan = applyMove(ctx, plan, bestMove)

  return plan
```

`generateMoves`:

```
for want in wants:
  sources = offers with alloc > 0 for want
  targets = top maxOffersPerWant offers for want,
            excluding the source offer and its seller
  for source in sources:
    for target in targets:
      for qty in candidateQtys(source, target, plan):
        yield transfer(want.id, source.id, target.id, qty)

for seller in open sellers sorted by (cardCount asc, sellerId):
  yield closeSeller(seller.id)
  for target in topClosedSellers(8):
    yield swapSeller(seller.id, target.id)
```

Use code-unit string comparison (not `localeCompare`) for all tie-breaks.

`improves` is lexicographic:

```
function improves(candidate, current, variant):
  if candidate.missingQty != current.missingQty:
    return candidate.missingQty < current.missingQty

  if variant == 'fewerOrders':
    if candidate.orderCount != current.orderCount:
      return candidate.orderCount < current.orderCount
    return candidate.totalCents < current.totalCents

  if variant == 'fastest':
    if candidate.slowestEtaDays != current.slowestEtaDays:
      return candidate.slowestEtaDays < current.slowestEtaDays
    if candidate.totalCents != current.totalCents:
      return candidate.totalCents < current.totalCents
    return candidate.orderCount < current.orderCount

  // cheapest
  if candidate.totalCents != current.totalCents:
    return candidate.totalCents < current.totalCents
  return candidate.orderCount < current.orderCount
```

`isBetterDelta` uses the same keys, plus `canonicalKey` as the final
tie-break. For `fewerOrders`, a move that reduces orders is accepted even if it
raises cost; that is the definition of the variant. For `cheapest`, a move that
raises cost is rejected even if it reduces orders (the curve handles that
trade-off explicitly).

### 6.8 Why these moves are sufficient in practice

- **Transfer** handles quantity allocation, stock limits, and threshold cliffs.
- **CloseSeller** handles consolidation and seller minimum order values.
- **SwapSeller** handles country/shipping-table changes and replacing an
  expensive cross-border seller with a domestic one.
- The multi-start seeds handle the main global structures (cheapest per card,
  shipping-aware, single seller, fastest). Local search then repairs the
  allocation.

No local search can guarantee global optimality. The goal is a deterministic,
explainable plan that is consistently better than per-card cheapest plus
naive shipping, and that exposes the order/cost trade-off.

---

## 7. Max-orders curve and variant construction

### 7.1 Max-orders curve

The curve answers: "What is the cheapest plan I can get with at most `k`
orders?" It is not a smooth curve; it is a sequence of plans with step changes
caused by seller fixed charges and tracking thresholds. Show the actual points,
including the cliffs, not a smoothed line.

```
function buildCurve(ctx, cheapestPlan, maxOrders):
  K = min(cheapestPlan.totals.orderCount, maxOrders ?? INF)
  current = cheapestPlan
  points = []

  for k = K down to 1:
    if current.totals.orderCount > k:
      candidate = bestCloseOneSeller(ctx, current)
      if candidate == null:
        points.push({ maxOrders: k, plan: null, feasible: false })
        break
      current = localSearch(ctx, candidate, 'cheapest', k)
      if current.totals.orderCount > k:
        points.push({ maxOrders: k, plan: null, feasible: false })
        break

    points.push({ maxOrders: k, plan: current, feasible: true })

  return reverse(points)
```

`bestCloseOneSeller` tries every open seller, keeps the feasible closure with
the lowest total cost, and requires the result to have fewer orders than the
current plan. For `fewerOrders`, the same helper is used repeatedly until no
closure is possible.

### 7.2 `fewerOrders`

```
function fewerOrdersPlan(ctx, cheapestPlan):
  plan = cheapestPlan
  loop:
    candidate = bestCloseOneSeller(ctx, plan)
    if candidate == null: break
    candidate = localSearch(ctx, candidate, 'cheapest', candidate.orderCount)
    if candidate.orderCount >= plan.orderCount: break
    plan = candidate
  return plan
```

The inner local search uses the `cheapest` comparator with a hard cap equal to
the candidate's order count, so it may rearrange the remaining baskets but
cannot reopen a seller. Stop when no seller can be closed without making the
plan infeasible. This is a local minimum for order count; the curve provides the
alternative cost points. If the user sets a cost premium limit, stop before a
closure that would exceed it and show the previous plan.

### 7.3 `fastest`

```
function fastestPlan(ctx, seeds, maxOrders):
  best = null
  for seed in seeds:
    plan = evaluate(ctx, seed)
    if plan == null: continue
    plan = localSearch(ctx, plan, 'fastest', maxOrders)
    if isBetter(plan, best, 'fastest'): best = plan
  return best
```

The fastest seed chooses offers by ETA first, then price. The local search may
increase item cost to reduce the slowest order, but the missing-first rule still
applies. If an order has no known ETA, use the pair-level fallback, then the
policy default, and mark the plan with `eta_unknown`.

### 7.4 Curve quality options

- **Fast curve**: one closure + a short local search per `k` (default).
- **Thorough curve**: for each `k`, also run a fresh price/shipping seed with
  `maxOrders = k` and keep the better plan. This is slower but less dependent on
  the closure path.
- **Penalty sweep alternative**: run `cheapest` with an artificial penalty
  `λ * orderCount` for a geometric sequence of `λ` values; collect the plans and
  dedupe by order count. This can find plans that are not reachable by a single
  closure, at the cost of more local-search runs.

Curve invariants to assert in tests:

- `points` is sorted by `maxOrders` ascending.
- For feasible points, `plan.totals.orderCount <= maxOrders`.
- `plan.totals.totalCents` is non-increasing as `maxOrders` increases (more
  orders allowed cannot force a higher cost; if the heuristic violates this,
  take `min(cost_k, cost_{k+1})` and keep the corresponding plan).
- `missingQty` is non-increasing as `maxOrders` increases.
- If no plan exists for `k`, no plan exists for any smaller `k` unless a
  different seller mix could cover stock; the curve stops at the first
  infeasible point and reports it.

The UI should mark the **knee**: the point where saving one more order costs a
large jump in total. For DE→GB, the knee is often at the number of sellers needed
to keep each cross-border basket at or below 25 EUR and within the 4-card letter
cap.

---

## 8. Missing cards and infeasible plans

Missing is computed per want after allocation:

```
filled = Σ alloc[offer] for offers of the want
shortfall = want.quantity - filled
```

Reasons, in priority order:

1. `no_offer` — no eligible offer after language/finish/condition/route
   filters.
2. `insufficient_stock` — eligible offers exist but total stock is short.
3. `no_shipping_route` — all offers are from sellers with no physical route
   (empty table, only virtual methods, unknown country).
4. `seller_minimum` — the only feasible sellers cannot meet their minimum order
   value with the available wants.
5. `no_feasible_method` — a basket exists but no method satisfies
   `maxValue`/`maxWeight`/tracking/card-cap simultaneously, and the optimizer
   could not split or reassign it.

Rules:

- `allowPartial = false`: a plan with any shortfall has coverage `infeasible`,
  but the optimizer still returns the least-missing plan for diagnostics. The
  UI must block or strongly warn before applying.
- `allowPartial = true`: coverage `partial`; the user can apply the cart and
  sees exactly what is missing.
- Never drop a card silently to make shipping cheaper. If a card is missing,
  show it; if a card is expensive, it stays in the plan unless the user
  explicitly excludes it.
- If a seller's minimum is not met, the optimizer may add other wants to that
  seller (if they are competitive) or close the seller; it must not invent
  filler cards that are not in the wants list.

Infeasible plan object: no orders, all wants missing, `coverage: 'infeasible'`,
and a warning explaining the dominant reason. This is better than throwing and
losing the diagnostics.

---

## 9. Determinism

The algorithm must be reproducible across runs, machines, and input orderings.

- Sort wants by `id` and offers by
  `(wantId, unitPriceCents, -conditionRank, etaDays ?? Infinity, offerId)`.
- Sort sellers by `sellerId`; sort methods by the comparator in §3.3.
- Use `<`/`>` code-unit string comparison for IDs, not `localeCompare`
  (locale-dependent).
- Use integer cents/grams/days everywhere. Do not use `parseFloat` for money.
- Use `Math.ceil` for fees and weights; use integer arithmetic for totals.
- No `Math.random()`, no time-based acceptance, no `Set`/`Map` iteration order
  assumptions. If you iterate a map, sort its keys first.
- The search budget is an **evaluation count**, not a wall-clock timeout.
  Wall-clock cutoffs make results machine-dependent; use them only as a last
  resort and record a warning.
- Tie-break equal plans by `canonicalKey`:

```
canonicalKey =
  orders sorted by sellerId
    -> `${sellerId}:`
    -> lines sorted by (wantId, offerId)
    -> `${wantId}/${offerId}/${quantity}`
  joined by `|`
```

- A shuffled input must produce the same `canonicalKey` and totals. This is a
  required test.

---

## 10. Complexity and runtime

Let:

- `W` = wants (≤120)
- `Q` = total requested cards (≤120)
- `O` = eligible offers after filtering (typ. 200–2,000)
- `d` = offers kept per want (`maxOffersPerWant`, default 10)
- `S` = sellers with at least one offer (typ. 5–30)
- `M` = methods per shipping route (≤40; often 15–25)
- `I` = local-search iterations (≤100)
- `K` = order caps in the curve (≤S, usually ≤12)
- `B` = closed sellers tried in `swapSeller` (≤8)

| Phase | Complexity | Notes |
| ----- | ---------- | ----- |
| Prepare | `O(O log d + P·M log M)` | `P` = distinct country pairs; sort/prune offers, normalize methods once. |
| Price seed | `O(O + W·d)` | Greedy by want quantity; stock decremented. |
| Shipping seed | `O(5·(W·d + S·M))` | 5 iterations, keep best; deterministic stop on repeat. |
| Single-seller seeds | `O(min(S,8)·W·d + S·M)` | Top sellers only. |
| Seed repair | `O(S·W·d·M)` worst | Seller-minimum repair; usually tiny. |
| Evaluate a plan | `O(S·(M + lines))` | Select one method per open seller. |
| Transfer move | `O(M)` | Recompute two baskets; O(1) item delta. |
| `closeSeller` | `O(cards(A)·d·M)` worst, plus full evaluate | Usually small; macro move. |
| `swapSeller` | `O(cards(A)·d + S·M)` | One target seller, then full evaluate. |
| One local-search iteration | `O(W·d²·M + S·cards·d·M + S·B·(...))` | With pruning; see typical numbers below. |
| Full local search | `O(I · iteration)` | `I` capped; evaluation budget. |
| Max-orders curve | `O(K · (close + I_k · iteration))` | `I_k` should be 10–20, not 100. |
| Memory | `O(W + O + S·M + K·plan size)` | Plans are small; curve stores references/copies. |

Typical numbers (W=120, Q=120, O=1,200, d=10, S=20, M=40, I=50):

- Transfer candidates per iteration: `120 × 10² = 12,000`; at `O(M)` ≈ 0.5M ops.
- Close-seller candidates: `20 × 120 × 10` line-target pairs, at `O(M)` ≈ 1M.
- Swap-seller candidates (top 8): ~8M if fully evaluated; prune to sellers
  whose country or shipping differs, or evaluate only when the current seller
  is cross-border. Keep the total under a few million ops per iteration.
- A full `cheapest` run should fit in roughly **1–3 seconds** in a Web Worker
  for this size, with `maxEvaluations` as the safety valve.
- The curve adds `K` shorter searches; cap `I_k` at 10–20 and warm-start from
  the previous point. A 10-point curve should fit in a few seconds.
- If the extension has a stricter latency target, reduce `d` to 6–8, `I` to
  30, and skip `swapSeller` for same-country sellers. The seeds still provide a
  good baseline.

Precompute and cache:

- Normalize shipping methods once per route; build a Pareto frontier per route
  and tracking flag (remove methods dominated in price, `maxValue`, and
  `maxWeight`; keep letter-cap distinctions). This usually cuts `M` to <10.
- Cache `selectMethod` per `(sellerId, valueCents, weightG, tracking)` because
  local-search moves revisit similar baskets.
- Cache per-seller `share` for seed B; invalidate only when the basket changes.
- Do not fetch shipping tables inside the search. Prefetch all unique
  `sellerCountry → buyerCountry` pairs before optimization; a missing table is
  an infeasible seller, not a search-time network call.

---

## 11. End-to-end pseudocode

```
function optimize(request):
  ctx = prepare(request.input)

  seeds = [
    priceSeed(ctx),
    shippingSeed(ctx),
    fastestSeed(ctx),
    ...singleSellerSeeds(ctx, limit = 8),
  ]
  seeds = dedupeByCanonicalAllocation(seeds)
  seeds = seeds.map(seed => repairSeed(ctx, seed))

  plans = []
  for variant in request.variants where variant != 'maxOrdersCurve':
    best = null
    for seed in seeds:
      plan = evaluate(ctx, seed)
      if plan == null: continue
      plan = localSearch(ctx, plan, variant, request.maxOrders)
      if isBetter(plan, best, variant): best = plan
    if best == null:
      best = infeasiblePlan(ctx, variant)
    plans.push(best)

  curve = []
  if request.variants includes 'maxOrdersCurve':
    cheapest = plans.find(p => p.variant == 'cheapest')
             ?? optimize({ ...request, variants: ['cheapest'] }).plans[0]
    curve = buildCurve(ctx, cheapest, request.maxOrders)

  return { plans, maxOrdersCurve: curve }
```

`isBetter(plan, best, variant)`:

```
if best == null: return true
if plan.missingQty != best.missingQty:
  return plan.missingQty < best.missingQty
switch variant:
  cheapest:
    if plan.totalCents != best.totalCents:
      return plan.totalCents < best.totalCents
    if plan.orderCount != best.orderCount:
      return plan.orderCount < best.orderCount
    return plan.canonicalKey < best.canonicalKey
  fewerOrders:
    if plan.orderCount != best.orderCount:
      return plan.orderCount < best.orderCount
    if plan.totalCents != best.totalCents:
      return plan.totalCents < best.totalCents
    return plan.canonicalKey < best.canonicalKey
  fastest:
    if plan.slowestEtaDays != best.slowestEtaDays:
      return plan.slowestEtaDays < best.slowestEtaDays
    if plan.totalCents != best.totalCents:
      return plan.totalCents < best.totalCents
    if plan.orderCount != best.orderCount:
      return plan.orderCount < best.orderCount
    return plan.canonicalKey < best.canonicalKey
```

`evaluate(ctx, alloc)` builds orders, selects methods, computes missing, and
sets `missingQty = Σ missing.shortfall`. It returns `null` only when a non-empty
basket has no feasible method, a seller minimum is violated, or the order cap is
exceeded. Missing cards do **not** make `evaluate` return null; they are part of
the plan and drive the missing-first comparator.

---

## 12. Test cases

### 12.1 Parsing and method selection (real fixtures)

These use the fixtures in `tests/fixtures/`, `gramsPerCard = 2.5`, conservative
letter caps (4/17/40, and 40 for larger letters), and no `alwaysTrack`. Values
are EUR; expected prices are EUR.

| # | Setup | Expected |
| - | ----- | -------- |
| P1 | `parseEuroToCents("0,95 €")` | `95` |
| P2 | `parseEuroToCents("1.000,00 €")` | `100000` |
| P3 | `parseEuroToCents("150.000,00 €")` | `15000000` |
| P4 | `parseEuroToCents("£3.60")` | throws (not EUR) |
| P5 | GB→DE `stampPrice "£3.60"`, `price "4,97 €"` | `stampPriceCents = null`, `priceCents = 497` |
| P6 | DE→DE Standardbrief normalized | `priceCents = 125`; inferred packaging fee 30; do not add it again |
| P7 | DE→DE 1 card, 5.00, untracked | Standardbrief, 1.25 |
| P8 | DE→DE 5 cards, 20.00, untracked | Kompaktbrief, 1.40 |
| P9 | DE→DE 17 cards, 20.00, untracked | Kompaktbrief, 1.40 (cap 17; weight 42.5 g) |
| P10 | DE→DE 18 cards, 20.00, untracked | Grossbrief, 2.30 (Kompaktbrief cap 17 fails) |
| P11 | DE→DE 120 cards, 5.00, untracked | DHL Päckchen S, 5.19 (conservative 40-card letter cap; optimistic mode gives Grossbrief 2.30) |
| P12 | DE→DE 40 cards, 100.00, tracked | Grossbrief + Einschreiben EINWURF, 4.65 |
| P13 | DE→DE 40 cards, 100.01, tracked | DHL Paket (Online, 2 kg), 7.19 (maxValue 100 fails) |
| P14 | DE→DE 1 card, 25.00, no tracking | Standardbrief, 1.25 |
| P15 | DE→DE 1 card, 25.01, tracking | Kompaktbrief + Einschreiben EINWURF, 3.95 |
| P16 | DE→GB 4 cards, 20.00, untracked | Letter (Standardbrief), 1.55 |
| P17 | DE→GB 5 cards, 20.00, untracked | Registered Parcel (5 kg), 27.99 (letter cap 4 fails) |
| P18 | DE→GB 1 card, 30.00, tracked | Registered Parcel (5 kg), 27.99 |
| P19 | DE→GB 120 cards, 600.00, tracked | Insured Parcel (DHL Wertpaket 1.000 €, 5 kg), 41.99 |
| P20 | GB→DE 10 cards, 20.00, untracked | Int. Standard Letter (100 g), 4.97 |
| P21 | GB→DE 10 cards, 30.00, tracked | Int. Standard Small Parcel (Online, 250 g), 20.18 |
| P22 | GB→DE 40 cards, 20.00, untracked | Int. Standard Letter (100 g), 4.97 (100 g exactly) |
| P23 | GB→DE 41 cards, 20.00, untracked | Int. Standard Small Parcel (Online, 250 g), 9.19 |
| P24 | FR→DE 10 cards, 20.00, untracked | Lettre Internationale (100 g), 5.35 |
| P25 | FR→DE 10 cards, 30.00, tracked | Lettre Suivie Internationale (50 g), 8.15 |
| P26 | DE→CH 1 card, 30.00, tracked | Registered Parcel (5 kg), 27.99 |
| P27 | DE→JP 1 card, 30.00, tracked | `null`; only Virtual Delivery, excluded |
| P28 | DE→DE 1 card, 5.00 | Never selects Virtual Delivery (price 0) |
| P29 | DE→GB tracked 120 cards, 100.00 | Registered Parcel 5 kg, 27.99; duplicate names are distinct tiers |
| P30 | DE→GB vs DE→CH normalized method sets | Identical `methodKey` sets in this snapshot |
| P31 | DE→DE 120 cards, 100.00, tracked | DHL Paket (Online, 2 kg), 7.19 (conservative letter cap; optimistic mode gives 4.65) |

Additional unit tests:

- `trusteeFeeCents(2501, tracked, 100 bps) = 26` (ceil 25.01).
- `trusteeFeeCents(2501, tracked, 50 bps) = 13`.
- `trusteeFeeCents(10000, tracked, 100 bps) = 100`.
- `trusteeFeeCents(0, tracked, 100 bps) = 0`.
- Two synthetic methods, both 2.00 EUR, one tracked, value 10.00, no tracking
  required: untracked wins (2.00 vs 2.10). With `alwaysTrack = true`, tracked
  wins.
- `letterCardCapacity` published mode: 20 g → 4, 50 g → 17, 100 g → 40,
  500 g → 200, 1000 g → 400.
- `letterCardCapacity` conservative mode: 500 g → 40.
- `letterCardCapacity` weight mode: 20 g → 8, 50 g → 20, 100 g → 40.

### 12.2 Optimizer scenarios (synthetic shipping tables)

For these scenarios, use two simple routes:

```
DE→DE:
  U: price 200, maxValue 2500, maxWeight 500, isLetter true,  isTracked false
  T: price 400, maxValue 10000, maxWeight 2000, isLetter false, isTracked true

DE→GB:
  U: price 150, maxValue 2500, maxWeight 20,  isLetter true,  isTracked false
  T: price 2799, maxValue 50000, maxWeight 5000, isLetter false, isTracked true
```

`trusteeRateBps = 100`, `gramsPerCard = 2.5`, letter caps conservative,
`allowPartial = false`.

| # | Scenario | Expected |
| - | -------- | -------- |
| O1 | Wants W1×10, W2×10. DE-A: both 1.00; DE-B: both 1.50; GB-C: both 0.50. | `cheapest` = 4 cards from GB-C (2+2) + 16 from DE-A: items 18.00 + 1.50 + 2.00 = **21.50**, 2 orders. All DE-A = 22.00, 1 order; all GB-C = 10.00 + 27.99 + 0.10 = 38.09. `fewerOrders` = DE-A 22.00 (1 order). |
| O2 | Same offers as O1, but GB-C has `etaDays = 2`, DE-A `etaDays = 5`. | `cheapest` = split 21.50 (slowest ETA 5); `fastest` = GB-C 38.09 with slowest ETA 2. |
| O3 | Wants W1×10, W2×10. DE-A: W1 1.00, W2 5.00; DE-B: W1 5.00, W2 1.00. | `cheapest` = split 2 orders: items 20.00 + 2×2.00 = **24.00**. 1-order plan = items 60.00 + 4.00 + Trustee 0.60 = **64.60**. `fewerOrders` = 64.60 (1 order); curve = k1 64.60, k2 24.00. |
| O4 | Wants W1×2, W2×2 (4 cards). DE-A: both 1.00; GB-C: both 0.50. | `cheapest` = GB-C: items 2.00 + 1.50 = **3.50**, 1 order. |
| O5 | Same as O4 but W1×3, W2×2 (5 cards). | `cheapest` = 4 cards from GB-C (2+2) + 1 from DE-A: items 3.00 + 1.50 + 2.00 = **6.50**, 2 orders. All DE-A = 7.00 (1 order); all GB-C = 2.50 + 27.99 + 0.03 = 30.52. `fewerOrders` = DE-A 7.00. |
| O6 | W1×10; DE-A stock 6 at 1.00; DE-B stock 10 at 1.50. | Allocation 6 + 4: items 12.00 + 2×2.00 = **16.00**, 2 orders. If DE-A stock 10: **12.00**, 1 order. |
| O7 | W1×10, W2×10; DE-C: W1 0.80, W2 1.20, minOrder 20.00; DE-A: W1 1.00, W2 5.00. | DE-C basket exactly 20.00 → allowed: items 20.00 + 2.00 = **22.00**. With only W1×10, DE-C basket 8.00 < 20.00 → infeasible; DE-A = 10.00 + 2.00 = 12.00. |
| O8 | W1×10; only DE-A stock 4 at 1.00. | Plan fills 4, missing 6: items 4.00 + 2.00 = **6.00**, `coverage: 'infeasible'` (or `partial` if allowed), missing reason `insufficient_stock`. |
| O9 | W1×10; only a seller whose route has only virtual methods. | No orders; missing 10, reason `no_shipping_route`; never selects `Virtual Delivery`. |
| O10 | W1×10, W2×10; DE-A: W1 1.00, W2 5.00; DE-B: W1 5.00, W2 1.00; shuffle the input arrays. | Same `canonicalKey`, same totals, same orders as O3. |
| O11 | Two plans: A covers 10 cards for 100.00; B covers 9 cards for 1.00. | `cheapest` picks A because missing is minimised first. |
| O12 | W1×10, W2×10; DE-A: both 1.00; GB-C and GB-D: both 0.50 but stock 2 per want each (4 cards per GB seller). | Two GB letters cost 2×1.50 = 3.00 for 8 cards; the remaining 12 come from DE-A (2.00 shipping). Items: 8×0.50 + 12×1.00 = 16.00; total **21.00**, 3 orders. All-DE-A is 22.00, 1 order. Assert the optimizer finds the split and reports the order/cost trade-off instead of opening one 27.99 tracked parcel. |

### 12.3 Property tests

For every generated plan, assert:

1. **Coverage arithmetic**: `filled + shortfall = requested` for every want.
2. **Stock**: `0 <= alloc[offer] <= offer.stock`.
3. **Want quantity**: `Σ alloc[offer] for a want <= want.quantity`.
4. **No substitution**: every allocated offer matches the want's language,
   finish, and minimum condition.
5. **Seller minimum**: every open order has
   `itemsValueCents >= seller.minOrderValueCents`.
6. **Method validity**: every order has a selected method with
   `!isVirtual`, `maxValueCents >= itemsValueCents`,
   `maxWeightG >= estimatedWeightG`, and tracking when required.
7. **No untracked high-value basket**: if `itemsValueCents > 2500`, the method
   is tracked.
8. **No double-counted packaging**: plan shipping equals sum of
   `method.priceCents`, not `price + packaging`.
9. **Trustee**: every selected tracked method has
   `trusteeFeeCents = max(1, ceil(value × rate / 10000))`; every untracked
   method has 0.
10. **Order cap**: `orderCount <= maxOrders` for the curve and for any request
    with a cap.
11. **Determinism**: shuffling wants/offers and rerunning produces the same
    `canonicalKey` and totals.
12. **Variant ordering**: `fewerOrders.orderCount <= cheapest.orderCount`;
    `fastest.slowestEtaDays <= cheapest.slowestEtaDays`;
    `cheapest.totalCents <= fewerOrders.totalCents` (unless the plans are equal).
13. **Curve monotonicity**: cost and missing are non-increasing as `maxOrders`
    increases; every feasible point satisfies `orderCount <= maxOrders`.
14. **Seeds are not worse**: the best plan is no worse than the price-only seed
    and the best single-seller seed for the same constraints (multi-start
    guarantee).

### 12.4 Fixture-level tests

- `shipping-de-gb.json` and `shipping-de-ch.json` are deeply equal; assert the
  optimizer treats them the same.
- `shipping-gb-de.json` has a GBP `stampPrice`; assert `stampPriceCents` is
  `null` for those methods and `priceCents` is still parsed.
- `shipping-de-de.json` contains duplicate/overlapping method tiers; assert the
  method count is preserved and no name-based dedupe loses a tier.
- `shipping-de-jp-virtual-only.json` has exactly one method with
  `isVirtual = true`; assert no physical plan is produced.
- `shipping-countries.json` contains `INVALID_ID` 0; assert the country filter
  removes it and maps `GB` to 13.

---

## 13. Acceptance criteria

The optimizer is ready for the extension when:

- It produces `cheapest`, `fewerOrders`, `fastest`, and a max-orders curve for
  the 100-card Command Tower fixture (with synthetic or cached shipping tables)
  in the target runtime.
- Every plan passes the property tests in §12.3.
- The cheapest plan is never worse than:
  - the price-only seed, and
  - the best single-seller seed.
- The max-orders curve exposes the DE→GB/CH tracking cliff instead of smoothing
  it away.
- A shuffled input produces the same plan.
- Missing cards and infeasible sellers are surfaced with reasons; the UI never
  silently applies a partial cart.
- The exact cart total is verified after applying, as required by the product
  brief. The optimizer's shipping estimate is an estimate; Cardmarket is the
  source of truth at checkout.

---

## 14. Open questions / risks

1. **Exact Trustee rate per method.** The fee table says 0.5%–1% depending on
   the method, but does not publish a mapping. Default to 1% for ranking and
   reconcile against the cart/checkout preview. If the exact mapping changes a
   winning plan, show both totals.
2. **Does `price` include packaging on every route?** The EUR-origin fixtures
   show exact 0.30/0.50/1.00 deltas; GBP-origin routes are obscured by FX.
   Treat `price` as all-in and verify at cart time.
3. **Does `maxWeight` include packaging?** Assume the carrier's gross limit.
   `2.5 g/card` is a planning estimate, not a measurement; use the sensitivity
   run near boundaries.
4. **Letter dimensions.** The API exposes weight but not thickness. The
   conservative default caps letters at 40 cards; it is safe but may leave
   savings on 41–120 card orders that would fit a Maxibrief. The optimistic
   `published` mode extrapolates weight only; treat it as an explicit risk
   choice and verify at cart time.
5. **Seller ETA semantics.** Is it dispatch time or total delivery time? Use it
   as a total estimate; do not add the pair ETA on top unless the data model
   separates dispatch and transit.
6. **Seller risk flags.** The shipping API cannot tell you whether a seller is
   new or has a loss rate >2%. Read it from the seller page if available; if
   not, warn and let the user force tracking.
7. **Split shipments from one seller.** The cart groups by seller; assume one
   order per seller. If a basket exceeds every method's `maxWeight`, the
   optimizer must split across sellers or report infeasible, not assume the
   seller will send two parcels.
8. **Non-EU import VAT/customs.** Not modelled; flag non-EU routes and do not
   silently include or exclude taxes.
9. **Stock changes.** Offers are snapshots. Revalidate before applying; if
   stock changed, repair the plan by replacing those units and rerun local
   search. Never apply a stale allocation silently.
