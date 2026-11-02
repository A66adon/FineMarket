import {
  CARDMARKET_BASE,
  CONDITION_RANK,
  CONDITION_TO_CARDMARKET_ID,
} from './constants';
import { countryIdFromName } from './countries';
import { tryParseEuroToCents } from './money';
import type { Cents, Condition, Finish, Offer, Seller, Want } from './types';

export interface ParsedCardmarketPage {
  pageKind: 'product' | 'metaproduct' | 'unknown';
  name: string;
  productId?: number;
  metaproductId?: number;
  metaproductUrl?: string;
  offers: Offer[];
  hasMore: boolean;
  cloudflare: boolean;
}

interface PageContext {
  pageKind: 'product' | 'metaproduct' | 'unknown';
  productId?: number;
  metaproductId?: number;
}

interface OfferEta {
  sellerDays: number | null;
  buyerDays: number | null;
}

// Logged-in Cardmarket markup can keep the `row` class without `article-row`.
// Match every row in the article table and identify offers by the stable id.
const ROW_SELECTOR = '.article-table .table-body > .row';
const ROW_FALLBACK_SELECTOR = '[id^="articleRow"]';

/** Build the canonical exact-printing Cardmarket URL. */
export function buildProductUrl(
  productId: number,
  minCondition: Condition = 'EX',
): string {
  const conditionId =
    CONDITION_TO_CARDMARKET_ID[minCondition] ?? CONDITION_TO_CARDMARKET_ID.EX;
  return (
    `${CARDMARKET_BASE}/en/Magic/Products` +
    `?idProduct=${encodeURIComponent(String(productId))}` +
    `&language=1&minCondition=${conditionId}`
  );
}

/** Set the English + minimum-condition offer filters on any Cardmarket URL. */
export function withOfferFilters(
  url: string,
  minCondition: Condition = 'EX',
): string {
  const parsed = new URL(url, CARDMARKET_BASE);
  const conditionId =
    CONDITION_TO_CARDMARKET_ID[minCondition] ?? CONDITION_TO_CARDMARKET_ID.EX;
  parsed.searchParams.set('language', '1');
  parsed.searchParams.set('minCondition', String(conditionId));
  return parsed.toString();
}

/**
 * Find the metaproduct ("all versions") URL from an exact-printing page.
 * Prefer the Show Offers link; otherwise strip /Versions from Show Versions.
 */
export function buildMetaproductUrlFromProductHtml(
  html: string,
  baseUrl: string,
): string | null {
  if (typeof html !== 'string' || !html.trim()) return null;
  if (typeof DOMParser === 'undefined') return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Cardmarket moved this block around in the 2026 layout. Prefer the info
  // panel, but keep a whole-page fallback for pages where that container is
  // gone or renamed.
  const offersLink =
    doc.querySelector(
      '#tabContent-info .info-list-container a[href*="/Cards/"]:not([href$="/Versions"])',
    ) ??
    doc.querySelector(
      '.info-list-container a[href*="/Cards/"]:not([href$="/Versions"])',
    ) ??
    doc.querySelector(
      'a[href*="/Magic/Cards/"]:not([href$="/Versions"])',
    );
  const versionsLink =
    doc.querySelector(
      '#tabContent-info .info-list-container a[href*="/Cards/"][href$="/Versions"]',
    ) ??
    doc.querySelector(
      '.info-list-container a[href*="/Cards/"][href$="/Versions"]',
    ) ??
    doc.querySelector('a[href*="/Cards/"][href$="/Versions"]');

  const href = offersLink?.getAttribute('href') ?? versionsLink?.getAttribute('href');
  if (!href) return null;

  let target: URL;
  try {
    target = new URL(href, baseUrl || CARDMARKET_BASE);
  } catch {
    return null;
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  const pathSegments = target.pathname.split('/').filter(Boolean);
  if (
    !target.pathname.includes('/Cards/') ||
    pathSegments.length < 4 ||
    pathSegments[2] !== 'Cards'
  ) {
    return null;
  }

  if (/\/Versions\/?$/i.test(target.pathname)) {
    target.pathname = target.pathname.replace(/\/Versions\/?$/i, '');
    target.search = '';
    target.hash = '';
  }

  return withOfferFilters(target.toString());
}

/**
 * Build the "all versions" URL from a card name. Product pages do not always
 * expose a Show Versions link (especially after a product redirect), so this
 * gives the cheapest-playable mode a reliable fallback. Cardmarket's slug
 * removes apostrophes and folds accents: "Lim-Dûl's Vault" -> "Lim-Duls-Vault".
 */
export function buildMetaproductUrlFromName(
  name: string,
  minCondition: Condition = 'EX',
): string | null {
  const frontFace = name.split('//')[0]?.trim() ?? '';
  const slug = frontFace
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) return null;
  return withOfferFilters(
    `${CARDMARKET_BASE}/en/Magic/Cards/${slug}`,
    minCondition,
  );
}

/**
 * Parse a Cardmarket product or metaproduct page. Malformed rows are skipped,
 * not thrown; only a missing/non-string document is fatal.
 */
export function parseCardmarketPage(
  html: string,
  baseUrl: string,
  want: Want,
): ParsedCardmarketPage {
  const doc = parseHtml(html);
  const context = parsePageContext(doc, baseUrl);
  const name =
    firstTextNode(doc.querySelector('h1')) ||
    normalizeWhitespace(want.name) ||
    '';
  const offers = parseCardmarketOffers(doc, baseUrl, want);
  const metaproductUrl = buildMetaproductUrlFromProductHtml(html, baseUrl);

  const page: ParsedCardmarketPage = {
    pageKind: context.pageKind,
    name,
    offers,
    hasMore: pageHasMore(doc),
    cloudflare: detectCloudflare(doc, offers.length),
  };
  if (context.productId != null) page.productId = context.productId;
  if (context.metaproductId != null) page.metaproductId = context.metaproductId;
  if (metaproductUrl) page.metaproductUrl = metaproductUrl;
  return page;
}

/** Parse every usable offer row. English-only; finish filters are applied here. */
export function parseCardmarketOffers(
  doc: Document,
  baseUrl: string,
  want: Want,
): Offer[] {
  const context = parsePageContext(doc, baseUrl);
  const fallbackExpansion = headerExpansion(doc);
  const rows = Array.from(doc.querySelectorAll(ROW_SELECTOR)).filter((row) =>
    /^articleRow\d+/.test(row.id),
  );
  if (rows.length === 0) {
    rows.push(
      ...Array.from(doc.querySelectorAll(ROW_FALLBACK_SELECTOR)).filter((row) =>
        /^articleRow\d+/.test(row.id),
      ),
    );
  }

  const offers: Offer[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const offer = parseOfferRow(
      row,
      baseUrl,
      want,
      context,
      fallbackExpansion,
    );
    if (!offer) continue;
    if (!want.allowAnyFinish && offer.finish !== want.finish) continue;
    if (seen.has(offer.id)) continue;
    seen.add(offer.id);
    offers.push(offer);
  }

  return offers;
}

/**
 * The logged-out page shows an item-count badge. Logged-in pages may replace
 * the badge with an amount input. Prefer the explicit badge, then the input's
 * max (available stock), then its current value.
 */
function parseStock(row: Element): number {
  const amountContainer = row.querySelector('.col-offer .amount-container');
  const badge =
    positiveInt(
      amountContainer?.querySelector('.item-count')?.textContent,
    ) ?? positiveInt(amountContainer?.textContent);
  if (badge != null) return badge;

  const input = row.querySelector<HTMLInputElement>(
    '.col-offer .actions-container input, .col-offer input',
  );
  if (!input) return 1;

  return (
    positiveInt(input.getAttribute('max')) ??
    positiveInt(input.value) ??
    1
  );
}

function parseHtml(html: string): Document {
  if (typeof html !== 'string' || html.trim() === '') {
    throw new Error('Cardmarket HTML is empty');
  }
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is not available');
  }
  return new DOMParser().parseFromString(html, 'text/html');
}

function parseOfferRow(
  row: Element,
  baseUrl: string,
  want: Want,
  context: PageContext,
  fallbackExpansion: string | undefined,
): Offer | null {
  const articleMatch = /^articleRow(\d+)/.exec(row.id);
  if (!articleMatch?.[1]) return null;

  const sellerEl = row.querySelector('.seller-name');
  if (!sellerEl) return null;

  const sellerLink = sellerEl.querySelector('a[href*="/Users/"]');
  const sellerName = normalizeWhitespace(
    sellerLink?.textContent ?? sellerEl.querySelector('a')?.textContent ?? '',
  );
  if (!sellerName) return null;

  const productAttributes =
    row.querySelector('.col-product .product-attributes') ?? row;

  const condition = parseCondition(row);
  if (!condition) return null;

  const language = parseLanguage(productAttributes);
  if (language !== 'EN') return null;

  const priceEl =
    lastMatch(row.querySelectorAll('.col-offer .price-container span.text-nowrap')) ??
    row.querySelector('.col-offer .price-container');
  const priceCents = parsePriceCents(priceEl?.textContent);
  if (priceCents == null) return null;

  const stock = parseStock(row);

  const isFoil = hasFlag(productAttributes, 'Foil');
  const isSigned = hasFlag(productAttributes, 'Signed');
  const isAltered = hasFlag(productAttributes, 'Altered');
  // Cardmarket has no separate etched marker. An exact etched product can be
  // labelled from the want, but on a metaproduct page (allowAnyFinish) the row
  // itself can only tell us foil vs non-foil.
  const finish: Finish =
    !want.allowAnyFinish && want.finish === 'etched'
      ? 'etched'
      : isFoil
        ? 'foil'
        : 'nonfoil';

  // The 2026 metaproduct layout sometimes moves the item-location icon out of
  // .seller-name (into .seller-extended or the seller column). Search the
  // whole row so shipping still gets a country.
  const country = parseCountry(row);
  const eta = parseEta(sellerEl);
  const isPowerseller = hasFlag(sellerEl, 'Powerseller');
  const isProfessional = hasFlag(sellerEl, 'Professional');
  const salesCount = parseSalesCount(sellerEl);

  const seller: Seller = {
    id: sellerName,
    name: sellerName,
    country,
    countryId: countryIdFromName(country) ?? 0,
    isCommercial: isProfessional || isPowerseller,
    isPowerseller,
  };
  if (salesCount != null) seller.salesCount = salesCount;
  if (eta.sellerDays != null) seller.etaDays = eta.sellerDays;

  const offer: Offer = {
    id: articleMatch[1],
    wantId: want.id,
    productName: want.name,
    condition,
    language: 'EN',
    finish,
    isSigned,
    isAltered,
    priceCents,
    stock,
    seller,
  };

  if (eta.buyerDays != null) offer.etaDays = eta.buyerDays;

  const productId =
    context.productId ?? productIdFromThumbnail(row) ?? undefined;
  if (productId != null) offer.productId = productId;

  const expansion =
    tooltipText(
      row.querySelector('.product-attributes > a.expansion-symbol'),
    ) || fallbackExpansion;
  if (expansion) offer.expansion = expansion;

  const comment = parseComment(row);
  if (comment) offer.comment = comment;

  if (baseUrl) offer.url = baseUrl;

  return offer;
}

function parsePageContext(doc: Document, baseUrl: string): PageContext {
  const formProductId = positiveInt(
    doc.querySelector<HTMLInputElement>('#FilterForm input[name="idProduct"]')
      ?.value,
  );
  const formMetaproductId = positiveInt(
    doc.querySelector<HTMLInputElement>('#FilterForm input[name="idMetacard"]')
      ?.value,
  );

  let url: URL | null = null;
  try {
    url = new URL(baseUrl, CARDMARKET_BASE);
  } catch {
    url = null;
  }

  const productId =
    formProductId ?? positiveInt(url?.searchParams.get('idProduct'));
  const metaproductId =
    formMetaproductId ??
    positiveInt(url?.searchParams.get('idMetacard')) ??
    positiveInt(url?.searchParams.get('idMetaproduct'));

  let pageKind: PageContext['pageKind'] = 'unknown';
  if (metaproductId != null) pageKind = 'metaproduct';
  else if (productId != null) pageKind = 'product';
  else if (url) {
    if (/\/Magic\/Products(?:\/|$)/i.test(url.pathname)) pageKind = 'product';
    else if (/\/Magic\/Cards\//i.test(url.pathname)) pageKind = 'metaproduct';
  }

  const context: PageContext = { pageKind };
  if (productId != null) context.productId = productId;
  if (metaproductId != null) context.metaproductId = metaproductId;
  return context;
}

function parseCondition(row: Element): Condition | null {
  const el = row.querySelector('.article-condition');
  if (!el) return null;
  const code = normalizeWhitespace(
    el.querySelector('.badge')?.textContent ?? el.textContent ?? '',
  ).toUpperCase();

  if (Object.prototype.hasOwnProperty.call(CONDITION_RANK, code)) {
    return code as Condition;
  }

  const fullLabels: Record<string, Condition> = {
    MINT: 'MT',
    'NEAR MINT': 'NM',
    EXCELLENT: 'EX',
    GOOD: 'GD',
    'LIGHT PLAYED': 'LP',
    PLAYED: 'PL',
    POOR: 'PO',
  };
  if (fullLabels[code]) return fullLabels[code];
  if (code) return null;

  const classMatch = /condition-(mt|nm|ex|gd|lp|pl|po)\b/i.exec(el.className);
  const classCode = classMatch?.[1]?.toUpperCase();
  return classCode ? (classCode as Condition) : null;
}

function parseLanguage(productAttributes: Element): string {
  const normalize = (label: string): string =>
    /^english$|^englisch$/i.test(label) ? 'EN' : label;

  // The language icon is the element directly after the condition badge on
  // both logged-out and logged-in pages. Prefer that relationship so an
  // expansion, rarity or comment icon can never be mistaken for a language.
  const condition = productAttributes.querySelector('.article-condition');
  const conditionSiblingLabel = tooltipText(
    condition?.nextElementSibling ?? null,
  );
  if (conditionSiblingLabel && LANGUAGE_LABELS.has(conditionSiblingLabel)) {
    return normalize(conditionSiblingLabel);
  }

  for (const icon of productAttributes.querySelectorAll(
    '[aria-label], [data-bs-original-title], [data-bs-title]',
  )) {
    if (icon.classList.contains('expansion-symbol')) continue;
    const label = tooltipText(icon);
    if (!label || !LANGUAGE_LABELS.has(label)) continue;
    return normalize(label);
  }

  // The request URLs set language=1. If the markup does not expose a language
  // label at all, trust the server-side English filter instead of dropping
  // every row.
  return 'EN';
}

const LANGUAGE_LABELS = new Set([
  'English',
  'Englisch',
  'French',
  'Französisch',
  'German',
  'Deutsch',
  'Spanish',
  'Spanisch',
  'Italian',
  'Italienisch',
  'Simplified Chinese',
  'Chinesisch (vereinfacht)',
  'Japanese',
  'Japanisch',
  'Portuguese',
  'Portugiesisch',
  'Russian',
  'Russisch',
  'Korean',
  'Koreanisch',
  'Traditional Chinese',
  'Chinesisch (traditionell)',
  'Dutch',
  'Niederländisch',
  'Polish',
  'Polnisch',
  'Czech',
  'Tschechisch',
  'Hungarian',
  'Ungarisch',
]);

function parsePriceCents(raw: string | null | undefined): Cents | null {
  const direct = tryParseEuroToCents(raw);
  if (direct != null) return direct;
  if (!raw) return null;
  const match = /([0-9][0-9.,]*)\s*€/.exec(raw);
  return match?.[1] ? tryParseEuroToCents(`${match[1]} €`) : null;
}

const FLAG_LABELS = new Set([
  'Foil',
  'Signed',
  'Altered',
  'First Edition',
  '1st Edition',
  'Reverse Holo',
]);

function parseCountry(root: Element): string {
  const el =
    root.querySelector('[aria-label^="Item location:"]') ??
    root.querySelector('[data-bs-original-title^="Item location:"]') ??
    root.querySelector('[data-bs-title^="Item location:"]');
  return normalizeWhitespace(tooltipText(el) ?? '').replace(
    /^Item location:\s*/i,
    '',
  );
}

function parseEta(sellerEl: Element): OfferEta {
  const calendar = sellerEl.querySelector('.fonticon-calendar');
  const text = tooltipText(calendar);
  if (!text) return { sellerDays: null, buyerDays: null };

  const numbers = Array.from(text.matchAll(/:\s*(\d+)/g), (match) => Number(match[1]))
    .filter((value) => Number.isSafeInteger(value));
  if (numbers.length === 0) return { sellerDays: null, buyerDays: null };

  const buyerDays = numbers[numbers.length - 1] ?? null;
  const sellerDays = numbers.length > 1 ? numbers[0] ?? null : null;
  return { sellerDays, buyerDays };
}

function parseSalesCount(sellerEl: Element): number | null {
  const text = tooltipText(sellerEl.querySelector('.sell-count'));
  if (!text) return null;
  const match = /([\d.,]+)\s*Sales/i.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/[.,]/g, ''));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseComment(row: Element): string | undefined {
  const container = row.querySelector('.product-comments');
  if (!container) return undefined;

  const desktop = container.querySelector('.d-none.d-lg-block span');
  const mobile = container.querySelector('.fonticon-comments');
  const text =
    tooltipText(desktop) ||
    tooltipText(mobile) ||
    normalizeWhitespace(container.textContent ?? '');
  return text || undefined;
}

function productIdFromThumbnail(row: Element): number | null {
  const thumbnail = row.querySelector(
    '.col-icon .thumbnail-icon, .thumbnail-icon',
  );
  const text = tooltipText(thumbnail);
  if (!text) return null;
  const match = /\/1\/[^/]+\/(\d+)\/\1\.jpg/.exec(text);
  return match?.[1] ? positiveInt(match[1]) : null;
}

function headerExpansion(doc: Document): string | undefined {
  const dl = doc.querySelector('#tabContent-info .info-list-container dl');
  if (dl) {
    for (const dt of dl.querySelectorAll('dt')) {
      if (normalizeWhitespace(dt.textContent ?? '') !== 'Printed in') continue;
      const dd = dt.nextElementSibling;
      const link = dd?.querySelector('a[href*="/Expansions/"]');
      const text = normalizeWhitespace(link?.textContent ?? '');
      if (text) return text;
    }
  }

  for (const link of doc.querySelectorAll(
    '#tabContent-info .info-list-container a[href*="/Expansions/"]',
  )) {
    const text = normalizeWhitespace(link.textContent ?? '');
    if (text) return text;
  }
  return undefined;
}

function pageHasMore(doc: Document): boolean {
  const maxNotice = doc.querySelector('#MaxResultsReachedNotice');
  if (maxNotice && isVisible(maxNotice)) return false;

  const button = doc.querySelector('#loadMoreButton');
  return button ? isVisible(button) : false;
}

function detectCloudflare(doc: Document, offerCount: number): boolean {
  const title = normalizeWhitespace(doc.title ?? '');
  const body = normalizeWhitespace(doc.body?.textContent ?? '');
  const all = `${title} ${body}`;

  if (/just a moment/i.test(all)) return true;
  if (/performing security verification/i.test(all)) return true;
  if (offerCount === 0 && /security verification/i.test(all)) return true;
  return false;
}

function isVisible(el: Element): boolean {
  if (!el) return false;

  let node: Element | null = el;
  while (node) {
    if (node.hasAttribute('hidden')) return false;
    if (node.getAttribute('aria-hidden') === 'true') return false;
    if (node.classList.contains('d-none')) return false;
    const style = (node as HTMLElement).style;
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return true;
}

function hasFlag(root: Element, label: string): boolean {
  const wanted = label.toLowerCase();
  for (const el of root.querySelectorAll(
    '[aria-label], [data-bs-original-title], [data-bs-title], [title]',
  )) {
    const value = tooltipText(el);
    if (value?.toLowerCase() === wanted) return true;
  }
  return false;
}

function tooltipText(el: Element | null): string | null {
  if (!el) return null;
  const raw =
    el.getAttribute('data-bs-original-title') ??
    el.getAttribute('data-bs-title') ??
    el.getAttribute('title') ??
    el.getAttribute('aria-label');
  if (!raw) return null;
  return normalizeWhitespace(raw);
}

function firstTextNode(el: Element | null): string {
  if (!el) return '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== 3) continue;
    const text = normalizeWhitespace(node.textContent ?? '');
    if (text) return text;
  }
  return normalizeWhitespace(el.textContent ?? '');
}

function normalizeWhitespace(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function positiveInt(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = /^\s*(\d+)\s*$/.exec(raw);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function lastMatch(list: NodeListOf<Element>): Element | undefined {
  return list.length > 0 ? list[list.length - 1] : undefined;
}
