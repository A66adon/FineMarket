# Cardmarket HTML parsing (MTG)

Research for the Chrome extension. Everything here was derived from the checked-in
fixtures and spot-checked against the live logged-out site on **2026-11-02**.
No application code is changed by this document.

## TL;DR

1. An offer is `div.article-row[id="articleRow{idArticle}"]`, not a table row. The
   numeric article id comes from the element id.
2. `/en/Magic/Products?idProduct={idProduct}` is one exact printing. It redirects
   to `/en/Magic/Products/Singles/{ExpansionSlug}/{ProductSlug}`.
   `/en/Magic/Cards/{slug}` is the metaproduct: all printings/versions of the card.
3. **`?language=1` is accepted on both page types. `?minCondition=EX` does not
   work.** The accepted condition value is numeric (`1` = Mint … `7` = Poor);
   use `minCondition=3` for EX-or-better. Live test: `minCondition=EX` returned
   the same PO/PL/GD rows as no filter, while `minCondition=3` returned only
   EX/NM. The metaproduct language result set was verified directly; the product
   page reflects `language=1` as a checked filter.
4. Initial HTML contains **50 rows**. Logged out, "Show more results" returns
   "Log in to see more offers." Logged in, the load-more form/reference
   implementation append 50 at a time, but the site hard-caps at **300 articles**
   per product/metaproduct page.
5. Logged out, every offer (seller, country, type, sales, condition, language,
   flags, price, quantity, comment) is visible. Only the buy action is a login
   link, and ETA/calendar data is absent. Logged in, purchasable rows are
   expected to expose an input group and sellers may expose an ETA via
   `.fonticon-calendar`.

---

## Fixtures and page kinds

| File | Page kind | Key ids |
| --- | --- | --- |
| `tests/fixtures/cardmarket-product-command-tower.html` | exact printing | `idProduct=844281`, article rows |
| `tests/fixtures/cardmarket-versions-command-tower.html` | version gallery | 125 version cards |
| `tests/fixtures/cardmarket-metaproduct-command-tower.html` | metaproduct | `idMetacard=203332`, article rows |
| `tests/fixtures/cardmarket-metaproduct-command-tower.html` | JSON string wrapper | decoded to the file above |

The metaproduct fixture was stored as a JSON string literal. It was decoded with
`json.loads(...)` and written to
`tests/fixtures/cardmarket-metaproduct-command-tower.html`
(414,270 characters of HTML, same page as the other two fixtures).

Examples:

* Product: Command Tower (V.9), Secret Lair Drop Series, `idProduct=844281`.
* Metaproduct: Command Tower, `idMetacard=203332`, 125 versions, 123,733 offers.
* Versions: `/en/Magic/Cards/Command-Tower/Versions`, 125 cards.

---

## 1. Exact selectors

All selectors are for the English locale (`/en/`). Bootstrap 5 tooltips use
`data-bs-original-title`; a few image tooltips use `data-bs-title`. Always read
both, then `title`, then `aria-label`.

```ts
function tooltipText(el: Element | null): string | null {
  if (!el) return null;
  const raw =
    el.getAttribute("data-bs-original-title") ??
    el.getAttribute("data-bs-title") ??
    el.getAttribute("title") ??
    el.getAttribute("aria-label");
  if (!raw) return null;
  return raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
```

### 1.1 Row identity

| Field | Selector | Notes |
| --- | --- | --- |
| Offer row | `.article-table .table-body > .article-row` | Prefer this over a bare `.article-row`; AJAX pages append here. |
| Row fallback | `div.article-row[id^="articleRow"]` | There are 50 rows initially. |
| Article id | `id.match(/^articleRow(\d+)$/)` | `articleRow2049568859` → `2049568859`. |
| Row kind | `#FilterForm input[name="idProduct"]` vs `input[name="idMetacard"]` | Product vs metaproduct. |
| Load-more kind | `#loadMore form[data-ajax-action]` | `Product_LoadMoreArticles` or `Metacard_LoadMoreArticles`. |

### 1.2 Seller

Seller block: `.col-seller .seller-name`.

| Field | Selector | Notes |
| --- | --- | --- |
| Seller name | `.seller-name a[href*="/Users/"]` | Link text is the username; href is `/en/Magic/Users/{name}`. |
| Seller country | `.seller-name .icon[aria-label^="Item location: "]` | `aria-label="Item location: Finland"`; fallback the same element's `data-bs-original-title`. |
| Seller type: Professional | `.seller-name .fonticon-users-professional[aria-label="Professional"]` | Empty icon span; parse the label, not text. |
| Seller type: Powerseller | `.seller-name .fonticon-users-powerseller[aria-label="Powerseller"]` | Same pattern. |
| Seller type: Private | no type icon | Default to `private` when neither icon exists. |
| Sales count (badge) | `.seller-name .sell-count` | Text may be abbreviated: `1` + nested `K`, `2` + `M`. **Do not parse the text alone.** |
| Exact sales / available | `.sell-count[data-bs-original-title]` | `"513 Sales | 1238 Available items"` with NBSP; parse both integers. |
| Seller rating / warnings | legacy `.seller-extended [data-bs-toggle="tooltip"]` | Not present in these logged-out fixtures. Optional; skip unless needed. |

Sales parsing:

```ts
const tip = tooltipText(row.querySelector(".seller-name .sell-count"));
const sales = tip?.match(/([\d.,]+)\s*Sales/)?.[1];
const available = tip?.match(/([\d.,]+)\s*Available items/)?.[1];
// "513 Sales | 1238 Available items" -> 513, 1238
```

`availableItems` is the seller's total stock, **not** the number of copies in
this offer. The offer quantity is in `.item-count` (see 1.4).

### 1.3 Condition, language, printing flags, expansion, rarity

Product block: `.col-product .product-attributes`.

| Field | Selector | Notes |
| --- | --- | --- |
| Condition | `.article-condition` | Badge text `MT/NM/EX/GD/LP/PL/PO`; class is `condition-mt` … `condition-po`; tooltip is the full name (`Near Mint`). |
| Language | `.product-attributes > span.icon.me-2[aria-label]` | Current markup. `aria-label="English"`, `"French"`, etc. Fallback: the element immediately after `.article-condition`. |
| Foil | `[aria-label="Foil"]` or `[data-bs-original-title="Foil"]` | Use both selectors. |
| Signed | `[aria-label="Signed"]` or `[data-bs-original-title="Signed"]` | Absent in these MTG fixtures. |
| Altered | `[aria-label="Altered"]` or `[data-bs-original-title="Altered"]` | Absent in these fixtures. |
| First edition | `[aria-label="First Edition"]` / `[aria-label="1st Edition"]` (and the `data-bs-original-title` equivalents) | Not an MTG concept; support both labels for other games. |
| Reverse holo | `[aria-label="Reverse Holo"]` or `[data-bs-original-title="Reverse Holo"]` | Not present in MTG. |
| Expansion (metaproduct row) | `.product-attributes > a.expansion-symbol[aria-label]` | The anchor contains only an icon; the name is in `aria-label` / `data-bs-original-title`. `href` points to `/en/Magic/Expansions/{slug}`. |
| Rarity (metaproduct row) | the `svg` immediately after `.expansion-symbol` | `svg[aria-label="Common"]`; use `aria-label` / `data-bs-original-title`. In JS, `svg.className` is an object, so select by tag/aria-label, not class string. |
| Expansion (product page) | `#tabContent-info .info-list-container dt` "Printed in" → next `dd a[href*="/Expansions/"]` | Text is the expansion name; the same `dd` also contains an icon anchor. |
| Rarity (product page) | same `dl`, `dt` "Rarity" → next `dd [aria-label]` | `aria-label="Rare"`. |

Product-page rows do **not** repeat the expansion or rarity; take them from the
page header. Metaproduct rows do **not** contain the exact product name/version
text; see §2.3 for deriving the printing.

Comments (both page kinds): `.col-product .product-comments`.

```ts
const desktop = row.querySelector(".product-comments .d-none.d-lg-block span");
const mobile = row.querySelector(".product-comments .fonticon-comments");
const comment = tooltipText(desktop) ?? tooltipText(mobile);
```

Some rows have no comment; that is normal.

### 1.4 Price, quantity, buy action

Offer block: `.col-offer`.

| Field | Selector | Notes |
| --- | --- | --- |
| Price | `.col-offer .price-container span.text-nowrap` (use the **last** match) | Text `0,75 €`; may have extra spans/sup for VAT or "Only tracked shipping to …". |
| Quantity | `.col-offer .amount-container .item-count` | Integer copies in this offer (may be 1, 4, 47, …). |
| Buy action | `.col-offer .actions-container` | See §4. |

Do **not** select the first `.price-container` or `.amount-container` in the
row. Metaproduct rows also contain a mobile duplicate in
`.col-product .mobile-offer-container`; scope to `.col-offer`.

Price parsing: Cardmarket uses comma decimals and dot thousands, e.g.
`1.234,56 €` → `123456` cents. The shown price is per copy; the total for the
offer is `price × quantity` (before shipping).

### 1.5 ETA / calendar (logged-in only)

Not present in the checked-in logged-out fixtures. In a logged-in session the
seller block can contain:

```html
<span class="fonticon-calendar"
      data-bs-toggle="tooltip"
      data-bs-original-title="..."></span>
```

Selector: `.seller-name .fonticon-calendar[data-bs-toggle="tooltip"]`.
Parse the tooltip with `:\s*(\d+)`:

* last number → ETA to the buyer's country (`etaLocationDays`);
* one preceding number, when present → the seller's general ETA (`etaDays`);
* no calendar element → both null, do not invent an ETA.

This parsing strategy is used by the MIT-licensed `cardmarket_wizard`
(`single_page.dart` / `card_page.dart`, `.fonticon-calendar` + `:\s*(\d+)`).
The exact English tooltip wording is not observable without an account, so do
not match on the words; parse the colon-prefixed numbers.

### 1.6 Show Versions link

On the exact-printing page only, in the product header definition list:

```html
<dt>Reprints</dt>
<dd>
  <a href="/en/Magic/Cards/Command-Tower/Versions">Show Versions (124)</a><br>
  <a href="/en/Magic/Cards/Command-Tower">Show Offers</a>
</dd>
```

Selectors:

```ts
// Product page header is #tabContent-info .info-list-container dl
const versionsLink =
  document.querySelector('#tabContent-info .info-list-container a[href$="/Versions"]') ??
  document.querySelector('a[href*="/Cards/"][href$="/Versions"]');

const offersLink =
  document.querySelector('#tabContent-info .info-list-container a[href*="/Cards/"]:not([href$="/Versions"])');
```

* `href` is `/en/Magic/Cards/{slug}/Versions`.
* Anchor text is `Show Versions (124)`; the number is a **reprint count**, not
  necessarily the metaproduct's total version count. The metaproduct header for
  the same card says `125 versions` / `No. of Versions 125`. Do not equate them.
* `Show Offers` already points at the metaproduct URL, so prefer it when present.

If the product has no reprints, the `Reprints` row may be absent entirely. Treat
the exact product page as the only page for that printing; do not fabricate a
metaproduct URL.

### 1.7 Page header facts

| Page | Container | Labels |
| --- | --- | --- |
| Product | `#tabContent-info .info-list-container dl` | `Rarity`, `Number`, `Printed in`, `Reprints`, `Available items`, `From`, `Price Trend`, `30-days average price`, `7-days average price`, `1-day average price` |
| Metaproduct | `#info .infoContainer dl` | `No. of Available Items`, `No. of Versions`, `Available from`, `Price Trend` |

Product name: first text node of `h1` (`Command Tower (V.9)`); the following
`span.h4` is the expansion/subtitle (`Secret Lair Drop Series - Singles`).
Metaproduct name: first text node of `h1` (`Command Tower`); the following span
is the version count (`125 versions`).

Page ids:

```ts
const idProduct = document.querySelector<HTMLInputElement>('#FilterForm input[name="idProduct"]')?.value;
const idMetacard = document.querySelector<HTMLInputElement>('#FilterForm input[name="idMetacard"]')?.value;
```

---

## 2. Exact printing vs metaproduct

### 2.1 Exact printing — `/en/Magic/Products?idProduct={idProduct}`

This page is one product/printing. Example: `idProduct=844281` is
**Command Tower (V.9)**, Secret Lair Drop Series, rare, number 7030. It redirects
to the canonical slug:

```text
/en/Magic/Products?idProduct=844281
  → /en/Magic/Products/Singles/Secret-Lair-Drop-Series/Command-Tower-V9
```

All offers on the page are for that exact printing. The header shows its
expansion, rarity, collector number, reprint links, and the printing's available
items/price stats. Offer rows omit expansion/rarity because every row is the
same printing.

Query parameters survive the redirect (verified with
`?language=1&minCondition=EX`: the final URL kept both parameters).

### 2.2 Metaproduct — `/en/Magic/Cards/{slug}`

This page is the card across all printings. Example:
`/en/Magic/Cards/Command-Tower` (`idMetacard=203332`) has 125 versions and
123,733 available items. Offer rows are a price-sorted mix of different
printings/versions, so the cheapest row may be a different printing than the one
the user wants. Rows repeat expansion + rarity, and the thumbnail identifies the
printing.

`/en/Magic/Cards/{slug}/Versions` is **not** the metaproduct offers page. It is
the version gallery: 125 cards, each linking to an exact product page. On the
fixture the gallery is `#ReprintSection a.card[href*="/Magic/Products/"]`; each
card has `img[alt]` (e.g. `Command Tower (V.3)`), an expansion name in the `h3`,
`Version N`, `N Available`, and `From …`. Images are lazy-loaded: most cards have
`src="/img/transparent.gif"` and the real image URL in `data-echo`, so read
`data-echo ?? src` when extracting the product id from the image path.

### 2.3 Deriving the metaproduct URL from Show Versions

The Show Versions href is:

```text
/en/Magic/Cards/Command-Tower/Versions
```

Strip the trailing `/Versions` (and any query/hash) to get the metaproduct:

```text
/en/Magic/Cards/Command-Tower
```

```ts
function metaproductUrl(versionsHref: string, base = location.origin): URL {
  const u = new URL(versionsHref, base);
  u.pathname = u.pathname.replace(/\/Versions\/?$/, "");
  u.search = "";
  u.hash = "";
  return u;
}
```

The product header's `Show Offers` link is already this URL, so use it first:

```ts
const meta = offersLink?.href ??
  metaproductUrl(versionsLink!.getAttribute("href")!);
```

Deriving the exact printing from a **metaproduct row** is different: the row has
no product link. Read the thumbnail tooltip, which contains escaped HTML:

```html
<span class="thumbnail-icon"
      data-bs-title='&lt;img src="https://product-images.s3.cardmarket.com/1/SLDOE/914156/914156.jpg" alt="Command Tower"&gt;'>
```

The image path is `/1/{SET}/{idProduct}/{idProduct}.jpg`. Extract the repeated
numeric segment:

```ts
function productIdFromThumbnail(row: Element): number | null {
  const title = tooltipText(row.querySelector(".col-icon .thumbnail-icon"));
  const m = title?.match(/\/1\/[^/]+\/(\d+)\/\1\.jpg/);
  return m ? Number(m[1]) : null;
}
```

Then the stable exact-printing URL is:

```text
https://www.cardmarket.com/en/Magic/Products?idProduct=914156
```

That URL redirects to the canonical product slug. This was verified for the
product fixture (`og:image` ends in `/1/SLD/844281/844281.jpg` and
`idProduct=844281`). Do not use the row's `.expansion-symbol` href as a product
URL; it points to the expansion.

Practical consequence: to compare printings, group metaproduct offers by
`productId`, then either query each exact product page or use the versions
gallery to map `productId → {printing name, expansion, version}`.

---

## 3. Filters and pagination

### 3.1 Query filters (verified live)

Recommended URLs:

```text
https://www.cardmarket.com/en/Magic/Products?idProduct=844281&language=1&minCondition=3
https://www.cardmarket.com/en/Magic/Cards/Command-Tower?language=1&minCondition=3
```

| Parameter | Accepted values | Verified behavior |
| --- | --- | --- |
| `language` | `1` = English, `2` = French, `3` = German, `4` = Spanish, `5` = Italian, `6` = S-Chinese, `7` = Japanese, `8` = Portuguese, `9` = Russian, `10` = Korean, `11` = T-Chinese, `12` = Dutch, `13` = Polish, `14` = Czech, `15` = Hungarian | `language=1` is accepted on both page kinds. Product fixture: 50/50 English, and the product filter UI checks `language[1]=1`. Metaproduct Command Tower without filter: 39 EN / 7 FR / 3 ES / 1 IT; with `language=1`: 50/50 EN (directly verified). Reference implementations join multiple ids with commas (`language=1,2`); only the single-language form was independently verified here. |
| `minCondition` | numeric `1` Mint, `2` NM, `3` EX, `4` GD, `5` LP, `6` PL, `7` Poor | `minCondition=3` filters both page kinds to EX or better. On Underground Sea metaproduct: no filter = PO 18 / PL 17 / LP 7 / GD 6 / EX 2; `minCondition=3` = EX 33 / NM 17. On the exact Revised Underground Sea product: no filter = PO 17 / PL 14 / LP 11 / GD 7 / EX 1; `minCondition=3` = EX 33 / NM 17. |
| `minCondition=EX` | **not accepted** | Returns exactly the unfiltered rows (PO/PL/GD included) on both product and metaproduct pages. This is the parameter spelling in `PRODUCT.md`; it is wrong. Use the numeric value. The filter UI also uses numeric option values and does not reflect `minCondition=EX`. |

Other filter names in the form are POST names (`sellerCountry[13]`,
`sellerType[1]`, `language[1]`, `extra[isSigned]`, `extra[isAltered]`,
`extra[isFoil]`, etc.). Do not assume every POST name is a working GET
parameter. `language` and `minCondition` were verified on GET; use those.

```ts
const CONDITION_ID = { MT: 1, NM: 2, EX: 3, GD: 4, LP: 5, PL: 6, PO: 7 } as const;

function withOfferFilters(url: URL, minCondition: keyof typeof CONDITION_ID = "EX") {
  url.searchParams.set("language", "1");                 // English
  url.searchParams.set("minCondition", String(CONDITION_ID[minCondition]));
  return url;
}

withOfferFilters(new URL("https://www.cardmarket.com/en/Magic/Cards/Command-Tower"));
// -> .../Cards/Command-Tower?language=1&minCondition=3
```

`filterSettings` sent by the load-more JS is a JSON object, for example:

```json
{"idLanguage":{"1":1},"condition":["MT","NM"]}
```

Condition arrays are prefixes from Mint through the selected minimum. The
reference `cw-wizard` builds exactly this and also supports `isReverse`,
`isSigned`, `isFirstEd`, `isAltered`.

### 3.2 Rows per page and the hard cap

* Initial server HTML: **50 rows** on both page kinds.
* `#articlePage` hidden input starts at `1`; the load-more form is in
  `.table-footer #loadMore`.
* Logged in: the load-more form and the reference implementation indicate each
  "Show more results" request appends **50** rows (not directly observed without
  an account). The site shows:
  `We only show the first 300 articles. Please use the filters for more precise results.`
  (`#MaxResultsReachedNotice`, hidden with `d-none` until reached). So the
  maximum is **300 offers per product/metaproduct page**, i.e. 6 batches of 50.
* Logged out: the button is present, but clicking it POSTs and returns a system
  message: **"Log in to see more offers."** Row count stays at 50. Public pages
  therefore expose only the first 50 offers.
* The 300 cap is a hard site limit, not a parser limit. If the extension needs
  more coverage, split the query by seller country, condition, language, price
  range, or query exact product pages individually. Do not assume the first 300
  offers cover every seller.

### 3.3 How to paginate

Preferred method for an extension: click the real button and let Cardmarket
compute the CSRF token and `filterSettings`.

```ts
async function loadAllOffers(doc: Document, maxRows = 300): Promise<Element[]> {
  const seen = new Set<string>();
  const rows: Element[] = [];
  const collect = () => {
    for (const row of doc.querySelectorAll(".table-body > .article-row")) {
      const id = row.id.replace(/^articleRow/, "");
      if (!seen.has(id)) { seen.add(id); rows.push(row); }
    }
  };
  collect();

  while (rows.length < maxRows) {
    const btn = doc.querySelector<HTMLButtonElement>("#loadMoreButton");
    if (!btn || btn.hidden || btn.offsetParent === null) break;
    const before = rows.length;
    btn.click();
    // Wait until row count grows, or the login/max notice appears.
    await waitFor(() =>
      doc.querySelectorAll(".article-row").length > before ||
      doc.querySelector("#MaxResultsReachedNotice:not(.d-none)")
    );
    const after = doc.querySelectorAll(".article-row").length;
    if (after === before) break;
    collect();
  }
  return rows;
}
```

The direct AJAX endpoint, for reference only:

```text
POST /en/Magic/AjaxAction/Product_LoadMoreArticles
POST /en/Magic/AjaxAction/Metacard_LoadMoreArticles
Content-Type: multipart/form-data
fields:
  __cmtkn        CSRF token from the form
  page           1 on the first request, then the returned new page index
  filterSettings JSON string, e.g. {"idLanguage":{"1":1},"condition":["MT","NM"]}
  idProduct      product pages
  idMetacard     metaproduct pages
```

Response is XML. A login-gated response contains a base64 `<systemMessage>`
(observed: "Log in to see more offers."). The reference implementation reports
that successful pages contain base64-encoded `<rows>` (HTML for the next 50 rows)
and `<newpage>`; this success shape was not directly observed without an
account. The `filterSettings` must match the filters used for the initial page,
otherwise later pages can violate the condition/language constraint. Because the
token and JSON shape are internal and can change, prefer clicking
`#loadMoreButton`.

Do not rely on `?page=2`; the page uses POST + hidden `page`, not a GET page
parameter.

---

## 4. Logged-out vs logged-in behavior

### 4.1 Logged out (what the fixtures show)

* All 50 offers are rendered and readable: seller, country, seller type, sales,
  condition, language, foil/signed/altered/first-edition/reverse-holo, expansion
  and rarity (metaproduct), price, quantity, comments.
* The buy action is a login link, not a cart control:

```html
<div class="actions-container ...">
  <a href="/en/Magic/Login?redirectTo=%2Fen%2FMagic%2FProducts%2FSingles%2FSecret-Lair-Drop-Series%2FCommand-Tower-V9"
     role="button"
     class="btn btn-sm btn-grey"
     aria-label="You have to be logged in to be able to buy items."
     data-bs-original-title="You have to be logged in to be able to buy items.">
    <span class="fonticon-cart"></span>
  </a>
</div>
```

Metaproduct rows redirect to `/en/Magic/Login?redirectTo=%2Fen%2FMagic%2FCards%2FCommand-Tower`.
`redirectTo` is URL-encoded and may include the path only (the fixture does not
include query filters).

* There is no `.input-group` in `.actions-container`; no quantity selector or
  add-to-cart control exists until login.
* "Show more results" is present but login-gated (see §3.2). Public maximum: 50.
* No `.fonticon-calendar` is present. The `span.d-flex.text-nowrap.ms-lg-auto`
  at the end of `.seller-name` is either empty (private seller) or contains the
  Professional/Powerseller icon. Do not interpret an empty span as an ETA.
* Cloudflare may serve "Just a moment..." with 0 rows and a 403. Detect that
  title/heading and wait or pause; do not treat it as an empty result set.

### 4.2 Logged in (what may change)

* Load-more works and can reach 300 rows per page (expected; the public
  login-gated response prevents direct confirmation).
* Purchasable offers are expected to expose an input group in
  `.actions-container` (`.input-group`), typically a quantity input plus cart
  button. Some offers stay non-purchasable due to the buyer's country, seller
  restrictions, minimum order, or blocked seller; the reference `cw-wizard`
  skips rows whose `.actions-container` has no `.input-group`. This is a
  reference-implementation behavior, not observable in the logged-out fixtures.
* ETA/calendar may appear in `.seller-name` as described in §1.5. It depends on
  the buyer's delivery country and the seller's location, so it cannot be
  reconstructed from logged-out HTML.
* Price containers may gain extra spans/sup such as a VAT note or "Only tracked
  shipping to {country}". Parse the last `span.text-nowrap` in
  `.col-offer .price-container`; ignore the extra tooltip text.
* Seller reputation/warnings may appear in tooltips not present in the logged-out
  fixture (legacy `.seller-extended`). Treat these as optional enrichment.
* Currency/locale can follow the account. The extension should force `/en/` and
  expect EUR (`€`); if the account currency differs, verify the currency symbol
  instead of assuming EUR.

Login-state detection for the parser: a row is logged-out if
`.actions-container a[href*="/Login?redirectTo="]` exists; it is potentially
purchasable if `.actions-container .input-group` exists. Do not infer login from
the page header alone.

---

## 5. Parser design

### 5.1 Normalized Offer shape

```ts
type PageKind = "product" | "metaproduct";
type SellerType = "private" | "professional" | "powerseller";
type ConditionCode = "MT" | "NM" | "EX" | "GD" | "LP" | "PL" | "PO";

interface CardmarketOffer {
  /** Numeric id from id="articleRow{id}". */
  articleId: number;

  /** Which page produced this offer. */
  pageKind: PageKind;

  /** Exact printing id. Present on product pages; derived from thumbnail on metaproduct pages. */
  productId: number | null;

  /** Metaproduct id (idMetacard) when pageKind === "metaproduct". */
  metaproductId: number | null;

  /** Base card name, e.g. "Command Tower". */
  cardName: string;

  /** Exact printing name when known, e.g. "Command Tower (V.9)". */
  productName: string | null;

  expansionName: string | null;
  expansionUrl: string | null;
  rarity: string | null;

  seller: {
    name: string;
    url: string;
    country: string;              // "Finland"; map to ISO separately if needed
    type: SellerType;
    salesCount: number | null;     // exact from tooltip; badge may be abbreviated
    availableItems: number | null; // seller-wide stock from tooltip, not offer quantity
  };

  condition: ConditionCode;
  conditionLabel: string;         // "Excellent"
  language: string;               // "English"

  flags: {
    foil: boolean;
    signed: boolean;
    altered: boolean;
    firstEdition: boolean;
    reverseHolo: boolean;
  };

  price: {
    amountCents: number;          // per copy, EUR cents
    currency: "EUR";
    text: string;                 // original "0,75 €"
  };

  /** Copies in this offer. */
  quantity: number;

  /** Seller's product comment, if shown. */
  comment: string | null;

  /** Logged-in only; null when the calendar is absent. */
  eta: {
    days: number | null;          // seller general ETA, if present
    toBuyerDays: number | null;   // last number in the tooltip
  } | null;

  /** True when .actions-container .input-group exists (logged in and eligible). */
  purchasable: boolean;

  /** Login URL when logged out; null when logged in (or use a separate action model). */
  buyUrl: string | null;

  /** Canonical page URL this row came from. */
  sourceUrl: string;
}

interface ParsedPage {
  kind: PageKind;
  idProduct: number | null;
  idMetacard: number | null;
  cardName: string | null;
  productName: string | null;
  expansionName: string | null;
  versionCount: number | null;
  offers: CardmarketOffer[];
}
```

### 5.2 Parser pseudo-code

```ts
const ROW_SELECTOR = ".table-body > .article-row[id^='articleRow']";

function parsePage(doc: Document, sourceUrl: string): ParsedPage {
  const kind: PageKind = doc.querySelector("#FilterForm input[name='idMetacard']")
    ? "metaproduct"
    : "product";

  const idProduct = num(doc.querySelector<HTMLInputElement>("#FilterForm input[name='idProduct']")?.value);
  const idMetacard = num(doc.querySelector<HTMLInputElement>("#FilterForm input[name='idMetacard']")?.value);

  const h1 = doc.querySelector("h1");
  const cardName = firstTextNode(h1); // "Command Tower" / "Command Tower (V.9)"

  const header = kind === "product"
    ? doc.querySelector("#tabContent-info .info-list-container dl")
    : doc.querySelector("#info .infoContainer dl");

  const headerMap = definitionListToMap(header); // dt text -> dd element
  const expansionLink = headerMap.get("Printed in")?.querySelector("a[href*='/Expansions/']");
  const expansionName = kind === "product" ? text(expansionLink) : null;
  const expansionUrl = kind === "product" ? expansionLink?.getAttribute("href") ?? null : null;
  const versionCount = kind === "metaproduct"
    ? num(text(headerMap.get("No. of Versions")))
    : null;

  const offers = [...doc.querySelectorAll(ROW_SELECTOR)].map((row) =>
    parseRow(row, {
      kind, idProduct, idMetacard, cardName,
      expansionName, expansionUrl, sourceUrl,
    })
  );

  return {
    kind, idProduct, idMetacard, cardName,
    productName: kind === "product" ? cardName : null,
    expansionName, versionCount, offers,
  };
}

interface RowContext {
  kind: PageKind;
  idProduct: number | null;
  idMetacard: number | null;
  cardName: string | null;
  expansionName: string | null;
  expansionUrl: string | null;
  sourceUrl: string;
}

function parseRow(row: Element, ctx: RowContext): CardmarketOffer {
  const articleId = Number(row.id.replace("articleRow", ""));
  const seller = row.querySelector(".col-seller .seller-name")!;
  const attrs = row.querySelector(".col-product .product-attributes")!;
  const offer = row.querySelector(".col-offer")!;

  const salesTip = tooltipText(seller.querySelector(".sell-count")) ?? "";
  const sales = matchInt(salesTip, /([\d.,]+)\s*Sales/);
  const available = matchInt(salesTip, /([\d.,]+)\s*Available items/);

  const sellerType: SellerType =
    seller.querySelector("[aria-label='Powerseller']") ? "powerseller" :
    seller.querySelector("[aria-label='Professional']") ? "professional" :
    "private";

  const cond = attrs.querySelector(".article-condition");
  const conditionText = cond?.querySelector(".badge")?.textContent?.trim();
  if (!conditionText) throw new Error(`Offer ${articleId}: missing condition`);
  const condition = conditionText as ConditionCode;

  const languageText =
    attrs.querySelector("span.icon.me-2[aria-label]")?.getAttribute("aria-label");
  if (!languageText) throw new Error(`Offer ${articleId}: missing language`);
  const language = languageText;

  const expansion = attrs.querySelector(".expansion-symbol");
  const rarity = expansion?.nextElementSibling?.tagName.toLowerCase() === "svg"
    ? tooltipText(expansion.nextElementSibling)
    : null;

  const priceEl = [...offer.querySelectorAll(".price-container span.text-nowrap")].at(-1);
  const priceCents = parseEuroCents(priceEl?.textContent ?? "");
  const quantity = Number(offer.querySelector(".amount-container .item-count")?.textContent?.trim());

  const commentEl = row.querySelector(".product-comments");
  const comment = tooltipText(commentEl?.querySelector(".d-none.d-lg-block span"))
    ?? tooltipText(commentEl?.querySelector(".fonticon-comments"));

  const productId = ctx.kind === "product"
    ? ctx.idProduct
    : productIdFromThumbnail(row);

  const buyLink = offer.querySelector<HTMLAnchorElement>("a[href*='/Login?redirectTo=']");
  const purchasable = !!offer.querySelector(".actions-container .input-group");

  return {
    articleId,
    pageKind: ctx.kind,
    productId,
    metaproductId: ctx.idMetacard,
    cardName: ctx.cardName ?? imageAlt(row) ?? "",
    productName: ctx.kind === "product" ? ctx.cardName : imageAlt(row),
    expansionName: expansion ? tooltipText(expansion) : ctx.expansionName,
    expansionUrl: expansion?.getAttribute("href") ?? ctx.expansionUrl ?? null,
    rarity,
    seller: {
      name: seller.querySelector("a[href*='/Users/']")?.textContent?.trim() ?? "",
      url: seller.querySelector("a[href*='/Users/']")?.getAttribute("href") ?? "",
      country: tooltipText(seller.querySelector("[aria-label^='Item location:']"))?.replace("Item location: ", "") ?? "",
      type: sellerType,
      salesCount: sales,
      availableItems: available,
    },
    condition,
    conditionLabel: tooltipText(cond) ?? condition,
    language,
    flags: {
      foil: hasFlag(attrs, "Foil"),
      signed: hasFlag(attrs, "Signed"),
      altered: hasFlag(attrs, "Altered"),
      firstEdition: hasFlag(attrs, "First Edition") || hasFlag(attrs, "1st Edition"),
      reverseHolo: hasFlag(attrs, "Reverse Holo"),
    },
    price: { amountCents: priceCents, currency: "EUR", text: priceEl?.textContent?.trim() ?? "" },
    quantity,
    comment,
    eta: parseEta(seller),
    purchasable,
    buyUrl: buyLink?.getAttribute("href") ?? null,
    sourceUrl: ctx.sourceUrl,
  };
}
```

Helper details:

```ts
function hasFlag(attrs: Element, label: string): boolean {
  return !!attrs.querySelector(
    `[aria-label="${cssEscape(label)}"], [data-bs-original-title="${cssEscape(label)}"]`
  );
}

function parseEta(seller: Element): CardmarketOffer["eta"] {
  const cal = seller.querySelector(".fonticon-calendar[data-bs-toggle='tooltip']");
  const tip = tooltipText(cal);
  if (!tip) return null;
  const nums = [...tip.matchAll(/:\s*(\d+)/g)].map((m) => Number(m[1]));
  if (nums.length === 0) return null;
  return { days: nums.length > 1 ? nums[0] : null, toBuyerDays: nums.at(-1)! };
}
```

### 5.3 JSON sample from the fixtures

Two real rows, normalized. `eta` is `null` because the fixtures are logged out.
The metaproduct row's `productId` is derived from the thumbnail image URL; the
product fixture's `productId` comes from the page context.

```json
[
  {
    "articleId": 2049568859,
    "pageKind": "product",
    "productId": 844281,
    "metaproductId": null,
    "cardName": "Command Tower",
    "productName": "Command Tower (V.9)",
    "expansionName": "Secret Lair Drop Series",
    "expansionUrl": "/en/Magic/Expansions/Secret-Lair-Drop-Series",
    "rarity": "Rare",
    "seller": {
      "name": "sobbMTG",
      "url": "/en/Magic/Users/sobbMTG",
      "country": "Finland",
      "type": "private",
      "salesCount": 513,
      "availableItems": 1238
    },
    "condition": "EX",
    "conditionLabel": "Excellent",
    "language": "English",
    "flags": {
      "foil": true,
      "signed": false,
      "altered": false,
      "firstEdition": false,
      "reverseHolo": false
    },
    "price": { "amountCents": 75, "currency": "EUR", "text": "0,75 €" },
    "quantity": 1,
    "comment": null,
    "eta": null,
    "purchasable": false,
    "buyUrl": "/en/Magic/Login?redirectTo=%2Fen%2FMagic%2FProducts%2FSingles%2FSecret-Lair-Drop-Series%2FCommand-Tower-V9",
    "sourceUrl": "https://www.cardmarket.com/en/Magic/Products?idProduct=844281"
  },
  {
    "articleId": 2191832856,
    "pageKind": "metaproduct",
    "productId": 914156,
    "metaproductId": 203332,
    "cardName": "Command Tower",
    "productName": "Command Tower",
    "expansionName": "Secret Lair Commander Deck: Odds and Ends",
    "expansionUrl": "/en/Magic/Expansions/Secret-Lair-Commander-Deck-Odds-and-Ends",
    "rarity": "Common",
    "seller": {
      "name": "Adraul",
      "url": "/en/Magic/Users/Adraul",
      "country": "Switzerland",
      "type": "professional",
      "salesCount": 1705,
      "availableItems": 5450
    },
    "condition": "NM",
    "conditionLabel": "Near Mint",
    "language": "English",
    "flags": {
      "foil": false,
      "signed": false,
      "altered": false,
      "firstEdition": false,
      "reverseHolo": false
    },
    "price": { "amountCents": 10, "currency": "EUR", "text": "0,10 €" },
    "quantity": 1,
    "comment": null,
    "eta": null,
    "purchasable": false,
    "buyUrl": "/en/Magic/Login?redirectTo=%2Fen%2FMagic%2FCards%2FCommand-Tower",
    "sourceUrl": "https://www.cardmarket.com/en/Magic/Cards/Command-Tower"
  }
]
```

### 5.4 Edge cases and gotchas

* **`minCondition=EX` is silently ignored.** Use `minCondition=3`. This is the
  most important mismatch between the current product spec and the live site.
* **Logged-out cap is 50, not 300.** The button exists but returns a login
  message. Do not loop forever on it.
* **Logged-in cap is 300.** Use filters/segmentation if broader coverage is
  required; the notice says only the first 300 articles are shown.
* **Metaproduct rows mix printings.** Never compare prices across rows without
  grouping by `productId`. The cheapest offer on `/Cards/{slug}` may be a
  different version than the deck's chosen printing.
* **A metaproduct row has no product link.** Derive `productId` from the
  thumbnail `data-bs-title` image URL (`/1/{SET}/{id}/{id}.jpg`) and use
  `/Magic/Products?idProduct={id}`. The expansion link is not a product link.
* **Version-gallery images lazy-load.** On `/Cards/{slug}/Versions`, most
  `img.src` values are `/img/transparent.gif`; the real URL is in `data-echo`.
  Use `data-echo ?? src` or the card's product href instead.
* **The thumbnail alt is not guaranteed to include the version.** It is
  `Command Tower` for some rows and `Command Tower (V.2)` for others. Use
  expansion + `productId` for identity; fetch the exact page for a canonical
  printing name.
* **Show Versions count ≠ metaproduct version count.** The product page said
  `Show Versions (124)` while the metaproduct header said `125 versions`. Treat
  the anchor number as reprints/other versions, not total.
* **No `Reprints` row means no metaproduct link.** Do not synthesize `/Cards/`
  from an unverified slug; fall back to the exact product page.
* **Product-page header and metaproduct header use different containers**
  (`.info-list-container dl` vs `#info .infoContainer dl`). Try both.
* **Sales badges abbreviate.** `1` + nested `K` means ~1,705; parse the tooltip
  (`1705 Sales | 5450 Available items`) for exact numbers. Tooltips contain NBSP.
* **Mobile duplicates.** Metaproduct and product rows contain a mobile price and
  quantity under `.col-product .mobile-offer-container`. Scope price/quantity to
  `.col-offer` and take the last `.price-container span.text-nowrap`.
* **Price extras.** `.price-container` may contain a VAT `sup` or a "only tracked
  shipping" span. Parsing the container's full text can produce the wrong
  number; use the last price span.
* **Quantity is per offer.** `availableItems` from the sales tooltip is the
  seller's total stock. Total offer cost = `price × quantity`.
* **Seller type defaults to private.** The row has no "Private" icon; absence of
  Professional/Powerseller means private.
* **Expansion names are attributes, not text.** The `.expansion-symbol` anchor is
  an icon-only element; use `aria-label` / `data-bs-original-title`.
* **Rarity is an SVG.** Select `svg[aria-label]` next to the expansion symbol,
  not by class (`svg.className` is an SVGAnimatedString in JS).
* **Comments are optional.** Read the desktop `.d-none.d-lg-block span`, fall
  back to the mobile `.fonticon-comments` tooltip; otherwise `null`.
* **ETA is optional and logged-in only.** Absence is normal, especially for
  low-sales sellers. Do not fabricate an ETA from the country or shipping table.
* **Buy eligibility is not the same as offer visibility.** Logged-in rows without
  `.actions-container .input-group` are visible but not purchasable to this
  buyer. Keep them for price analysis but skip them for cart apply.
* **`redirectTo` is encoded and path-only in the fixtures.** Build login URLs
  relative to the current origin; do not assume they include filters.
* **Cloudflare challenges.** A "Just a moment..." page has zero rows and title
  `Just a moment...`; pause/retry rather than caching an empty result.
* **Locale/currency.** Force `/en/` so condition/language labels are English.
  Parse the currency symbol; the fixtures are EUR.
* **AJAX append + dedupe.** Load-more appends rows; re-running the parser on the
  same DOM can duplicate. Deduplicate by `articleId`.
* **Stock changes.** Offers disappear between page loads and cart apply. Re-check
  article id/price/quantity immediately before adding to cart; never trust a
  stale snapshot.
* **Sort order.** Offers are price-ascending in the fixtures. Do not depend on
  order after filters/load-more; sort explicitly.
* **HTML entities.** `data-bs-title` for thumbnails contains escaped HTML
  (`&lt;img …&gt;`). Decode it or use `DOMParser`; regex on the raw string also
  works for the image URL.
* **Condition/language codes are stable in `/en/` but not across locales.** Use
  the English codes and labels above; do not parse localized full names as the
  primary key.

---

## 6. Sources and verification notes

* Fixtures:
  * `tests/fixtures/cardmarket-product-command-tower.html`
  * `tests/fixtures/cardmarket-versions-command-tower.html`
  * `tests/fixtures/cardmarket-metaproduct-command-tower.html`
* Live checks on 2026-11-02 (logged out), including:
  * `https://www.cardmarket.com/en/Magic/Products?idProduct=844281&language=1&minCondition=EX`
  * `https://www.cardmarket.com/en/Magic/Products?idProduct=5833&minCondition=3`
  * `https://www.cardmarket.com/en/Magic/Cards/Command-Tower?language=1&minCondition=EX`
  * `https://www.cardmarket.com/en/Magic/Cards/Underground-Sea?language=1&minCondition=3`
  * `https://www.cardmarket.com/en/Magic/Cards/Underground-Sea?language=1&minCondition=2`
* Reference implementations (MIT), used only for cross-checking selectors and
  filter/pagination behavior:
  * `michasng/cardmarket_wizard` — `lib/services/cardmarket/pages/single_page.dart`,
    `card_page.dart` (ETA `.fonticon-calendar`, seller type, numeric
    `minCondition`, language ordinals).
  * `BenSouchet/cw-wizard` — `core.py` (numeric `minCondition`, `filterSettings`,
    load-more XML/base64 handling, `.input-group` purchasability check).
* Not verified without an account: exact logged-in ETA tooltip wording; whether
  every account/currency combination keeps EUR; seller reputation markup in the
  current logged-in DOM. Treat those as optional/nullable.

## 7. Recommended extension flow

1. Navigate to the exact product URL (`Products?idProduct=…`) for a chosen
   printing, or the metaproduct URL (`Cards/{slug}`) only when comparing
   printings.
2. Append `language=1&minCondition=3` (not `minCondition=EX`).
3. Parse the first 50 rows. If logged out, stop at 50 and surface that more offers
   require login.
4. If logged in, click "Show more results" until 300 or no growth, dedupe by
   `articleId`.
5. Group metaproduct rows by `productId`; do not compare across printings.
6. Revalidate article id, price, quantity, and purchasability before cart apply.
