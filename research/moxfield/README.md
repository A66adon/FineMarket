# Moxfield deck import research

Status: researched **2026-11-02**. Moxfield has **no official public API**; everything below is
reverse-engineered from the public web app and direct HTTP observations. Treat the API as unstable.

Scope of this document: a Chrome/Brave Manifest V3 extension that reads an **open Moxfield deck tab**
and turns the deck into Cardmarket products. It does **not** log in to Moxfield and does not scrape
account pages.

---

## 1. Fixture

Saved from:

```text
GET https://api2.moxfield.com/v3/decks/all/sPueARQ_KHiSbmZbhRYNnA
```

Request headers used for the capture (no cookies, no auth):

```http
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
Accept: application/json, text/plain, */*
Accept-Language: en-US,en;q=0.9
Referer: https://moxfield.com/
Origin: https://moxfield.com
```

Result: `HTTP/2 200`, `content-type: application/json;charset=utf-8`, 527,695 bytes.

Fixture: `tests/fixtures/moxfield-deck-command-tower.json`
SHA-256: `ade643160334b02eea1e98c2d2f9c7d91a632b4f3f628d8bcf3359d2169a17f8`

Deck metadata:

| Field | Value |
|---|---|
| `name` | Weatherlight Labs Secret Vault - Temple of Doom (Public) |
| `publicId` | `sPueARQ_KHiSbmZbhRYNnA` |
| `publicUrl` | `https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA` |
| `format` | `commander` |
| `visibility` | `public` |
| `version` | `0` |
| `lastUpdatedAtUtc` | `2026-06-29T15:03:10.587Z` |

Fixture contents:

| Board | `count` | `Object.keys(cards).length` | Notes |
|---|---:|---:|---|
| `mainboard` | 99 | 99 | all quantities are 1 |
| `commanders` | 1 | 1 | Sisay, foil |
| `maybeboard` | 9 | 9 | excluded by default |
| all other boards | 0 | 0 | see board list below |
| **total** | **109** | **109** | 100 deck cards + 9 considering |

Finish distribution across all 109 entries: **75 `foil`**, **3 `etched`**, **31 `nonFoil`**.
Deck-only (mainboard + commanders): **71 `foil`**, **3 `etched`**, **26 `nonFoil`**.

Important limits of this fixture:

- It contains **no basic lands**, no proxies, no alters, no digital cards, and no non-English
  printings. Those cases need synthetic tests or additional fixtures.
- It does contain useful finish edge cases (`Quirion Ranger`, `Mox Opal`, `Dark Ritual`) and
  multi-face/flavor-name cases.
- All **109/109** entries have `card.cardmarket_id` equal to the `idProduct` in
  `card.cardMarketUrl`.

---

## 2. Deck URL → `publicId`

Canonical deck URL:

```text
https://moxfield.com/decks/{publicId}
```

Accepted forms:

| Input | Result | Notes |
|---|---|---|
| `https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA` | `sPueARQ_KHiSbmZbhRYNnA` | canonical |
| `https://www.moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA` | same | `www` returns 301 to bare host |
| `.../decks/{id}/` | same | trailing slash is harmless |
| `.../decks/{id}?utm_source=...` | same | query ignored |
| `.../decks/{id}#primer` | same | fragment ignored |
| `.../decks/{id}/primer` | reject | API returns 404 for extra path |
| `https://moxfield.com.evil.test/decks/{id}` | reject | host allowlist is exact |
| raw `sPueARQ_KHiSbmZbhRYNnA` | optional | not a URL; support only if useful |

Observed `publicId` format: **22 characters**, base64url alphabet `[A-Za-z0-9_-]`. It is
case-sensitive. Do not lowercase it.

The deck's internal `id` (for example `avma32`) is **not** the public ID and is not accepted by the
API (`/v3/decks/all/avma32` → 404). Only `publicId` works.

```ts
const DECK_PATH = /^\/decks\/([A-Za-z0-9_-]{22})\/?$/;

export function extractMoxfieldPublicId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (host !== "moxfield.com" && host !== "www.moxfield.com") return null;

  return url.pathname.match(DECK_PATH)?.[1] ?? null;
}
```

Implementation notes:

- Use `new URL()` and an exact host allowlist. Do not use `String.replace()` or a substring check;
  `moxfield.com.evil.test` must fail.
- Normalize the deck URL to `https://moxfield.com/decks/${publicId}` and the API URL to
  `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(publicId)}`.
- If Moxfield ever changes the public ID length, relax the regex to a bounded
  `[A-Za-z0-9_-]{16,64}` and let the API validate; do not accept arbitrary path text.
- The page's `<link rel="canonical">` points at the same URL, but the current `location.href` is
  sufficient when the user is on a deck page.

---

## 3. Exact API details

### 3.1 Endpoint

```http
GET https://api2.moxfield.com/v3/decks/all/{publicId}
```

- Auth for `public` and `unlisted` decks: **none** (no cookies or bearer token required).
- Auth for `private` decks: the owner's existing Moxfield session. Anonymous requests must not be
  treated as access.
- Response: one JSON object containing metadata and **all boards**. No per-board requests are
  needed.
- There is a legacy `v2` endpoint (`/v2/decks/all/{publicId}`) with a different, older shape
  (top-level `mainboard`, `commanders`, etc.). Do **not** use it as the primary parser; it is only a
  possible diagnostic fallback.

### 3.2 Required header / bot protection

Moxfield sits behind Cloudflare. A browser-like `User-Agent` is required:

| Request | Result |
|---|---|
| Browser-like Chrome UA | `200 application/json` |
| No `User-Agent` | `403 text/html` Cloudflare "Attention Required!" |
| `User-Agent: curl/8.x` | `403 text/html` Cloudflare |

`Accept: application/json` and `Referer: https://moxfield.com/` are useful for parity but are not
required once the UA is browser-like. In browser JavaScript you **cannot** set `User-Agent`,
`Referer`, or `Origin` manually (forbidden headers); the browser supplies them.

### 3.3 Response headers observed on a public deck

```http
HTTP/2 200
content-type: application/json;charset=utf-8
server: cloudflare
cache-control: no-store
cf-cache-status: BYPASS
access-control-allow-credentials: true
access-control-allow-origin: https://moxfield.com
access-control-expose-headers: ETag,X-Deck-Version,X-Public-Deck-ID,X-Deck-Has-Changed,x-moxfield-version,X-IPCountry,X-Storyblok-Tk-Space,X-Storyblok-Tk-Timestamp,X-Storyblok-Tk-Token
vary: Accept-Encoding, Origin
x-ipcountry: DE
```

Notes:

- `Access-Control-Allow-Origin` is origin-reflective for `https://moxfield.com` and
  `https://www.moxfield.com`; it is **not** permissive for arbitrary origins.
- `ETag`, `X-Deck-Version`, `X-Public-Deck-ID`, and `X-Deck-Has-Changed` are listed as exposed, but
  our anonymous GET did **not** return them. Treat them as optional optimizations only; never require
  them.
- `cache-control: no-store` means do not rely on the HTTP cache. Cache in extension memory keyed by
  `publicId + version` if desired.

### 3.4 Errors

`404` is a JSON problem document, not HTML:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not Found",
  "status": 404,
  "traceId": "00-23ad4834b5f4ff44bbc836d08b6104ec-81a27ee420e6df4e-00"
}
```

A Cloudflare block is HTML:

```text
HTTP/2 403
content-type: text/html
<title>Attention Required! | Cloudflare</title>
```

Private/unlisted behavior:

- **Unlisted** decks are link-accessible. We verified `visibility: "unlisted"` returns `200` without
  auth when the public ID is known. Do not label unlisted as private.
- **Private** decks should be treated as unavailable to anonymous requests. Expect `401`/`403`/`404`
  depending on Moxfield's current behavior. The only supported path is an existing logged-in tab
  session (see fallback ladder); never attempt a login flow.

Suggested status handling:

| Status / content | Meaning | Action |
|---|---|---|
| `200`, JSON | success | validate shape and `publicId` |
| `200`, HTML | unexpected/interstitial | treat as Cloudflare/page failure |
| `401` | auth required | page-context fetch, then stop |
| `403`, HTML | Cloudflare bot block | page-context fetch; do not retry aggressively |
| `403`, JSON | forbidden/private | page-context fetch if the user has access |
| `404` | not found, private, or invalid ID | page-context fetch; otherwise actionable error |
| `429` | rate limited | back off, do not hammer |
| `5xx` | Moxfield/Cloudflare error | one retry with jitter, then fallback |

### 3.5 Direct fetch helper

```ts
export async function fetchMoxfieldDeck(
  publicId: string,
  signal?: AbortSignal,
): Promise<MoxfieldDeck> {
  const res = await fetch(
    `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(publicId)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      signal,
    },
  );

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("application/json")) {
    const body = (await res.text()).slice(0, 500);
    throw new MoxfieldHttpError(res.status, contentType, body);
  }

  const deck = (await res.json()) as MoxfieldDeck;
  if (deck.publicId !== publicId) {
    throw new Error("Moxfield returned a different deck");
  }
  return deck;
}
```

Use an `AbortController` with a ~10 second timeout. Read the body as text before parsing in the
error path so an HTML Cloudflare page is not passed to `JSON.parse`.

---

## 4. TypeScript-shaped model

### 4.1 Raw v3 response

These are the fields relevant to import. The full response contains many more metadata fields
(affiliates, hubs, legalities, media, etc.) that should be ignored.

```ts
export type MoxfieldBoardName =
  | "commanders"
  | "companions"
  | "signatureSpells"
  | "mainboard"
  | "sideboard"
  | "maybeboard"
  | "stickers"
  | "attractions"
  | "contraptions"
  | "schemes"
  | "planes"
  | "tokens";

export type MoxfieldFinish = "nonFoil" | "foil" | "etched";

export interface MoxfieldDeck {
  /** Internal short ID, e.g. "avma32". NOT the public URL ID. */
  id: string;
  /** 22-character public URL ID. This is what the API path uses. */
  publicId: string;
  publicUrl: string;
  name: string;
  description: string;
  /** e.g. "commander", "modern", "oathbreaker". */
  format: string;
  visibility: "public" | "unlisted" | "private" | (string & {});
  /** Monotonically useful for cache invalidation; observed integer. */
  version: number;
  createdAtUtc: string;
  lastUpdatedAtUtc: string;
  mainCardIdIsBackFace: boolean;
  enableMultiplePrintings: boolean;
  includeBasicLandsInPrice: boolean;
  includeCommandersInPrice: boolean;
  includeSignatureSpellsInPrice: boolean;
  /** All 12 boards were present in every observed v3 response. */
  boards: Record<MoxfieldBoardName, MoxfieldBoard>;
  /**
   * Representative/thumbnail card, not a deck entry. In the fixture this is
   * Sisay (mh1 29), while boards.commanders is Sisay (sld 1444, foil).
   * Never import this as an extra card.
   */
  main?: MoxfieldCard;
  /**
   * Derived token/related-card list. NOT the token board. See §5.3.
   * In the fixture: 20 entries, only 5 with isToken === true.
   */
  tokens?: MoxfieldCard[];
  /** Metadata about the deck this was forked from. Not cards. */
  originalDeck?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface MoxfieldBoard {
  /** Sum of quantity across entries, NOT Object.keys(cards).length. */
  count: number;
  /** Key = entry's card.uniqueCardId (also the entry key). */
  cards: Record<string, MoxfieldDeckEntry>;
}

export interface MoxfieldDeckEntry {
  quantity: number;
  /** Redundant with the board key; trust the board key if they disagree. */
  boardType: MoxfieldBoardName;
  /** Authoritative selected finish. */
  finish: MoxfieldFinish;
  /** True only for regular foil; false for etched. Use finish as source of truth. */
  isFoil: boolean;
  isAlter: boolean;
  /** Moxfield UI calls this "Playtest Card", not a physical proxy. */
  isProxy: boolean;
  card: MoxfieldCard;
  useCmcOverride?: boolean;
  useManaCostOverride?: boolean;
  useColorIdentityOverride?: boolean;
  usePrimaryTypeOverride?: boolean;
  excludedFromColor?: boolean;
  cmcOverride?: string | number | null;
  manaCostOverride?: string | null;
  [key: string]: unknown;
}

export interface MoxfieldCard {
  /** Moxfield printing ID, used in /cards/{id}-{slug} and DOM row keys. */
  id: string;
  /** Deck-entry identity; equals the key in board.cards. */
  uniqueCardId: string;
  /** Scryfall printing UUID; best external printing identity. */
  scryfall_id: string;
  set: string;
  set_name: string;
  /** Oracle/English card name; may contain " // " for multi-face cards. */
  name: string;
  /** Alternate printed name, e.g. Secret Lair flavor name. Not an identity key. */
  flavor_name?: string;
  /** Collector number as a string; may contain letters, '-', '★', 'a', 'p'. */
  cn: string;
  layout: string;
  cmc: number;
  /** Opaque numeric string; observed "2".."8". Use type_line, not this. */
  type: string;
  /** Can be null for reversible cards; fall back to card_faces[0].type_line. */
  type_line: string | null;
  oracle_text?: string | null;
  printed_text?: string | null;
  mana_cost?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors: string[];
  color_identity: string[];
  color_indicator?: string[];
  legalities?: Record<string, string>;
  digital: boolean;
  /** Printing availability, NOT the selected finish. */
  foil: boolean;
  nonfoil: boolean;
  etched: boolean;
  glossy?: boolean;
  rarity: string;
  border_color?: string;
  flavor_text?: string | null;
  lang: string;
  prices?: MoxfieldPrices;
  card_faces?: MoxfieldCardFace[];
  /** Cardmarket idProduct for this printing/version; may be null. */
  cardmarket_id: number | null;
  /** Full Cardmarket URL with idProduct query; may be null. */
  cardMarketUrl: string | null;
  set_type?: string;
  isToken?: boolean;
  isTemporary?: boolean;
  /** Default finish for the printing; NOT necessarily the selected finish. */
  defaultFinish?: MoxfieldFinish;
  [key: string]: unknown;
}

export interface MoxfieldCardFace {
  id?: string;
  name: string;
  mana_cost?: string;
  type_line: string;
  oracle_text?: string;
  colors: string[];
  color_indicator?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  image_seq?: number;
}

export interface MoxfieldPrices {
  usd?: number | null;
  usd_foil?: number | null;
  eur?: number | null;
  eur_foil?: number | null;
  ck?: number | null;
  ck_foil?: number | null;
  tix_fb?: number | null;
  lastUpdatedAtUtc?: string;
  [key: string]: number | string | null | undefined;
}
```

### 4.2 Normalized import row

Keep the raw printing identity and the selected finish separate from any "cheapest printing"
resolution. The product says never silently change printing/language/condition.

```ts
export type MoxfieldSkipReason =
  | "boardNotSelected"
  | "invalidEntry"
  | "proxy"
  | "alter"
  | "digital"
  | "token"
  | "nonEnglish"
  | "basicLand"
  | "unresolvedProduct";

export interface MoxfieldImportCard {
  board: MoxfieldBoardName;
  /** Key in board.cards === card.uniqueCardId. */
  entryKey: string;
  quantity: number;

  name: string;
  set: string;
  collectorNumber: string;
  setName: string;
  scryfallId: string;
  moxfieldCardId: string;

  /** Exact selected finish from the deck. */
  finish: MoxfieldFinish;
  /** Raw API flag; false for etched. Prefer finish. */
  isFoil: boolean;
  isEtched: boolean;
  isAlter: boolean;
  isProxy: boolean;
  isDigital: boolean;

  language: string;
  isEnglish: boolean;
  isBasicLand: boolean;
  /** Front-face type line, with card_faces fallback. */
  typeLine: string;

  /** Exact Cardmarket product/version for this printing. */
  cardmarketProductId: number | null;
  cardMarketUrl: string | null;

  prices?: MoxfieldPrices;
}

export interface MoxfieldImportResult {
  deck: {
    publicId: string;
    name: string;
    format: string;
    visibility: string;
    version: number;
  };
  cards: MoxfieldImportCard[];
  skipped: Array<{
    board: MoxfieldBoardName;
    entryKey: string;
    name: string;
    quantity: number;
    reason: MoxfieldSkipReason;
  }>;
  fidelity: "api" | "page-context" | "dom";
}
```

---

## 5. Boards

### 5.1 Board list and semantics

Moxfield's own board order (observed in the web bundle):

```text
commanders, companions, signatureSpells, mainboard, sideboard, maybeboard,
stickers, attractions, contraptions, schemes, planes, tokens
```

Every v3 response observed included all 12 keys, even when empty. Guard at runtime anyway.

| Key | Moxfield UI label | `count` semantics | Recommended default |
|---|---|---|---|
| `mainboard` | Main Deck | sum of quantities | **ON** |
| `commanders` | Commander | sum of quantities | **ON** if non-empty |
| `companions` | Companion | sum of quantities | **ON** if non-empty |
| `sideboard` | Sideboard | sum of quantities | **ON only** for formats with a real sideboard; OFF for Commander-like formats |
| `maybeboard` | Considering / Saved for Later | sum of quantities | **OFF** |
| `tokens` | Tokens | sum of quantities | **OFF** |
| `signatureSpells` | Signature Spell | sum of quantities | **ON only** for Oathbreaker/Pendragon |
| `attractions` | Attraction Deck | sum of quantities | **ON only** if the format allows it and non-empty |
| `stickers` | Sticker Sheets | sum of quantities | **ON only** if the format allows it and non-empty |
| `contraptions` | Contraption Deck | sum of quantities | **ON only** for formats that use it and non-empty |
| `planes` | Planar Deck | sum of quantities | **ON only** for formats that use it and non-empty |
| `schemes` | Schemes | sum of quantities | **ON only** for formats that use it and non-empty |

Rationale for the defaults:

- A purchase should start with cards that actually count toward the deck. Moxfield's own format
  rules define Commander as `100` cards across `mainboard + commanders`, and mark Commander-like
  formats with `ignoresSideboard: true`. Sideboard is therefore off for Commander.
- Companions are part of deck registration and should be included when present.
- Maybeboard is not part of the deck. Tokens are not physical deck cards.
- Special boards (attractions, stickers, contraptions, planes, schemes) are real cards in the
  formats that use them, so include them when non-empty and allowed.
- Unknown/future boards: default **OFF**, show their count, and do not guess.

This is a product recommendation, not an API fact. Whatever the UI defaults are, the raw parser must
not bake board selection into the API model.

### 5.2 `count` is not the number of entries

`board.count` is the **sum of quantities**; `Object.keys(board.cards).length` is the number of unique
entries (different printings/finishes are separate entries).

Verified on another public deck: `boards.mainboard.count === 99`, but `Object.keys(cards).length ===
70` because 14 Mountains and 17 Plains are single entries with quantity > 1.

Always iterate:

```ts
for (const [entryKey, entry] of Object.entries(board.cards)) {
  // entry.quantity may be > 1
}
```

Never use:

```ts
for (let i = 0; i < board.count; i++) { /* wrong for multi-quantity entries */ }
```

### 5.3 Three different "token" concepts

| Field | What it is | Import? |
|---|---|---|
| `boards.tokens.cards` | The user's explicit token board | Only if the user selects the token board |
| top-level `tokens` | Derived token/related-card list for the deck | **No** |
| `tokensToCards` / `cardsToTokens` / `tokenMappings` | Mapping between source cards and derived tokens | **No** |

The fixture has `boards.tokens.count === 0`, but top-level `tokens` has **20** entries (only 5 with
`isToken === true`), and the Moxfield page shows **Tokens (2)** after grouping by token name. Do not
use the top-level array as deck contents. If you add a "tokens" toggle, decide explicitly whether it
means the explicit board or the derived token list; they are not the same.

### 5.4 `main` is not a deck entry

Top-level `main` is a representative card, not a board entry. In the fixture:

- `main` = Sisay, `set: "mh1"`, `cn: "29"`.
- `boards.commanders.cards[...]` = Sisay, `set: "sld"`, `cn: "1444"`, finish `foil`.

Importing `main` would add a duplicate and the wrong printing. Ignore it.
`mainCardIdIsBackFace` is metadata about that representative card; it is not needed for board parsing.

`originalDeck` is also metadata about a forked/original deck (it has its own `publicId` and
`visibility`); do not follow it or import its cards.

### 5.5 Board selection example

For a `format: "commander"` deck:

```text
ON:  mainboard, commanders, companions (if non-empty),
     attractions/stickers (only if non-empty)
OFF: sideboard, maybeboard, tokens, signatureSpells,
     contraptions, planes, schemes
```

For a 60-card constructed deck (`modern`, `pioneer`, `legacy`, `pauper`, etc.):

```text
ON:  mainboard, sideboard, companions (if non-empty)
OFF: commanders, maybeboard, tokens, signatureSpells,
     attractions, stickers, contraptions, planes, schemes
```

For Oathbreaker/Pendragon:

```text
ON:  mainboard, commanders, signatureSpells, companions (if non-empty)
OFF: sideboard, maybeboard, tokens, special boards unless non-empty/allowed
```

If you do not want a format table, use the conservative MVP default
`mainboard + commanders + companions` and make every other board an explicit toggle. Do not silently
drop non-empty special boards; show their counts.

---

## 6. Card entry and card fields

### 6.1 Entry fields

| Field | Type | Observed / meaning |
|---|---|---|
| `quantity` | `number` | integer; can be > 1; sum it |
| `boardType` | `string` | redundant with board key; trust the board |
| `finish` | `"nonFoil" \| "foil" \| "etched"` | **authoritative selected finish** |
| `isFoil` | `boolean` | true for regular foil; **false for etched** |
| `isAlter` | `boolean` | altered card |
| `isProxy` | `boolean` | Moxfield "Playtest Card" |
| `card` | `MoxfieldCard` | printing and metadata |
| `useCmcOverride`, `useManaCostOverride`, ... | optional booleans | deck-editor overrides; ignore for purchase |
| `cmcOverride`, `manaCostOverride` | optional | ignore for purchase |
| `excludedFromColor` | optional boolean | deck stats only |

For forward compatibility, treat missing `isAlter`/`isProxy` as `false` and missing `finish` as
derived from `isFoil`, but log a schema warning. Do not infer etched from `card.etched`.

### 6.2 Card fields used by import

| Field | Type | Notes |
|---|---|---|
| `card.name` | `string` | oracle/English name; may contain `" // "` |
| `card.flavor_name` | `string?` | alternate printed name (Secret Lair); **not** identity |
| `card.set` | `string` | lowercase set code |
| `card.set_name` | `string` | display name |
| `card.cn` | `string` | collector number; can be `1444`, `1012a`, `253p`, `SHM-258`, `1543★` |
| `card.type_line` | `string \| null` | can be null for reversible cards |
| `card.card_faces` | array? | use `card_faces[0].type_line` if top-level null |
| `card.digital` | `boolean` | digital-only printing |
| `card.lang` | `string` | printing language, `"en"` for English |
| `card.cardMarketUrl` | `string \| null` | contains `idProduct` |
| `card.cardmarket_id` | `number \| null` | same product ID; fallback |
| `card.scryfall_id` | UUID string | exact printing identity |
| `card.id` | string | Moxfield printing ID; DOM links |
| `card.uniqueCardId` | string | entry key; equals board `cards` key |
| `card.prices` | object? | reference prices only; finish-specific fields may be absent |
| `card.foil` / `nonfoil` / `etched` | boolean | **availability**, not selection |
| `card.defaultFinish` | `MoxfieldFinish?` | default for printing, not selection |
| `card.isToken` / `set_type` / `layout` | mixed | token-like detection |
| `card.glossy` | boolean? | promo attribute; a real card, not a finish |

### 6.3 Edge cases that matter

**Finish is not `isFoil`, `card.etched`, or `defaultFinish`.**

- `Quirion Ranger` (MH2 285): entry `finish: "foil"`, `isFoil: true`, but `card.etched: true`,
  `card.defaultFinish: "nonFoil"`. `card.etched` only says an etched printing exists.
- `Mox Opal` (SLD 1072): entry `finish: "etched"`, `isFoil: false`, `card.etched: true`,
  `card.defaultFinish: "etched"`.
- `Dark Ritual` (STA 26): entry `finish: "etched"`, `isFoil: false`, `card.etched: true`,
  `card.defaultFinish: "nonFoil"`. `defaultFinish` is not the selection either.

Rule: **`entry.finish` is the only authoritative selected finish.** Use `isFoil` only when `finish`
is missing in older data. Never use `card.etched` or `card.defaultFinish` to decide the selected
finish.

**`type_line` can be null on reversible cards.**

Observed on a public deck with `Krark, the Thumbless` (SLD 1543★, `layout: "reversible_card"`):
top-level `type_line` is `null`, `colors` is `[]`, but `card_faces[0].type_line` is
`"Legendary Creature — Goblin Wizard"`. Always fall back to the front face.

**Multi-face cards.**

- `modal_dfc`: top-level `type_line` contains both faces separated by `" // "`.
- `transform`: same.
- `reversible_card`: top-level `type_line` may be null; use `card_faces[0]`.
- For basic-land/type checks, inspect the **front face only**. Do not use `some()` across all faces,
  or an MDFC with a land back would be misclassified as a land.
- `card.name` for MDFC includes both faces, e.g.
  `"King T'Challa // Black Panther, Hope Enduring"`. `cardmarket_id` is the exact product; if
  resolving by name, use the full `card.name`, not only the front face.

**`cn` is not an integer.**

Observed values include `1012a`, `253p`, `SHM-258`, and `1543★`. Keep it as a string. Never
`parseInt` it or use it as a number.

**`name` vs `flavor_name`.**

The fixture's commander has `card.name: "Sisay, Weatherlight Captain"` and
`card.flavor_name: "Buttercup, Provincial Princess"`. The rendered Moxfield DOM shows the printed
flavor name ("Buttercup..."), while the API `name` is the oracle name. Cardmarket product titles may
use either. Use `cardmarket_id` for exact matching; if name matching is unavoidable, use `card.name`
and treat `flavor_name` as a display alias, not the identity.

**`board.count` vs entries** — see §5.2.

**Quantity > 1** — see §5.2. Do not assume one row = one card.

**`cardMarketUrl` may be missing.**

Digital cards, tokens, and some unreleased/promo cards may have `cardMarketUrl: null` and/or
`cardmarket_id: null`. Fall back to `cardmarket_id`; if both are missing, mark `unresolvedProduct`
and require manual review. Do not guess by name in an automatic purchase path.

**Prices are reference data only.**

`card.prices` contains provider-specific, finish-specific fields (e.g. only `eur_foil` for a
foil-only printing). Fields are optional and may be stale. `lastUpdatedAtUtc` is the price timestamp.
Never use Moxfield prices as Cardmarket offer prices; use the live Cardmarket product/offers.

**`visibility: "unlisted"` is not private.** It is link-accessible and returned 200 without auth in
our test. `private` is the only inaccessible case for an anonymous fetch.

**`publicId` is case-sensitive.** Preserve it exactly.

**Short internal IDs do not work.** `/v3/decks/all/avma32` → 404; only the 22-char `publicId` works.

**Unknown future `finish` values.** Validate against the three known values. If unknown:
- do not silently map to `nonFoil`;
- use `isFoil` only if it is unambiguous;
- otherwise mark the entry unresolved and surface it.

---

## 7. Parsing `idProduct` from `card.cardMarketUrl`

Typical value:

```text
https://www.cardmarket.com/en/Magic/Products?idProduct=746100&referrer=moxfield&utm_campaign=card_prices&utm_medium=text&utm_source=moxfield
```

`idProduct` is the Cardmarket **product/version** ID. `card.cardmarket_id` is the same number in the
fixture (109/109 match). Do not confuse it with Cardmarket's `idMetaproduct` (the card-level page that
groups versions).

```ts
const CARDMARKET_HOSTS = new Set(["cardmarket.com", "www.cardmarket.com"]);

export function parseCardmarketProductId(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!CARDMARKET_HOSTS.has(url.hostname.toLowerCase())) return null;

  const rawId = url.searchParams.get("idProduct");
  if (!rawId || !/^\d+$/.test(rawId)) return null;

  const id = Number(rawId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
```

Fallback:

```ts
const productId =
  parseCardmarketProductId(card.cardMarketUrl) ??
  (Number.isSafeInteger(card.cardmarket_id) && (card.cardmarket_id ?? 0) > 0
    ? card.cardmarket_id
    : null);
```

Implementation notes:

- Parse with `URL`/`URLSearchParams`, not by splitting the string on `&`.
- Cardmarket URLs may be localized (`/en/`, `/de/`, ...) or use `www.` / bare host; only the host and
  `idProduct` matter.
- Strip tracking parameters (`referrer`, `utm_*`) when constructing a canonical URL:
  `https://www.cardmarket.com/en/Magic/Products?idProduct=${id}`.
- `idProduct` identifies the printing/version, **not the finish**:
  - non-foil and foil offers normally live under the same product ID, filtered by finish;
  - foil-etched is a **separate Cardmarket version/product** (Cardmarket does not expose etched as a
    generic attribute). Moxfield's `cardMarketUrl` for an etched entry already points at the etched
    version. Do not remap it to a regular foil product.
- If both URL and `cardmarket_id` are missing, do not invent an ID. Mark unresolved.

### 7.1 Finish → Cardmarket mapping

| Moxfield `finish` | Cardmarket product | Offer filter |
|---|---|---|
| `nonFoil` | `idProduct` | non-foil |
| `foil` | `idProduct` | foil |
| `etched` | `idProduct` (already the etched version) | foil/etched version; do not switch to regular foil |

This preserves the deck's finish. If the exact finish is unavailable, surface it as a trade-off; do
not silently substitute.

---

## 8. Recommended import policy

The following defaults satisfy the product principles: do not silently change language, condition,
printing, finish, or card identity; make board/basic choices explicit.

### 8.1 Board selection

Use the format-aware defaults in §5.1. In short:

- **ON:** `mainboard`; `commanders` and `companions` when non-empty and applicable.
- **ON when part of the format:** `sideboard` for 60-card constructed; `signatureSpells` for
  Oathbreaker/Pendragon; special boards when the format allows them and they are non-empty.
- **OFF:** `maybeboard`, `tokens`, unknown boards.
- Always expose every board as a toggle and show its card/quantity count.

### 8.2 Basic-land detection

Default: **include basic lands** in the purchase, with a visible toggle to exclude them. Omitting
them by default silently changes the deck; including them is the safer default for a complete-deck
buy. If the product decides most users own basics, set the default to off but show the excluded
count and never hide the choice.

Do not detect basics by name. Use the front-face type line:

```ts
export function frontTypeLine(card: MoxfieldCard): string {
  const top = card.type_line?.trim() ?? "";
  const front = card.card_faces?.[0]?.type_line?.trim() ?? "";
  return (top || front).split(/\s*\/\/\s*/)[0].trim();
}

export function isBasicLand(card: MoxfieldCard): boolean {
  const typeLine = frontTypeLine(card);
  return /\bBasic(?: Snow)? Land\b/i.test(typeLine);
}
```

This matches:

- `Basic Land — Plains`
- `Basic Land — Mountain`
- `Basic Snow Land — Forest` (snow basics)
- `Basic Land — Wastes` (Wastes)

and does not match `Land`, `Legendary Land`, `Snow-Covered Forest` only by name, or a land on the back
face of an MDFC.

Moxfield's own UI helper special-cases `Wastes` (excluded unless an internal flag) and requires a
snow flag for `Basic Snow Land`. If you need exact parity with Moxfield's deck-stat counters, mirror
those exceptions. For a purchase importer, the type-line rule above is the safer, literal rule. Do
not match on card names, because names are localized for non-English printings.

Excluding basics must apply after board selection and must exclude all basic lands in the selected
boards, not just one printing.

### 8.3 Foil / etched handling

Default: **preserve the selected finish exactly**.

- Use `entry.finish` (`nonFoil` | `foil` | `etched`).
- `entry.isFoil` is only a fallback when `finish` is missing; it is false for etched.
- Never use `card.etched` (availability) or `card.defaultFinish` (printing default) to choose the
  finish.
- Cardmarket: foil/non-foil share a product ID; etched is a separate version. Use Moxfield's
  `idProduct` for etched and do not remap.
- If the exact finish is unavailable or the user asks for cheapest, show the substitution explicitly
  (for example, "deck has foil; cheapest offer is non-foil"). Do not silently switch.

### 8.4 Proxies, alters, digital, tokens

Default: **skip from the purchase and report**.

| Condition | Meaning | Default | If user opts in |
|---|---|---|---|
| `entry.isProxy === true` | Moxfield "Playtest Card" | skip (`proxy`) | show as proxy; no Cardmarket product |
| `entry.isAlter === true` | altered card | skip (`alter`) | buy the underlying card, label it altered |
| `card.digital === true` | digital-only printing | skip (`digital`) | no paper purchase |
| `card.isToken === true`, `set_type === "token"`, token layouts | token/emblem/etc. | skip (`token`) | not a deck card |
| `card.glossy === true` | glossy promo, still a real card | include | no special handling |
| `card.isTemporary === true` | temporary card | skip/inspect | do not buy blindly |

Token-like layouts include `token`, `double_faced_token`, `emblem`, `art_series`, `vanguard`, and
`double_sided`. Moxfield's own helper also treats `name === "City's Blessing"` and
`type_line === "Dungeon"` as non-cards; consider the same guard for purchase.

Report counts by reason. A skipped proxy/alter/digital card should not silently disappear from the
review screen.

### 8.5 English-only behavior

Default: **English printings only**.

- English means `card.lang` is `"en"` (normalize case; Moxfield uses lowercase).
- If `lang` is missing/empty, treat it as unknown and skip with a warning; do not assume English.
- Do **not** silently map a non-English deck entry to an English printing. That is a language
  substitution and must be an explicit user choice.
- If the user enables "match English printing", resolve the same card to an English printing and
  show the original language/printing alongside the substitute. Use `scryfall_id`/Scryfall
  `oracle_id` or name + set, not the localized `card.name` alone.
- Independently, Cardmarket offer queries should use `language=1` (English) and `minCondition=EX` as
  specified by the product. Moxfield `lang` is not a substitute for the Cardmarket offer filter.
- A non-English basic land is still basic; the language filter wins first and reports `nonEnglish`
  rather than `basicLand`.

Suggested skip order and reasons:

```text
boardNotSelected → invalidEntry → proxy → alter → digital → token
→ nonEnglish → basicLand → unresolvedProduct
```

Report the first matching reason; counts by reason may overlap if you want full diagnostics.

---

## 9. Fallback ladder

Moxfield is a client-rendered React SPA. Its initial HTML is a small loading shell with no
`__NEXT_DATA__` or embedded deck JSON; the deck is fetched from `api2.moxfield.com` after JavaScript
runs. Therefore:

1. Try the direct API from the extension background.
2. If blocked/failed, fetch the same API **in the open Moxfield tab's page context** with the tab's
   session.
3. If that fails but the deck page is already rendered, scrape the **table DOM** as a degraded
   fallback.
4. Otherwise stop with an actionable error. Never attempt to log in.

```text
background API fetch
  └─ 200 JSON → validate → import
  └─ 403 HTML / CORS / 401 / 404 / 5xx
       └─ page-context fetch (credentials: include)
            └─ 200 JSON → validate → import (full fidelity, works for private decks the user can see)
            └─ fail
                 └─ DOM table scrape (only if the deck is visibly rendered)
                      └─ name + quantity + board + foil hint only → manual review
                      └─ fail → actionable error
```

### 9.1 Why not only background fetch?

- In MV3, an extension service worker with matching `host_permissions` is CORS-exempt, so the
  background **can** fetch `api2.moxfield.com` without the server's CORS header.
- But Cloudflare may still reject extension-origin traffic, and background fetch has no Moxfield
  session cookies for private decks.
- A content script in the isolated world is subject to the page's CORS rules; `api2` reflects
  `https://moxfield.com` and `https://www.moxfield.com`, so a page-context fetch from a Moxfield tab
  works and carries the user's session.
- Page-context fetch is the highest-fidelity fallback and the only supported path for private decks
  the user can already see.

### 9.2 Page-context fetch (preferred fallback)

Manifest pieces:

```json
{
  "permissions": ["scripting", "activeTab", "storage"],
  "host_permissions": [
    "https://moxfield.com/*",
    "https://www.moxfield.com/*",
    "https://api2.moxfield.com/*"
  ]
}
```

- `scripting` allows `chrome.scripting.executeScript`.
- `host_permissions` for `moxfield.com` allows injection; for `api2` allows the background fetch.
- `activeTab` grants temporary access after the user invokes the extension. If you need to find a
  non-active Moxfield tab without a gesture, add `"tabs"` as well.
- Validate the tab URL and extracted `publicId` **before** injecting. Never let a content script pass
  an arbitrary URL to your fetch helper (open-proxy risk).

```ts
export async function fetchMoxfieldDeckInTab(
  tabId: number,
  publicId: string,
): Promise<MoxfieldDeck> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [publicId],
    func: async (id: string) => {
      const res = await fetch(
        `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(id)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include",
          cache: "no-store",
        },
      );
      return {
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body: await res.text(),
      };
    },
  });

  const result = injection?.result as
    | { status: number; contentType: string; body: string }
    | undefined;
  if (!result) throw new Error("Moxfield tab returned no result");

  if (result.status !== 200 || !result.contentType.includes("application/json")) {
    throw new MoxfieldHttpError(result.status, result.contentType, result.body.slice(0, 500));
  }

  const deck = JSON.parse(result.body) as MoxfieldDeck;
  if (deck.publicId !== publicId) throw new Error("Moxfield returned a different deck");
  return deck;
}
```

Key details:

- `world: "MAIN"` is important: it runs with the page's origin and cookies. The function is
  serialized; do not close over outer variables—pass values through `args`.
- `credentials: "include"` uses the user's existing Moxfield session. This is not a login and does
  not read cookies directly.
- Parse the returned text in the extension, not in the page.
- If the tab is on `www.moxfield.com`, it redirects to bare `moxfield.com`; both origins are reflected
  by the API. Normalize for navigation.
- If the page CSP blocks the fetch (unlikely, since Moxfield itself calls `api2`), catch the error and
  go to DOM fallback.
- If the tab is discarded, loading, or not a deck page, `executeScript` fails. Ask the user to open the
  deck; do not inject into a random tab.
- The URL check should be exact:
  `extractMoxfieldPublicId(tab.url) === publicId`, and the host must be `moxfield.com` or
  `www.moxfield.com`.

### 9.3 DOM fallback (last resort)

Preconditions: the tab is a Moxfield deck page and the deck UI is visibly rendered (not a Cloudflare
challenge, login page, or loading shell). Use stable `data-testid` attributes, never hashed CSS class
names.

Observed table selectors (2026-11-02):

| Element | Selector |
|---|---|
| Deck title | `[data-testid="deck-name"]` |
| Deck row | `[data-testid="deck-view-table-row"]` |
| Card name link | `[data-testid="deck-view-table-row-name"]` |
| Considering toggle | `[data-testid="deck-view-list-considering-toggle"]` |
| Tokens toggle | `[data-testid="deck-view-list-tokens-toggle"]` |
| Board section title | `[data-testid="deck-view-header-options-title"]` |
| Board section total | `[data-testid="deck-view-header-options-total"]` |

Row attributes in the fixture:

```html
<li data-row-key="mainboard-commander-0|g3n0Z" data-testid="deck-view-table-row">
  <div>1</div>
  <a data-testid="deck-view-table-row-name" href="/cards/g3n0Z-sisay-weatherlight-captain">
    ...
  </a>
</li>
```

The prefix is a **display board**, not always the API board key. The commander row is
`mainboard-commander-0`, not `commanders-*`; a naive `left.split("-")[0]` would import the commander
as a mainboard card and miss the `commanders` board. Map `mainboard` + `commander` to `commanders`
(and `mainboard` + `companion` to `companions` if that is how companions are displayed), then verify
the category strings against a deck that has each board populated.

```ts
const DECK_BOARDS = new Set<MoxfieldBoardName>([
  "commanders", "companions", "signatureSpells", "mainboard", "sideboard",
  "maybeboard", "stickers", "attractions", "contraptions", "schemes",
  "planes", "tokens",
]);

function scrapeMoxfieldTable() {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="deck-view-table-row"]'),
  );

  return rows.flatMap((row) => {
    const rowKey = row.getAttribute("data-row-key") ?? "";
    const [left, moxfieldCardId] = rowKey.split("|");
    const [displayBoard, category] = (left ?? "").split("-");

    // Row keys use a display board + category, not always the API board key.
    // Commander rows are "mainboard-commander-*", not "commanders-*".
    let board: MoxfieldBoardName | undefined;
    if (displayBoard === "mainboard" && category === "commander") {
      board = "commanders";
    } else if (displayBoard === "mainboard" && category === "companion") {
      board = "companions";
    } else {
      board = displayBoard as MoxfieldBoardName | undefined;
    }

    // The table also contains non-deck "cost-*" package rows.
    if (!board || !DECK_BOARDS.has(board)) return [];

    const link = row.querySelector<HTMLAnchorElement>(
      '[data-testid="deck-view-table-row-name"]',
    );
    const name = (link?.textContent ?? "").replace(/\s+/g, " ").trim();
    const quantityText = row.firstElementChild?.textContent?.trim() ?? "";
    const quantity = Number.parseInt(quantityText, 10);

    if (!name || !Number.isInteger(quantity) || quantity <= 0) return [];

    const foilHint = Boolean(
      row.querySelector('[aria-label="Foil"], .foil-box, [data-tooltip="Foil"]'),
    );

    return [{ board, moxfieldCardId: moxfieldCardId ?? "", name, quantity, foilHint }];
  });
}
```

DOM fallback limitations — this is why it is last resort:

| Data | API | DOM |
|---|---|---|
| Board | exact | display board + category; commander rows use `mainboard-commander-*` |
| Name | oracle name | printed name (may be `flavor_name`) |
| Quantity | exact | exact |
| Finish | `nonFoil` / `foil` / `etched` | foil badge or none; **etched is not distinguishable** |
| Set / `cn` | exact | missing |
| `scryfall_id` | exact | missing |
| `cardmarket_id` / `idProduct` | exact | missing |
| Language | exact | missing |
| `isProxy` / `isAlter` / `digital` | exact | missing |

Specific gotchas verified on the fixture:

- The table renders **100 deck rows** (1 commander + 99 mainboard), while the page has 109 total
  entries because `Considering (9)` is collapsed. Click the considering toggle only if that board is
  selected.
- The commander row uses `data-row-key="mainboard-commander-0|..."`; its API board is `commanders`.
  A naive first-segment parser misclassifies it as mainboard. Map the `commander` category to
  `commanders`.
- The table had **108** `[data-testid="deck-view-table-row"]` elements: 100 deck rows plus 8
  non-deck `cost-*` package rows. Filter by known board prefix/category.
- All 3 etched entries rendered a **Foil** badge; the DOM cannot distinguish etched from regular
  foil.
- The commander row shows the printed flavor name "Buttercup, Provincial Princess", not the API
  oracle name "Sisay, Weatherlight Captain". Do not use DOM names for exact product matching.
- `data-row-key` contains the Moxfield `card.id` (e.g. `g3n0Z`), not `uniqueCardId`, and not the
  Cardmarket product ID. The link `/cards/{moxfieldId}-{slug}` is a Moxfield card page, not a
  Cardmarket product.
- The page is a SPA; wait for rows. If zero rows, the page is still loading, is Cloudflare-blocked, or
  is in a non-table view. Do not scrape the loading shell.
- Hashed CSS classes (e.g. `XIi4jFys2lGhYwseGpBo`) change between builds; use `data-testid`.

Use DOM fallback only for a **manual review list** (name, quantity, board, foil hint). Do not
auto-resolve to Cardmarket products or auto-add to cart from DOM data.

### 9.4 Private / unlisted decks

- **Unlisted:** direct API works if the public ID is known. It is not a private deck; import normally.
- **Private, user is owner/authorized:** direct API without cookies may 404/403; page-context fetch
  with `credentials: "include"` in the open tab can return 200. This is the intended path.
- **Private, user is not authorized:** page-context fetch returns 401/403/404 and the page itself
  shows a not-found/login state. Stop and tell the user to open a deck they can access. Do not attempt
  login, do not ask for credentials, do not read cookies directly, and do not try ID guessing.
- If the page is behind a Cloudflare challenge, ask the user to finish it manually in the tab. Do not
  solve CAPTCHAs, use proxies, or spoof fingerprints.
- Never call Moxfield's account/token endpoints (e.g. `/v1/account/token/refresh`); that is a login
  flow and out of scope.

### 9.5 Error taxonomy

```ts
export type MoxfieldErrorCode =
  | "NOT_MOXFIELD_URL"
  | "INVALID_PUBLIC_ID"
  | "CLOUDFLARE_BLOCKED"
  | "NOT_FOUND_OR_PRIVATE"
  | "NOT_AUTHORIZED"
  | "RATE_LIMITED"
  | "SCHEMA_CHANGED"
  | "PAGE_FETCH_FAILED"
  | "DOM_INCOMPLETE"
  | "UNRESOLVED_PRODUCT";
```

User-facing guidance:

| Code | Message |
|---|---|
| `NOT_MOXFIELD_URL` | "Open a Moxfield deck page first." |
| `INVALID_PUBLIC_ID` | "This does not look like a Moxfield deck URL." |
| `CLOUDFLARE_BLOCKED` | "Moxfield blocked the request. Open the deck tab and retry." |
| `NOT_FOUND_OR_PRIVATE` | "Deck not found or private. Open it in Moxfield while logged in." |
| `NOT_AUTHORIZED` | "You do not have access to this deck." |
| `RATE_LIMITED` | "Moxfield is rate-limiting requests. Wait a moment and retry." |
| `SCHEMA_CHANGED` | "Moxfield's response format changed; import stopped rather than guessing." |
| `PAGE_FETCH_FAILED` | "Could not read the deck from the open tab. Try reloading it." |
| `DOM_INCOMPLETE` | "The deck page is not fully rendered. Switch to table view and retry." |
| `UNRESOLVED_PRODUCT` | "No Cardmarket product found for this card. Review it manually." |

Never import partial data silently. If schema validation fails, stop and report; a wrong cart is worse
than no cart.

### 9.6 Caching and rate limits

- One deck fetch returns all boards; do not fetch each card or each board separately.
- Cache in extension memory keyed by `publicId + version`; invalidate when `version` changes.
- Respect `cache-control: no-store`; do not rely on HTTP caching.
- Self-impose a small delay/one-request-per-import policy. Moxfield publishes no rate limit.
- On `429`, back off. Do not retry a Cloudflare 403 in a loop.
- Do not persist private deck JSON unless the user explicitly asks; no telemetry.

---

## 10. Implementation checklist

- [ ] Parse the active tab URL with `new URL()`; accept only `moxfield.com` / `www.moxfield.com`
      and `/decks/{22-char publicId}`; normalize to bare host.
- [ ] Try direct `GET https://api2.moxfield.com/v3/decks/all/{publicId}` with `Accept:
      application/json`, `cache: "no-store"`, and a ~10s timeout.
- [ ] Check `content-type` before `JSON.parse`; treat HTML 403 as Cloudflare, not as a deck.
- [ ] Validate `deck.publicId`, `deck.boards`, and board shapes; stop on schema mismatch.
- [ ] On direct failure, run `chrome.scripting.executeScript` in the open Moxfield tab with
      `world: "MAIN"`, `credentials: "include"`, and the same API URL.
- [ ] Validate the tab's host and `publicId` before injecting; never accept an arbitrary URL from a
      content script.
- [ ] Only if both API paths fail and the deck is visibly rendered, scrape
      `[data-testid="deck-view-table-row"]`; filter `cost-*` rows by known board prefix and map
      `mainboard-commander-*` to `commanders`.
- [ ] Iterate `Object.entries(board.cards)`, not `board.count`; multiply by `quantity`.
- [ ] Apply the format-aware board defaults; keep every board an explicit toggle; show counts.
- [ ] Compute `isBasicLand` from the front-face `type_line`; apply the basic-land toggle after board
      selection; report excluded counts.
- [ ] Normalize `finish` from `entry.finish`; use `isFoil` only as fallback; never use
      `card.etched`/`card.defaultFinish` as the selected finish.
- [ ] Skip proxies, alters, digital, and token-like cards by default; report each reason.
- [ ] Enforce English-only via `card.lang === "en"`; do not silently map non-English entries.
- [ ] Parse `idProduct` with `URLSearchParams`, fall back to `card.cardmarket_id`, and validate a
      positive safe integer.
- [ ] Keep `cardmarketProductId` + `finish` together; do not collapse different printings/finishes
      into one row. Sum quantities only for identical product + finish.
- [ ] Preserve the raw printing (`set`, `cn`, `scryfall_id`) and the resolved product; show any
      cheapest-printing substitution as a trade-off.
- [ ] Surface Cloudflare/private/schema/DOM errors with actionable text; never log in or solve
      challenges.
- [ ] Add tests for the fixture and synthetic basics/proxy/alter/digital/non-English/null-type-line
      cases.

---

## 11. Test matrix

### 11.1 URL / ID parsing

```ts
expect(extractMoxfieldPublicId(
  "https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA/",
)).toBe("sPueARQ_KHiSbmZbhRYNnA");

expect(extractMoxfieldPublicId(
  "https://www.moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA?utm_source=x",
)).toBe("sPueARQ_KHiSbmZbhRYNnA");

expect(extractMoxfieldPublicId(
  "https://moxfield.com.evil.test/decks/sPueARQ_KHiSbmZbhRYNnA",
)).toBeNull();

expect(extractMoxfieldPublicId(
  "https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA/primer",
)).toBeNull();
```

### 11.2 `idProduct`

```ts
expect(parseCardmarketProductId(
  "https://www.cardmarket.com/en/Magic/Products?idProduct=746100&referrer=moxfield",
)).toBe(746100);

expect(parseCardmarketProductId("https://www.cardmarket.com/en/Magic/Products?idProduct=abc"))
  .toBeNull();

expect(parseCardmarketProductId("https://example.com/?idProduct=746100")).toBeNull();
```

### 11.3 Fixture assertions

- `deck.publicId === "sPueARQ_KHiSbmZbhRYNnA"`.
- Board totals: mainboard 99, commanders 1, maybeboard 9, all others 0.
- Total entries: 109; deck-only entries: 100.
- Finish counts all: 75 foil / 3 etched / 31 nonFoil.
- Finish counts deck-only: 71 foil / 3 etched / 26 nonFoil.
- `boards.mainboard.count === Object.keys(boards.mainboard.cards).length` for this fixture because
  every quantity is 1; do not generalize.
- All 109 entries: `parseCardmarketProductId(card.cardMarketUrl) === card.cardmarket_id`.
- `Quirion Ranger`: `finish === "foil"`, `isFoil === true`, `card.etched === true`,
  `card.defaultFinish === "nonFoil"`.
- `Mox Opal`: `finish === "etched"`, `isFoil === false`, `card.etched === true`.
- `Dark Ritual`: `finish === "etched"`, `isFoil === false`, `card.defaultFinish === "nonFoil"`.
- `main.set === "mh1"` but the commander entry is `set: "sld"`, `cn: "1444"`, foil.
- `boards.tokens.count === 0`; top-level `tokens.length === 20`;
  `tokens.filter(t => t.isToken).length === 5`.
- `King T'Challa // Black Panther, Hope Enduring` has two `card_faces` and a combined top-level
  `type_line`.
- `Sisay` has `name: "Sisay, Weatherlight Captain"` and
  `flavor_name: "Buttercup, Provincial Princess"`.

### 11.4 Synthetic cases not covered by the fixture

Add small hand-authored entries or additional fixtures for:

- `Plains`, `Snow-Covered Forest` (`Basic Snow Land`), `Wastes`, and a nonbasic land.
- `type_line: null` with a populated `card_faces[0].type_line` (reversible card).
- `isProxy: true`.
- `isAlter: true`.
- `card.digital: true`.
- `card.lang: "de"` / `"ja"` / missing.
- `card.cardMarketUrl: null` with a valid `cardmarket_id`.
- Both `cardMarketUrl` and `cardmarket_id` null.
- Quantity > 1.
- Unknown/missing `finish` with `isFoil` true/false.
- A private/unlisted deck response and a 404/403 HTML response.
- DOM fallback: 100 deck rows + `cost-*` rows, commander encoded as `mainboard-commander-*`,
  collapsed maybeboard/tokens, etched shown as foil.

---

## 12. Open questions / product decisions

These are recommendations, not API facts; confirm with the product owner:

1. **Basics default:** include by default (recommended, avoids silently dropping cards) or exclude by
   default (many players own basics)?
2. **Non-English default:** skip (recommended, no silent language substitution) or offer an explicit
   "match English printing" flow?
3. **Tokens toggle:** does it mean `boards.tokens` (explicit board) or top-level `tokens` (derived
   tokens shown by the UI)? They differ; the fixture has 0 vs 20.
4. **Sideboard default:** on for 60-card constructed (part of the submitted deck) or always off until
   the user enables it?
5. **Printing strategy:** preserve the deck's exact printing via `cardmarket_id`, or optimize to the
   cheapest English printing? If optimizing, show every printing/finish substitution.
6. **Private deck UX:** how prominently to ask the user to open the deck tab while logged in, versus
   failing immediately?
7. **Finish substitutions:** if the deck asks for etched/foil but only regular/non-foil offers exist,
   is that an error, a trade-off, or a user setting?

---

## 13. References

- Deck fixture API:
  `https://api2.moxfield.com/v3/decks/all/sPueARQ_KHiSbmZbhRYNnA`
- Public deck page:
  `https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA`
- Cardmarket, "Differentiating Foils" (foil-etched is a separate version, not an attribute):
  `https://help.cardmarket.com/en/Foils`
- Chrome extensions, cross-origin network requests:
  `https://developer.chrome.com/docs/extensions/develop/concepts/network-requests`
- Moxfield has no official public API; the endpoints above are reverse-engineered and may change
  without notice.
