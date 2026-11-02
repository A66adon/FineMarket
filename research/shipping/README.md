# Cardmarket shipping costs & basket optimizer research

Snapshot: **2026-11-02**. Data comes from the public, unauthenticated
`help.cardmarket.com` endpoints and help pages. This directory is research, not
application code. Prices and method lists change; the fixtures are snapshots,
not production constants.

The optimizer proposal lives in [`optimizer.md`](./optimizer.md). The rest of
this document defines the shipping data, how to parse it, and the cost rules the
optimizer must obey.

---

## TL;DR — the five things that change the design

1. **`price` is the buyer-facing number; `stampPrice` is not.** `price` is in
   EUR and already includes Cardmarket's packaging fee. `stampPrice` is the
   nominal postage in the origin country's currency (e.g. `£3.60`) and must
   never be parsed as EUR or compared across countries. Use `price` only.
2. **The 25 EUR tracking cliff is the dominant cost driver.** Any seller basket
   worth more than 25.00 EUR must be tracked. On DE→GB/CH the cheapest tracked
   option is a 27.99 EUR parcel, while the untracked letter is 1.55 EUR. That is
   a **+26.44 EUR** jump for one cent over the threshold.
3. **Splitting cross-border baskets can be much cheaper than consolidating.**
   Shipping is charged per seller, so two 20 EUR, ≤4-card cross-border baskets
   can use two 1.55 EUR letters (3.10 EUR) instead of one 27.99 EUR tracked
   parcel. The
   optimizer must consider deliberately using more sellers/orders to stay under
   the threshold. This is why a "fewest orders" plan can be dramatically more
   expensive, and why the max-orders curve is required.
4. **Trustee Service is not in the shipping API.** It applies to tracked
   shipments and costs 0.5%–1% of the **article value**, depending on the
   shipping method (fee table). Add it separately; never assume `price` includes
   it. A tracked basket above 25 EUR therefore pays both the tracked postage and
   the Trustee fee.
5. **The API is incomplete and quirky.** It has no ETA, no dimensions, no
   packaging/Trustee fields, no unique method id, and duplicate method names
   (one per weight/value tier). It also returns a `Virtual Delivery` method for
   some routes, including a DE→JP route with *only* virtual delivery. Filter
   `isVirtual`, key methods by their full tuple, use a conservative letter-card
   cap because dimensions are missing, and treat the ETA as a separate,
   approximate input.

---

## 1. Public API

### 1.1 Shipping methods

```
GET https://help.cardmarket.com/api/shippingCosts
    ?locale=en
    &fromCountry=<seller country externalId>
    &toCountry=<buyer country externalId>
```

- No authentication, no API key.
- `fromCountry` is the **seller's** country; `toCountry` is the **buyer's**
  country. A German buyer buying from a UK seller calls `13→7`, not `7→13`.
- The values are Cardmarket `externalId`s, not ISO codes. Germany = `7`,
  United Kingdom = `13`, France = `12`, Switzerland = `4`, Japan = `36`.
- `locale=en` was used for all fixtures. It does not change the EUR `price` or
  the German method names for a DE→DE route; method names are not a reliable
  source of meaning.
- The response is a bare JSON **array**. An unsupported route can return `[]`
  or only virtual methods. An invalid country id returns HTTP 400 with an error
  object.
- The optional `preview` parameter appears in the help-site widget; omit it (or
  pass `false`) for normal data.

### 1.2 Countries

```
GET https://help.cardmarket.com/api/countries?page=0&limit=50&locale=en
```

Response shape:

```json
{
  "total": 35,
  "items": [
    { "name": "Germany", "externalId": 7 },
    { "name": "United Kingdom", "externalId": 13 }
  ]
}
```

`items` includes `{"name":"INVALID_ID","externalId":0}` — filter
`externalId > 0`. Page by incrementing `page` until `items.length >= total`.
A snapshot is in `tests/fixtures/shipping-countries.json`. In this snapshot the
list has 35 countries; there is no United States entry, and Japan/Singapore are
present but may have no physical route.

### 1.3 Response schema

Each element of the shipping array:

| Field        | Type    | Example       | Meaning / parsing |
| ------------ | ------- | ------------- | ----------------- |
| `name`       | string  | `"Standardbrief"` | Display label. Localized, **not unique**, and sometimes duplicated across tiers. Never key logic off it. |
| `isTracked`  | boolean | `false`       | Whether the method has tracking. This is the authoritative tracking flag; do not infer it from `"Registered"`/`"Einschreiben"` in the name. |
| `maxValue`   | string  | `"25,00 €"`   | Maximum **article value** covered by this method. German-formatted EUR: `.` thousands, `,` decimals. Parse to cents. |
| `maxWeight`  | number  | `20`          | Maximum shipment weight in **grams**. Virtual methods use `0`. |
| `stampPrice` | string  | `"0,95 €"` or `"£3.60"` | Nominal postage in the origin country's currency. Informational only. For GB sellers it is GBP and not directly comparable to `price`. |
| `price`      | string  | `"1,25 €"`    | Buyer-facing gross price in EUR. **Includes Cardmarket's packaging fee.** Excludes Trustee Service, import VAT and customs. Use this for the optimizer. |
| `isLetter`   | boolean | `true`        | Letter vs parcel/parcel-like. Affects packaging fee and whether envelope card-count limits apply. |
| `isVirtual`  | boolean | `false`       | Digital delivery. **Always exclude for physical MTG cards**, even when the price is 0. Some routes have only virtual delivery. |

There is **no** `id`, `eta`, `packagingFee`, `trusteeFee` or currency field.
`maxValue` can be `"1.000,00 €"` or `"150.000,00 €"`; a naive
`parseFloat("1.000,00")` returns `1`, which is the classic bug to avoid.

Assumption: `maxValue` applies to the basket's **article value** (excluding
shipping), consistent with Cardmarket's rule that the declared value must match
the order contents. Verify this at cart time; never under-declare a value to fit
a cheaper method.

### 1.4 Fixtures

| File | Route | Methods | Purpose |
| ---- | ----- | ------- | ------- |
| `tests/fixtures/shipping-de-de.json` | DE→DE (7→7) | 21 | Domestic baseline, cheap tracked letter, DHL/insurance tiers. |
| `tests/fixtures/shipping-de-gb.json` | DE→GB (7→13) | 19 | Tracking cliff: one 20 g letter, then 27.99+ parcels. |
| `tests/fixtures/shipping-gb-de.json` | GB→DE (13→7) | 35 | `stampPrice` in GBP, `price` in EUR; tracked small parcels. |
| `tests/fixtures/shipping-fr-de.json` | FR→DE (12→7) | 39 | Cheap tracked letter (8.15), many Colissimo Ad Valorem tiers. |
| `tests/fixtures/shipping-de-ch.json` | DE→CH (7→4) | 19 | Non-EU example. Byte-identical to DE→GB in this snapshot. |
| `tests/fixtures/shipping-de-jp-virtual-only.json` | DE→JP (7→36) | 1 | Only `Virtual Delivery`; no physical route. |
| `tests/fixtures/shipping-countries.json` | — | 35 countries | Country id mapping, including `INVALID_ID` 0. |
| `tests/fixtures/shipping-eta.json` | selected pairs | 5 | Pair-level average delivery days extracted from the help page's SSR `times[]`, **not** from the shipping API. |

### 1.5 ETA is not in the shipping API

The help page's widget has an "Average Delivery Time (days)" column, but the
shipping API response has no such field. The page's SSR payload contains a
`times[]` array of 1,024 country pairs with `days`, `fromCountryId` and
`toCountryId`. For the requested routes:

| Route | Average days |
| ----- | ------------ |
| DE→DE | 5 |
| DE→GB | 8 |
| GB→DE | 9 |
| FR→DE | 7 |
| DE→CH | 7 |
| DE→JP | no physical route |

This is a **pair-level average**, not a per-method ETA. The widget shows the same
number for every method of a pair. Use it only as a fallback when the seller's
own delivery estimate is unavailable.

### 1.6 Browser access / CORS

The API response does **not** send `Access-Control-Allow-Origin`. A content-script
`fetch` from `https://www.cardmarket.com` to `help.cardmarket.com` will be blocked
by CORS. A Manifest V3 extension should fetch from its background service worker
with a host permission such as `https://help.cardmarket.com/*`; extension-origin
fetches with host permissions are not subject to page CORS. Cache one response
per `(locale, fromCountry, toCountry)` pair (session or 24 h) and never call it
per offer. Cloudflare may set `__cf_bm`; the endpoint is public but undocumented,
so treat 403/429/5xx as a soft failure and fall back to the last-known table or
fixtures with a visible warning.

---

## 2. Parsing euro strings

All money in the optimizer is an **integer number of EUR cents**. Never use
floats for money and never use `parseFloat` directly.

```ts
type Cents = number;

export function parseEuroToCents(raw: string): Cents {
  // Accept only a EUR amount, e.g. "0,95 €", "25,00 €", "1.000,00 €".
  const match = /^\s*([0-9][0-9.,]*)\s*€\s*$/.exec(raw);
  if (!match) throw new Error(`Not a EUR amount: ${raw}`);

  const body = match[1];
  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Both separators: the right-most one is the decimal separator.
    normalized =
      lastComma > lastDot
        ? body.replace(/\./g, '').replace(',', '.')
        : body.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = body.replace(',', '.');
  } else if (lastDot >= 0) {
    // No comma. If every group after the first dot has three digits, the dots
    // are thousands separators ("1.000" = 1000.00, "1.000.000" = 1,000,000.00);
    // otherwise the dot is a decimal point ("1.25" = 1.25).
    const groups = body.split('.');
    const thousandsOnly =
      groups.length > 1 && groups.slice(1).every((g) => g.length === 3);
    normalized = thousandsOnly ? groups.join('') : body;
  } else {
    normalized = body;
  }

  const [whole, fraction = ''] = normalized.split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new Error(`Invalid EUR amount: ${raw}`);
  }
  if (fraction.length > 2) {
    throw new Error(`Too many decimal places: ${raw}`);
  }

  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));

  if (!Number.isSafeInteger(cents)) {
    throw new Error(`EUR amount out of range: ${raw}`);
  }
  return cents;
}
```

Examples:

| Input | Result |
| ----- | ------ |
| `"0,95 €"` | `95` |
| `"25,00 €"` | `2500` |
| `"1.000,00 €"` | `100000` |
| `"150.000,00 €"` | `15000000` |
| `"£3.60"` | throws — not EUR |
| `"1.000"` | `100000` (a three-digit group is read as thousands) |

For `stampPrice`, try `parseEuroToCents` and store `null` on failure. Do not use
`stampPrice` in totals. If you need it for display, show the raw string.

### 2.1 Normalizing a method

```ts
interface RawShippingMethod {
  name: string;
  isTracked: boolean;
  maxValue: string;
  maxWeight: number;
  stampPrice: string;
  price: string;
  isLetter: boolean;
  isVirtual: boolean;
}

interface ShippingMethod {
  methodKey: string;       // stable full-tuple key
  name: string;
  isTracked: boolean;
  maxValueCents: Cents;
  maxWeightG: number;
  stampPriceRaw: string;
  stampPriceCents: Cents | null; // informational only
  priceCents: Cents;       // includes packaging; excludes Trustee
  isLetter: boolean;
  isVirtual: boolean;
}

function normalizeMethod(raw: RawShippingMethod): ShippingMethod {
  let stampPriceCents: Cents | null = null;
  try {
    stampPriceCents = parseEuroToCents(raw.stampPrice);
  } catch {
    // Origin currency is not EUR (e.g. GBP). Keep raw for display.
  }

  const priceCents = parseEuroToCents(raw.price);
  const maxValueCents = parseEuroToCents(raw.maxValue);

  return {
    methodKey: [
      raw.name,
      raw.isTracked,
      maxValueCents,
      raw.maxWeight,
      priceCents,
      raw.isLetter,
      raw.isVirtual,
    ].join('|'),
    name: raw.name,
    isTracked: raw.isTracked,
    maxValueCents,
    maxWeightG: raw.maxWeight,
    stampPriceRaw: raw.stampPrice,
    stampPriceCents,
    priceCents,
    isLetter: raw.isLetter,
    isVirtual: raw.isVirtual,
  };
}
```

Do **not** dedupe methods by `name`. `shipping-de-gb.json` contains five
`"Registered Parcel (DHL Paket Online)"` entries with different `maxWeight`
values (5 kg, 10 kg, 20 kg, 30 kg). They are distinct tiers with the same name.
Use the full tuple as the key; identical tuples can be safely deduped.

---

## 3. Selecting the cheapest viable method

A method is viable for a seller basket only if **all** of these hold:

1. `!isVirtual` — physical cards only.
2. `maxValueCents >= basket.itemsValueCents` — `maxValue` is inclusive.
3. `maxWeightG >= basket.estimatedWeightG` — `maxWeight` is inclusive.
4. If tracking is required, `isTracked === true`.
5. If `isLetter`, the card count is within the letter capacity (see §4.4).
6. Optional: `policy.alwaysTrack` forces tracked even below the threshold.
7. Optional: if the user refuses Trustee fees, exclude tracked methods when
   tracking is not mandatory. This is a user preference, not a default.

```ts
interface BasketEstimate {
  itemsValueCents: Cents; // article value, excluding shipping
  cardCount: number;
  estimatedWeightG: number;
  trackingRequired: boolean;
  trackingReasons: TrackingReason[];
}

interface MethodChoice {
  method: ShippingMethod;
  trusteeFeeCents: Cents;
  comparableTotalCents: Cents; // price + trustee, for ranking only
}

function selectMethod(
  methods: readonly ShippingMethod[],
  basket: BasketEstimate,
  policy: OptimizerPolicy,
): MethodChoice | null {
  const candidates: MethodChoice[] = [];

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

    const trusteeFeeCents = trusteeFee(
      basket.itemsValueCents,
      method,
      policy,
    );

    candidates.push({
      method,
      trusteeFeeCents,
      comparableTotalCents: method.priceCents + trusteeFeeCents,
    });
  }

  candidates.sort(compareMethods);
  return candidates[0] ?? null;
}
```

`compareMethods` is deterministic and uses only integers/strings:

```ts
function compareMethods(a: MethodChoice, b: MethodChoice): number {
  return (
    a.comparableTotalCents - b.comparableTotalCents ||
    a.method.priceCents - b.method.priceCents ||
    Number(b.method.isTracked) - Number(a.method.isTracked) || // prefer protection on tie
    b.method.maxWeightG - a.method.maxWeightG ||               // prefer more headroom
    compareCodeUnits(a.method.methodKey, b.method.methodKey)
  );
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0; // not localeCompare: deterministic across locales
}
```

Why compare `price + trustee` rather than `price` alone? A tracked method with
the same postage as an untracked one still costs more once the Trustee fee is
added. If tracking is not required, the untracked method should win on total
cost; if the user wants protection, `policy.alwaysTrack` makes tracking
mandatory. If two candidates have the same total, the tie-break prefers tracked
(better protection at no extra cost).

### 3.1 Worked selection examples

These use the real fixtures, `gramsPerCard = 2.5`, the conservative letter caps
(4/17/40, and 40 for larger letters), and no `alwaysTrack`. `value` is the
basket article value.

| Route (seller→buyer) | Cards | Value | Tracking | Cheapest viable | Shipping price |
| -------------------- | ----: | ----: | -------- | --------------- | -------------: |
| DE→DE | 1 | 5.00 | no | Standardbrief (20 g) | 1.25 |
| DE→DE | 5 | 20.00 | no | Kompaktbrief (50 g) | 1.40 |
| DE→DE | 20 | 20.00 | no | Grossbrief (500 g) | 2.30 |
| DE→DE | 40 | 100.00 | yes | Grossbrief + Einschreiben EINWURF | 4.65 |
| DE→DE | 40 | 100.01 | yes | DHL Paket (Online, 2 kg) | 7.19 |
| DE→DE | 120 | 100.00 | yes | DHL Paket (Online, 2 kg) | 7.19 |
| DE→GB | 4 | 20.00 | no | Letter (Standardbrief, 20 g) | 1.55 |
| DE→GB | 5 | 20.00 | no | Registered Parcel (DHL Paket Online, 5 kg) | 27.99 |
| DE→GB | 1 | 30.00 | yes | Registered Parcel (DHL Paket Online, 5 kg) | 27.99 |
| DE→GB | 120 | 100.00 | yes | Registered Parcel (DHL Paket Online, 5 kg) | 27.99 |
| DE→GB | 120 | 600.00 | yes | Insured Parcel (DHL Wertpaket 1.000 €, 5 kg) | 41.99 |
| FR→DE | 10 | 20.00 | no | Lettre Internationale (Priority Letter, 100 g) | 5.35 |
| FR→DE | 10 | 30.00 | yes | Lettre Suivie Internationale (Tracked Letter, 50 g) | 8.15 |
| GB→DE | 10 | 20.00 | no | Int. Standard Letter (100 g) | 4.97 |
| GB→DE | 10 | 30.00 | yes | Int. Standard Small Parcel (Online, 250 g) | 20.18 |
| DE→CH | 1 | 30.00 | yes | Registered Parcel (DHL Paket Online, 5 kg) | 27.99 |
| DE→JP | 1 | 30.00 | yes | **none** (virtual only) | — |

`Shipping price` is `method.priceCents`: packaging included, Trustee excluded.
A tracked basket adds the Trustee fee separately (0.5%–1% of the article
value).

Notes on the surprising rows:

- **5 cards DE→GB**: the 20 g letter is capped at 4 cards by Cardmarket's own
  table, so the next physical method is a 27.99 EUR parcel. This is the single
  biggest cliff in the fixtures and a key test case. The `Tracking` column is
  the requirement, not the selected method: this basket does not require
  tracking, but the only physical option is tracked, so Trustee applies. If the
  same 5 cards are available from two sellers, split 2+3: two 1.55 EUR letters
  beat one 27.99 EUR parcel.
- **20 cards DE→DE**: 20 × 2.5 g = 50 g, which is exactly the Kompaktbrief
  weight limit, but the 50 g letter cap is 17 cards. With the cap rule the
  selector moves to Grossbrief. With weight-only logic it would incorrectly
  pick the 1.40 EUR Kompaktbrief. This is why the letter cap is a separate rule.
- **40 cards / 100 EUR DE→DE**: the tracked letter (Grossbrief + Einschreiben)
  has `maxValue = 100,00 €` and `maxWeight = 500 g`. It is viable at exactly
  100.00 and costs 4.65. At 100.01 EUR its `maxValue` fails and the DHL Paket
  (Online) at 7.19 takes over.
- **120 cards DE→DE**: the default conservative letter cap (40 cards) prevents
  a 500 g/1000 g letter from being chosen without dimensional evidence. The
  cheapest safe tracked method is the DHL Paket (Online, 2 kg) at 7.19. The
  optimistic `published` mode may pick the 4.65 tracked Grossbrief; it is
  cheaper but may be rejected at the cart because a sleeved 120-card stack can
  exceed the letter's thickness. Show that as a warning, not as a guarantee.

### 3.2 Boundary semantics

| Rule | Semantics | Test |
| ---- | --------- | ---- |
| Tracking threshold | Tracking is required when `itemsValueCents > 2500` (**strictly greater**). 25.00 is allowed untracked; 25.01 is not. | DE→DE 1 card: 25.00 → 1.25; 25.01 → 3.95 |
| `maxValue` | Inclusive: value `<= maxValue` is allowed. | DE→DE 40 cards: 100.00 → 4.65; 100.01 → 7.19 |
| `maxWeight` | Inclusive: weight `<= maxWeight` is allowed. | GB→DE 40 cards = 100 g → 4.97; 41 cards = 102.5 g → 9.19 |
| Letter cap | Inclusive card count, per weight tier: 20 g → 4, 50 g → 17, 100 g → 40; the conservative default caps larger letters at 40 too. | DE→GB 4 cards → 1.55; 5 cards → 27.99 |
| Virtual | Always excluded for physical cards, even at price 0. | DE→JP 1 card → no method |

### 3.3 Value tiers observed in the fixtures

`maxValue` is not one number per route; it is a ladder of methods. A basket above
a tier must use a higher tier (or be split across sellers). The ladders in this
snapshot:

| Route | Untracked | Tracked / insured |
| ----- | --------- | ----------------- |
| DE→DE | 25 EUR letters | 100 EUR tracked letter; 500 EUR DHL; 2,500 EUR insured; 2,500–150,000 EUR courier estimate |
| DE→GB / DE→CH | 25 EUR letter | 500 EUR registered parcel; 1,000/2,000 EUR insured; 2,500–150,000 EUR courier estimate |
| GB→DE | 25 EUR letters/parcels | 100 EUR tracked small parcel; 250 EUR tracked; 500/1,000/2,500 EUR insured; 2,500–150,000 EUR courier estimate |
| FR→DE | 25 EUR letters | 50 EUR tracked letter/Colissimo; 100/200/500/1,000 EUR Ad Valorem; 2,500–150,000 EUR courier estimate |

This is why the optimizer must check `maxValue` per basket after every
allocation change, not just at the end. It is also why splitting a high-value
cross-border basket can be cheaper than buying one more tier: the next tier may
be a 27.99+ EUR parcel, while two sub-25 EUR letters are 1.55 EUR each.

---

## 4. Fees, tracking and weight

### 4.1 Packaging fee — already inside `price`

Cardmarket adds a packaging fee per shipment:

| Shipment type | Packaging fee |
| ------------- | ------------: |
| Letter < 100 g | 0.30 EUR |
| Letter > 100 g or registered letter | 0.50 EUR |
| Parcel | 1.00 EUR |

The API's `price` already contains it. Evidence from the fixtures:

| Route | Method | `stampPrice` | `price` | Difference |
| ----- | ------ | -----------: | ------: | ---------: |
| DE→DE | Standardbrief | 0.95 | 1.25 | **0.30** |
| DE→DE | Grossbrief | 1.80 | 2.30 | **0.50** |
| DE→DE | Kompaktbrief + Einschreiben EINWURF | 3.45 | 3.95 | **0.50** |
| DE→DE | DHL Päckchen S | 4.19 | 5.19 | **1.00** |
| DE→GB | Letter (Standardbrief) | 1.25 | 1.55 | **0.30** |
| DE→GB | Registered Parcel (DHL Paket Online) | 26.99 | 27.99 | **1.00** |
| FR→DE | Lettre Suivie Internationale | 7.65 | 8.15 | **0.50** |
| GB→DE | Int. Standard Letter | £3.60 | 4.97 | FX + packaging; not a direct EUR delta |

**Implementation rule:** the optimizer's shipping cost is `method.priceCents`.
Do not add the packaging fee again. If you derive a `packagingFeeCents` for
explanation, compute it separately and never add it to `priceCents`. A useful
sanity assertion for EUR-origin methods is
`stampPriceCents + packagingFeeCents === priceCents`; it will not hold for
GBP-origin methods because of currency conversion.

### 4.2 Trustee Service

- Trustee Service is available on **tracked** shipments and holds the seller's
  payment until the buyer confirms arrival. It is not a substitute for tracking;
  it depends on tracking.
- Fee: **0.5% to 1% of the order's total article value**, depending on the
  selected shipping method. All fees are rounded up to the next euro cent, with
  a minimum of 0.01 EUR. Source: Cardmarket fee table.
- The shipping API does **not** expose the Trustee fee or the rate. The method
  `price` deltas in the fixtures are exactly the packaging fee, leaving no room
  for a Trustee fee (e.g. DE→DE tracked letter: 4.15 + 0.50 = 4.65, no 0.5% of
  the value).
- For plan ranking, use a configurable `trusteeRateBps` and default to **1%**
  (the conservative end of the range). Show the 0.5%–1% range in the UI. If the
  exact rate can be read from the cart/checkout preview, use that and re-rank.
- The optimizer must add Trustee only to baskets whose **selected method is
  tracked**. A tracked method chosen voluntarily below 25 EUR also incurs the
  fee. An untracked basket incurs no Trustee fee (but has no Trustee protection).
- If tracking is mandatory, Trustee is effectively mandatory too; a >25 EUR
  order pays tracked postage + Trustee.

### 4.3 Tracking requirements above 25 EUR

From the shipping help page, registered/tracked shipping is mandatory for:

- **Any shipment worth more than 25.00 EUR** (strictly greater; we treat
  "shipment worth" as the article value, excluding shipping; verify at cart).
- Some shipments worth more than 10.00 EUR from a new seller.
- Some shipments from a seller with too many sent-but-not-arrived shipments.
- Any shipment from a seller with a loss rate > 2%.

The New User Guide adds that Trustee Service is used on orders over 25 EUR and
for the first five sales of any new seller. These rules are seller-risk signals,
not something the shipping API can tell you. Model them as a seller flag:

```ts
interface SellerInfo {
  id: string;
  countryId: number;
  minOrderValueCents: Cents;
  requiresTracking: boolean; // new seller / loss rate / too many open shipments
  etaDays?: number;
}
```

If the extension cannot determine seller risk, leave `requiresTracking = false`
but show a warning on high-value private-seller baskets; the user can enable
"always track". Never silently assume an untracked method is allowed just
because the basket is at or below 25 EUR.

### 4.4 Weight estimate and letter caps

Cardmarket computes the real shipping tier from the packed cart. The extension
only has an estimate. A practical planning model is:

```
estimatedWeightG = ceil(cardCount × gramsPerCard × weightSafetyFactor) + extraPackagingG
gramsPerCard = 2.5   // planning estimate; includes average packaging/sleeve weight
```

`2.5 g/card` is an **all-in planning estimate**: a raw MTG card is roughly
1.8 g, leaving about 0.7 g per card for a sleeve and a share of the envelope.
It is not exact:

- Foil/etched cards and some printings are slightly heavier.
- A top loader adds roughly 10–15 g; a rigid cardboard sandwich adds 20–50 g.
  Add these with `extraPackagingG`; do not assume 2.5 g/card covers heavy
  protection. For high-value orders, run the conservative estimate
  (`gramsPerCard = 3.0` or `weightSafetyFactor = 1.05`).
- If you model bare card weight separately, add sleeve/envelope weight
  explicitly; do not double-count the 2.5 g allowance.
- The 4/17/40 card limits for 20/50/100 g letters come from Cardmarket's own
  quick-reference table and are stricter than pure weight for the 20 g and 50 g
  tiers. They account for envelope thickness/dimensions, not just mass.

Recommended `letterCardCapacity`:

| Letter `maxWeight` | Conservative (default) | Optimistic `published` |
| -----------------: | ---------------------: | ---------------------: |
| 20 g | 4 cards | 4 cards |
| 50 g | 17 cards | 17 cards |
| 100 g | 40 cards | 40 cards |
| > 100 g | 40 cards | `floor(maxWeight / gramsPerCard)` |

The conservative default stops at 40 cards because 40 is the largest capacity
Cardmarket publishes, and the API has no dimensions. A 500 g/1000 g letter can
be weight-legal but too thick for a sleeved 100+ card stack. The optimistic
`published` mode extrapolates the larger letter tiers; it can save money but is
not a guarantee. Mark those selections as `letterRisk` and verify at cart time.
The `weight` mode ignores the published caps and is only for sensitivity
analysis.

Sensitivity: at 2.0/2.5/3.0 g per card, a 20-card order is 40/50/60 g, a 40-card
order is 80/100/120 g, and a 120-card order is 240/300/360 g. The 20- and
40-card cases can cross a weight boundary; the 120-card case stays below 500 g
by weight, but the conservative 40-card letter cap sends it to a parcel. Only
the optimistic `published` mode would consider a 500 g/1000 g letter, and that
choice needs dimensional verification. The optimizer should compute the chosen
method with the configured estimate, then optionally recompute with low/high
estimates; if the selected method changes, show a "shipping estimate is near a
boundary" warning rather than silently claiming certainty.

### 4.5 Non-EU routes

- DE→CH is a valid physical non-EU route and, in this snapshot, is identical to
  DE→GB (same methods, same prices). That is a useful reminder that "non-EU" is
  not one shipping zone.
- DE→JP returns only `Virtual Delivery`. There is no physical method in the API
  for that pair; the extension must report "no physical shipping route" rather
  than falling back to a domestic or neighbouring-country table.
- Import VAT, customs duties and carrier handling fees are **not** in the
  shipping API. They can apply to non-EU orders and are outside this model. Flag
  non-EU routes in the UI; do not add speculative tax to the plan total.

---

## 5. Cost model the optimizer should use

For each seller basket `B_s`:

```
itemsValue_s   = Σ unitPrice(o) × qty(o)
cardCount_s    = Σ qty(o)
weight_s       = ceil(cardCount_s × gramsPerCard × safety) + extraPackaging
tracking_s     = itemsValue_s > 2500 || seller.requiresTracking || policy.alwaysTrack
method_s       = cheapest viable method from the seller-country → buyer-country table
shipping_s     = method_s.priceCents                 // includes packaging
trustee_s      = method_s.isTracked
                   ? max(1, ceil(itemsValue_s × trusteeRateBps / 10000))
                   : 0
orderTotal_s   = itemsValue_s + shipping_s + trustee_s
planTotal      = Σ orderTotal_s
```

Important separation:

- `itemsValue_s` is the article value, **excluding shipping**. It drives both
  the 25 EUR tracking rule and the Trustee fee base.
- `shipping_s` is `price`, not `stampPrice`, and not `price + packaging`.
- `trustee_s` is separate and only for tracked methods.
- An open basket must satisfy `itemsValue_s >= seller.minOrderValueCents`
  (assume the minimum is article value, not shipping); otherwise the seller
  cannot be used (add more wants or close the seller).
- The optimizer's "cheapest method" comparator uses `price + trustee` for
  candidate methods; the plan total then adds `shipping + trustee` once.
- All arithmetic is integer cents; weights are integer grams; fees round up.

### 5.1 Why the problem is hard

If shipping were free and there were no seller fixed charges, allocating
quantities to offers would be a transportation problem. The per-seller shipping
method is a **fixed-charge, step-shaped cost**: opening a seller adds postage,
and adding one card can cross `maxValue`/`maxWeight`/25 EUR and jump to a much
more expensive method. The problem contains fixed-charge facility location / set
cover as a special case, so exact optimisation for 20–120 cards and many sellers
is not practical in an extension. The proposal is a deterministic greedy
construction followed by local search; see [`optimizer.md`](./optimizer.md).

---

## 6. Fixture refresh

Fixtures are snapshots. To refresh (requires `curl` and `jq`):

```bash
base='https://help.cardmarket.com/api/shippingCosts?locale=en'
curl -fsS "$base&fromCountry=7&toCountry=7"  | jq . > tests/fixtures/shipping-de-de.json
curl -fsS "$base&fromCountry=7&toCountry=13" | jq . > tests/fixtures/shipping-de-gb.json
curl -fsS "$base&fromCountry=13&toCountry=7" | jq . > tests/fixtures/shipping-gb-de.json
curl -fsS "$base&fromCountry=12&toCountry=7" | jq . > tests/fixtures/shipping-fr-de.json
curl -fsS "$base&fromCountry=7&toCountry=4"  | jq . > tests/fixtures/shipping-de-ch.json
curl -fsS "$base&fromCountry=7&toCountry=36" | jq . > tests/fixtures/shipping-de-jp-virtual-only.json
curl -fsS 'https://help.cardmarket.com/api/countries?page=0&limit=50&locale=en' \
  | jq . > tests/fixtures/shipping-countries.json
```

The ETA fixture was extracted from the `__NUXT_DATA__` payload of
`https://help.cardmarket.com/en/ShippingCosts` (`times[]`). It is not an API
response and does not need refreshing with the shipping endpoint.

---

## 7. Sources

- Shipping Costs and Delivery Times: <https://help.cardmarket.com/en/ShippingCosts>
- Trustee Service: <https://help.cardmarket.com/en/TrusteeService>
- Fee table: <https://www.cardmarket.com/en/Magic/Policies/Fees>
- New User Guide (Trustee on orders >25 EUR, first five sales): <https://help.cardmarket.com/en/new-user-guide>
- Packing Cards: <https://help.cardmarket.com/en/Packaging>
- Shipping methods API: `https://help.cardmarket.com/api/shippingCosts`
- Countries API: `https://help.cardmarket.com/api/countries`
