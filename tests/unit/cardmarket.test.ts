import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildMetaproductUrlFromProductHtml,
  buildProductUrl,
  parseCardmarketPage,
  withOfferFilters,
} from '../../src/shared/cardmarket';
import type { Want } from '../../src/shared/types';

const productHtml = readFileSync(
  resolve(
    process.cwd(),
    'tests/fixtures/cardmarket-product-command-tower.html',
  ),
  'utf8',
);
const metaproductHtml = readFileSync(
  resolve(
    process.cwd(),
    'tests/fixtures/cardmarket-metaproduct-command-tower.html',
  ),
  'utf8',
);

const PRODUCT_BASE = 'https://www.cardmarket.com/en/Magic/Products?idProduct=844281';
const METAPRODUCT_BASE = 'https://www.cardmarket.com/en/Magic/Cards/Command-Tower';

function makeWant(overrides: Partial<Want> = {}): Want {
  return {
    id: 'want-1',
    name: 'Command Tower',
    quantity: 1,
    finish: 'foil',
    board: 'mainboard',
    isBasicLand: false,
    allowAnyPrinting: false,
    allowAnyFinish: false,
    ownedQuantity: 0,
    ownedExactQuantity: 0,
    offers: [],
    ...overrides,
  };
}

interface SyntheticRowOptions {
  id?: number;
  seller?: string;
  country?: string;
  condition?: string;
  language?: string;
  foil?: boolean;
  signed?: boolean;
  altered?: boolean;
  price?: string;
  stock?: string;
  sales?: string;
  comment?: string;
  expansion?: string;
  professional?: boolean;
  powerseller?: boolean;
  eta?: string;
}

function syntheticRow(options: SyntheticRowOptions = {}): string {
  const {
    id = 12345,
    seller = 'alice',
    country = 'Germany',
    condition = 'NM',
    language = 'English',
    foil = false,
    signed = false,
    altered = false,
    price = '1,00 €',
    stock = '1',
    sales = '10 Sales | 20 Available items',
    comment,
    expansion,
    professional = false,
    powerseller = false,
    eta,
  } = options;

  return `
    <div id="articleRow${id}" class="row g-0 article-row">
      <div class="col-seller">
        <span class="seller-name">
          <span class="sell-count" data-bs-original-title="${sales}">10</span>
          <span class="icon" aria-label="Item location: ${country}"></span>
          <span><a href="/en/Magic/Users/${seller}">${seller}</a></span>
          ${
            professional
              ? '<span class="fonticon-users-professional" aria-label="Professional"></span>'
              : ''
          }
          ${
            powerseller
              ? '<span class="fonticon-users-powerseller" aria-label="Powerseller"></span>'
              : ''
          }
          ${
            eta
              ? `<span class="fonticon-calendar" data-bs-original-title="${eta}"></span>`
              : ''
          }
        </span>
      </div>
      <div class="col-product">
        <div class="product-attributes">
          ${
            expansion
              ? `<a class="expansion-symbol" href="/en/Magic/Expansions/Test" aria-label="${expansion}"></a>`
              : ''
          }
          <a class="article-condition condition-nm" data-bs-original-title="Near Mint">
            <span class="badge">${condition}</span>
          </a>
          <span class="icon me-2" aria-label="${language}"></span>
          ${foil ? '<span class="icon mr-1" aria-label="Foil"></span>' : ''}
          ${signed ? '<span class="icon" aria-label="Signed"></span>' : ''}
          ${altered ? '<span class="icon" aria-label="Altered"></span>' : ''}
        </div>
        ${
          comment
            ? `<div class="product-comments"><div class="d-none d-lg-block"><span data-bs-original-title="${comment}">${comment}</span></div></div>`
            : ''
        }
      </div>
      <div class="col-offer">
        <div class="price-container"><span class="text-nowrap">${price}</span></div>
        <div class="amount-container"><span class="item-count">${stock}</span></div>
      </div>
    </div>
  `;
}

function syntheticPage(
  rows: string[],
  options: {
    title?: string;
    productId?: number;
    metaproductId?: number;
    bodyText?: string;
  } = {},
): string {
  const { title = 'Test Card', productId, metaproductId, bodyText = '' } =
    options;
  const filterInputs = [
    productId != null
      ? `<input type="hidden" name="idProduct" value="${productId}">`
      : '',
    metaproductId != null
      ? `<input type="hidden" name="idMetacard" value="${metaproductId}">`
      : '',
  ].join('');

  return `<!doctype html>
    <html>
      <head><title>${title}</title></head>
      <body>
        <div id="FilterForm">${filterInputs}</div>
        <h1>Test Card</h1>
        ${bodyText}
        <div class="article-table">
          <div class="table-body">${rows.join('')}</div>
        </div>
      </body>
    </html>`;
}

describe('buildProductUrl', () => {
  it('builds the exact numeric Cardmarket filter URL', () => {
    expect(buildProductUrl(844281)).toBe(
      'https://www.cardmarket.com/en/Magic/Products?idProduct=844281&language=1&minCondition=3',
    );
    expect(buildProductUrl(844281, 'NM')).toContain('minCondition=2');
  });
});

describe('withOfferFilters', () => {
  it('forces English and numeric minCondition while preserving other params', () => {
    const filtered = new URL(
      withOfferFilters(
        'https://www.cardmarket.com/en/Magic/Cards/Command-Tower?language=2&minCondition=5&foo=bar',
        'NM',
      ),
    );

    expect(filtered.pathname).toBe('/en/Magic/Cards/Command-Tower');
    expect(filtered.searchParams.get('language')).toBe('1');
    expect(filtered.searchParams.get('minCondition')).toBe('2');
    expect(filtered.searchParams.get('foo')).toBe('bar');
  });
});

describe('buildMetaproductUrlFromProductHtml', () => {
  it('prefers the Show Offers link from the real product fixture', () => {
    const url = buildMetaproductUrlFromProductHtml(productHtml, PRODUCT_BASE);
    expect(url).not.toBeNull();

    const parsed = new URL(url!);
    expect(parsed.pathname).toBe('/en/Magic/Cards/Command-Tower');
    expect(parsed.searchParams.get('language')).toBe('1');
    expect(parsed.searchParams.get('minCondition')).toBe('3');
  });

  it('strips /Versions from a Show Versions link when Show Offers is absent', () => {
    const html = `<!doctype html><html><body>
      <div id="tabContent-info"><div class="info-list-container">
        <a href="/en/Magic/Cards/Command-Tower/Versions">Show Versions (124)</a>
      </div></div>
    </body></html>`;

    const parsed = new URL(
      buildMetaproductUrlFromProductHtml(html, PRODUCT_BASE)!,
    );
    expect(parsed.pathname).toBe('/en/Magic/Cards/Command-Tower');
    expect(parsed.searchParams.get('language')).toBe('1');
    expect(parsed.searchParams.get('minCondition')).toBe('3');
  });

  it('returns null when the page has no metaproduct link', () => {
    expect(
      buildMetaproductUrlFromProductHtml(
        '<!doctype html><html><body>No links here</body></html>',
        PRODUCT_BASE,
      ),
    ).toBeNull();
    expect(buildMetaproductUrlFromProductHtml('', PRODUCT_BASE)).toBeNull();
  });
});

describe('parseCardmarketPage: product fixture', () => {
  const page = parseCardmarketPage(
    productHtml,
    PRODUCT_BASE,
    makeWant({ finish: 'foil' }),
  );

  it('parses page identity and all 50 English foil offers', () => {
    expect(page.pageKind).toBe('product');
    expect(page.productId).toBe(844281);
    expect(page.metaproductId).toBeUndefined();
    expect(page.name).toBe('Command Tower (V.9)');
    expect(page.offers).toHaveLength(50);
    expect(page.offers.every((offer) => offer.language === 'EN')).toBe(true);
    expect(page.hasMore).toBe(true);
    expect(page.cloudflare).toBe(false);
  });

  it('parses the first offer seller, condition, price, and stock', () => {
    const first = page.offers[0]!;

    expect(first.id).toBe('2049568859');
    expect(first.wantId).toBe('want-1');
    expect(first.productName).toBe('Command Tower');
    expect(first.productId).toBe(844281);
    expect(first.seller).toMatchObject({
      name: 'sobbMTG',
      country: 'Finland',
      countryId: 11,
      isCommercial: false,
      isPowerseller: false,
      salesCount: 513,
    });
    expect(first.condition).toBe('EX');
    expect(first.language).toBe('EN');
    expect(first.finish).toBe('foil');
    expect(first.isSigned).toBe(false);
    expect(first.isAltered).toBe(false);
    expect(first.priceCents).toBe(75);
    expect(first.stock).toBe(1);
    expect(first.expansion).toBe('Secret Lair Drop Series');
    expect(first.comment).toBeUndefined();
    expect(first.url).toBe(PRODUCT_BASE);
  });

  it('exposes the metaproduct URL for the exact printing', () => {
    const parsed = new URL(page.metaproductUrl!);
    expect(parsed.pathname).toBe('/en/Magic/Cards/Command-Tower');
    expect(parsed.searchParams.get('language')).toBe('1');
    expect(parsed.searchParams.get('minCondition')).toBe('3');
  });
});

describe('parseCardmarketPage: metaproduct fixture', () => {
  const page = parseCardmarketPage(
    metaproductHtml,
    METAPRODUCT_BASE,
    makeWant({ finish: 'nonfoil' }),
  );

  it('parses page kind and metaproduct id', () => {
    expect(page.pageKind).toBe('metaproduct');
    expect(page.metaproductId).toBe(203332);
    expect(page.productId).toBeUndefined();
    expect(page.name).toBe('Command Tower');
    expect(page.hasMore).toBe(true);
    expect(page.cloudflare).toBe(false);
  });

  it('keeps only the 39 English rows out of the 50 fixture rows', () => {
    const rawDoc = new DOMParser().parseFromString(
      metaproductHtml,
      'text/html',
    );
    expect(
      rawDoc.querySelectorAll('.article-table .table-body > .article-row'),
    ).toHaveLength(50);
    expect(page.offers).toHaveLength(39);
    expect(page.offers.every((offer) => offer.language === 'EN')).toBe(true);
  });

  it('parses the first metaproduct offer and derives its product id', () => {
    const first = page.offers[0]!;

    expect(first.id).toBe('2191832856');
    expect(first.seller).toMatchObject({
      name: 'Adraul',
      country: 'Switzerland',
      countryId: 4,
      isCommercial: true,
      isPowerseller: false,
      salesCount: 1705,
    });
    expect(first.condition).toBe('NM');
    expect(first.finish).toBe('nonfoil');
    expect(first.priceCents).toBe(10);
    expect(first.stock).toBe(1);
    expect(first.productId).toBe(914156);
    expect(first.expansion).toBe(
      'Secret Lair Commander Deck: Odds and Ends',
    );
  });
});

describe('parseCardmarketPage: logged-in row markup', () => {
  it('finds rows that have the row class but not article-row', () => {
    const doc = new DOMParser().parseFromString(productHtml, 'text/html');
    for (const row of doc.querySelectorAll('.article-row')) {
      row.classList.remove('article-row');
    }

    const page = parseCardmarketPage(
      doc.documentElement.outerHTML,
      PRODUCT_BASE,
      makeWant({ finish: 'foil', allowAnyFinish: false }),
    );

    expect(page.offers.length).toBe(50);
  });
});

describe('parseCardmarketPage: localized language labels', () => {
  it('accepts the German label for English', () => {
    const doc = new DOMParser().parseFromString(productHtml, 'text/html');
    const row = doc.querySelector('.article-row');
    const condition = row?.querySelector('.article-condition');
    const languageIcon = condition?.nextElementSibling;
    languageIcon?.setAttribute('aria-label', 'Englisch');
    languageIcon?.setAttribute('data-bs-original-title', 'Englisch');

    const page = parseCardmarketPage(
      doc.documentElement.outerHTML,
      PRODUCT_BASE,
      makeWant({ finish: 'foil', allowAnyFinish: false }),
    );

    expect(page.offers.length).toBe(50);
  });

  it('trusts the English URL filter when no language label is exposed', () => {
    const doc = new DOMParser().parseFromString(productHtml, 'text/html');
    for (const row of doc.querySelectorAll('.article-row')) {
      const condition = row.querySelector('.article-condition');
      condition?.nextElementSibling?.remove();
    }

    const page = parseCardmarketPage(
      doc.documentElement.outerHTML,
      PRODUCT_BASE,
      makeWant({ finish: 'foil', allowAnyFinish: false }),
    );

    expect(page.offers.length).toBe(50);
  });
});

describe('parseCardmarketPage: logged-in quantity fallback', () => {
  it('uses the amount input max when the item-count badge is absent', () => {
    const doc = new DOMParser().parseFromString(productHtml, 'text/html');
    const row = doc.querySelector('.article-row');
    if (!row) throw new Error('Fixture has no article row');

    row.querySelector('.col-offer .amount-container')?.remove();
    const actions = row.querySelector('.col-offer .actions-container');
    if (!actions) throw new Error('Fixture has no actions container');

    const input = doc.createElement('input');
    input.type = 'number';
    input.name = 'amount';
    input.value = '1';
    input.setAttribute('max', '7');
    actions.append(input);

    const page = parseCardmarketPage(
      doc.documentElement.outerHTML,
      PRODUCT_BASE,
      makeWant({ finish: 'foil', allowAnyFinish: false }),
    );

    expect(page.offers[0]?.stock).toBe(7);
  });
});

describe('parseCardmarketPage: price, ETA, and malformed rows', () => {
  it('parses dot-thousands and comma decimals as cents', () => {
    const html = syntheticPage(
      [
        syntheticRow({
          price: '1.234,56 €',
          stock: '3',
          condition: 'EX',
          foil: true,
          seller: 'priceguy',
          country: 'Austria',
        }),
      ],
      { productId: 123 },
    );

    const page = parseCardmarketPage(
      html,
      'https://www.cardmarket.com/en/Magic/Products?idProduct=123',
      makeWant(),
    );

    expect(page.offers).toHaveLength(1);
    expect(page.offers[0]).toMatchObject({
      priceCents: 123456,
      stock: 3,
      condition: 'EX',
      finish: 'foil',
    });
  });

  it('reads seller and buyer ETA numbers from the calendar tooltip', () => {
    const html = syntheticPage(
      [
        syntheticRow({
          eta: 'Seller ETA: 3 days: 5 days to buyer',
          foil: true,
        }),
      ],
      { productId: 123 },
    );

    const page = parseCardmarketPage(
      html,
      'https://www.cardmarket.com/en/Magic/Products?idProduct=123',
      makeWant(),
    );

    expect(page.offers[0]?.seller.etaDays).toBe(3);
    expect(page.offers[0]?.etaDays).toBe(5);
  });

  it('skips malformed rows instead of throwing', () => {
    const html = syntheticPage(
      [
        syntheticRow({ id: 1, price: '1,00 €', foil: true }),
        syntheticRow({ id: 2, price: 'not a price', foil: true }),
        syntheticRow({ id: 3, condition: 'BAD', foil: true }),
      ],
      { productId: 123 },
    );

    const page = parseCardmarketPage(
      html,
      'https://www.cardmarket.com/en/Magic/Products?idProduct=123',
      makeWant(),
    );

    expect(page.offers.map((offer) => offer.id)).toEqual(['1']);
  });
});

describe('parseCardmarketPage: cloudflare', () => {
  it('detects a Just a moment challenge page', () => {
    const html = `<!doctype html><html>
      <head><title>Just a moment...</title></head>
      <body>Checking your browser</body>
    </html>`;

    const page = parseCardmarketPage(
      html,
      METAPRODUCT_BASE,
      makeWant({ finish: 'nonfoil' }),
    );

    expect(page.cloudflare).toBe(true);
    expect(page.offers).toEqual([]);
  });

  it('detects security verification when there are zero offer rows', () => {
    const html = syntheticPage([], {
      title: 'Command Tower',
      bodyText: 'Performing security verification',
      metaproductId: 203332,
    });

    const page = parseCardmarketPage(
      html,
      METAPRODUCT_BASE,
      makeWant({ finish: 'nonfoil' }),
    );

    expect(page.cloudflare).toBe(true);
    expect(page.offers).toEqual([]);
  });

  it('throws only for empty or non-string HTML', () => {
    expect(() =>
      parseCardmarketPage('', METAPRODUCT_BASE, makeWant()),
    ).toThrow(/empty/i);
    expect(() =>
      parseCardmarketPage(
        null as unknown as string,
        METAPRODUCT_BASE,
        makeWant(),
      ),
    ).toThrow(/empty/i);
  });
});

describe('parseCardmarketPage: finish filtering', () => {
  it('keeps all 50 foil rows for foil and none for nonfoil', () => {
    expect(
      parseCardmarketPage(
        productHtml,
        PRODUCT_BASE,
        makeWant({ finish: 'foil' }),
      ).offers,
    ).toHaveLength(50);
    expect(
      parseCardmarketPage(
        productHtml,
        PRODUCT_BASE,
        makeWant({ finish: 'nonfoil' }),
      ).offers,
    ).toHaveLength(0);
  });

  it('filters exact finishes and keeps both when allowAnyFinish is true', () => {
    const html = syntheticPage(
      [
        syntheticRow({ id: 1, foil: true }),
        syntheticRow({ id: 2, foil: false }),
      ],
      { productId: 123 },
    );
    const baseUrl = 'https://www.cardmarket.com/en/Magic/Products?idProduct=123';

    const foil = parseCardmarketPage(
      html,
      baseUrl,
      makeWant({ finish: 'foil', allowAnyFinish: false }),
    );
    const nonfoil = parseCardmarketPage(
      html,
      baseUrl,
      makeWant({ finish: 'nonfoil', allowAnyFinish: false }),
    );
    const any = parseCardmarketPage(
      html,
      baseUrl,
      makeWant({ finish: 'foil', allowAnyFinish: true }),
    );

    expect(foil.offers.map((offer) => offer.id)).toEqual(['1']);
    expect(nonfoil.offers.map((offer) => offer.id)).toEqual(['2']);
    expect(any.offers.map((offer) => offer.id)).toEqual(['1', '2']);
    expect(any.offers.map((offer) => offer.finish)).toEqual([
      'foil',
      'nonfoil',
    ]);
  });

  it('treats etched as its own finish rather than regular foil', () => {
    const html = syntheticPage(
      [syntheticRow({ id: 9, foil: true })],
      { productId: 999 },
    );
    const page = parseCardmarketPage(
      html,
      'https://www.cardmarket.com/en/Magic/Products?idProduct=999',
      makeWant({ finish: 'etched' }),
    );

    expect(page.offers).toHaveLength(1);
    expect(page.offers[0]?.finish).toBe('etched');
  });
});
