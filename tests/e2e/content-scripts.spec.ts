import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';
import type { Want } from '../../src/shared/types';

const productFixture = fs.readFileSync(
  path.resolve(
    'tests/fixtures/cardmarket-product-command-tower.html',
  ),
  'utf8',
);
const productUrl =
  'https://www.cardmarket.com/en/Magic/Products?idProduct=844281';
const deckUrl =
  'https://api2.moxfield.com/v3/decks/all/sPueARQ_KHiSbmZbhRYNnA';
const deckFixture = fs.readFileSync(
  path.resolve('tests/fixtures/moxfield-deck-command-tower.json'),
  'utf8',
);

function makeWant(): Want {
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
    exactProductId: 844281,
    productUrl,
  };
}

test('Moxfield content script injects the deck button', async ({ context }) => {
  const page = await context.newPage();
  const url = 'https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA';

  await page.route('**/*', async (route) => {
    if (route.request().url() === url) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><title>Fixture deck</title></head><body><h1>Fixture deck</h1></body></html>',
      });
      return;
    }
    await route.abort();
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  await expect(
    page.locator('#deckcart-moxfield-host').locator('button'),
  ).toHaveText('Find cheapest Cardmarket cart', { timeout: 10_000 });
});

test('background fetches and normalizes a public Moxfield deck', async ({
  context,
  extensionId,
}) => {
  await context.route(deckUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: deckFixture,
    });
  });

  const extensionPage = await context.newPage();
  await extensionPage.goto(
    `chrome-extension://${extensionId}/sidepanel.html`,
  );

  const response = (await extensionPage.evaluate(async () => {
    const chromeApi = (window as unknown as { chrome: any }).chrome;
    return chromeApi.runtime.sendMessage({
      type: 'FETCH_MOXFIELD_DECK',
      publicId: 'sPueARQ_KHiSbmZbhRYNnA',
    });
  })) as {
    ok: boolean;
    deck?: {
      name: string;
      boards: Array<{ name: string; count: number }>;
      cards: unknown[];
    };
  };

  expect(response.ok).toBe(true);
  expect(response.deck?.name).toContain('Weatherlight');
  const mainboard = response.deck?.boards.find(
    (board) => board.name === 'mainboard',
  );
  expect(mainboard?.count).toBe(99);
  expect(response.deck?.cards.length).toBeGreaterThan(90);
});

test('background reads collection ownership through the open Moxfield tab', async ({
  context,
  extensionId,
}) => {
  const moxfieldUrl = 'https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA';
  const page = await context.newPage();

  await page.addInitScript(() => {
    localStorage.setItem(
      'state',
      JSON.stringify({
        user: { accessToken: 'test-token', userId: 'test-user' },
      }),
    );

    let refreshed = false;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes('/v1/account/token/refresh')) {
        refreshed = true;
        return new Response(
          JSON.stringify({ access_token: 'refreshed-token' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/v1/collections/search')) {
        if (!refreshed) {
          return new Response('', { status: 401 });
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                quantity: 2,
                card: {
                  id: 'printing-1',
                  uniqueCardId: 'unique-1',
                  name: 'Command Tower',
                  set: 'sld',
                  cn: '7030',
                  cardMarketUrl:
                    'https://www.cardmarket.com/en/Magic/Products?idProduct=844281',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return realFetch(input, init);
    };
  });

  await page.route('**/*', async (route) => {
    if (route.request().url() === moxfieldUrl) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><title>Fixture deck</title></head><body><h1>Fixture deck</h1></body></html>',
      });
      return;
    }
    await route.abort();
  });

  await page.goto(moxfieldUrl, { waitUntil: 'domcontentloaded' });

  const extensionPage = await context.newPage();
  await extensionPage.goto(
    `chrome-extension://${extensionId}/sidepanel.html`,
  );

  const response = (await extensionPage.evaluate(async () => {
    const chromeApi = (window as unknown as { chrome: any }).chrome;
    return chromeApi.runtime.sendMessage({
      type: 'FETCH_MOXFIELD_COLLECTION',
      deckInternalId: 'avma32',
      publicId: 'sPueARQ_KHiSbmZbhRYNnA',
    });
  })) as {
    ok: boolean;
    entries?: Array<{
      uniqueCardId: string;
      cardId: string;
      quantity: number;
      productId?: number;
    }>;
    source?: string;
  };

  expect(response.ok).toBe(true);
  expect(response.source).toBe('moxfield');
  expect(response.entries?.[0]).toMatchObject({
    uniqueCardId: 'unique-1',
    cardId: 'printing-1',
    quantity: 2,
    productId: 844281,
  });

  const storedToken = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('state') ?? '{}') as {
      user?: { accessToken?: string };
    };
    return state.user?.accessToken;
  });
  expect(storedToken).toBe('refreshed-token');
});

test('Cardmarket content script parses offers and posts the cart request', async ({
  context,
  extensionId,
}) => {
  const contentPage = await context.newPage();
  const ajaxUrl =
    'https://www.cardmarket.com/en/Magic/AjaxAction/ShoppingCart_Add_AddArticlesFromProductPage';

  await contentPage.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(productUrl)) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: productFixture,
      });
      return;
    }
    if (url === ajaxUrl) {
      await route.fulfill({
        status: 200,
        contentType: 'application/xml; charset=utf-8',
        body: '<response><resultsCode>Z2VuZXJhbE9L</resultsCode></response>',
      });
      return;
    }
    await route.abort();
  });

  await contentPage.goto(productUrl, { waitUntil: 'domcontentloaded' });

  const extensionPage = await context.newPage();
  await extensionPage.goto(
    `chrome-extension://${extensionId}/sidepanel.html`,
  );

  const sendToContent = async (message: unknown) =>
    extensionPage.evaluate(async (payload) => {
      const chromeApi = (window as unknown as { chrome: any }).chrome;
      const tabs = await chromeApi.tabs.query({});
      const target = tabs.find((tab: { url?: string }) =>
        tab.url?.startsWith('https://www.cardmarket.com/'),
      );
      if (!target?.id) throw new Error('Cardmarket tab not found');
      return chromeApi.tabs.sendMessage(target.id, payload);
    }, message);

  await expect
    .poll(
      async () => {
        try {
          const page = (await sendToContent({
            type: 'PAGE_PARSE_WANT',
            url: productUrl,
            want: makeWant(),
          })) as {
            ok?: boolean;
            page?: { offers?: unknown[] };
          };
          return page.ok && (page.page?.offers?.length ?? 0) > 0;
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  const parsed = (await sendToContent({
    type: 'PAGE_PARSE_WANT',
    url: productUrl,
    want: makeWant(),
  })) as {
    ok: boolean;
    page: {
      offers: Array<{
        id: string;
        seller: { name: string; country: string };
        condition: string;
        finish: string;
        priceCents: number;
        stock: number;
      }>;
    };
  };

  expect(parsed.ok).toBe(true);
  expect(parsed.page.offers.length).toBeGreaterThan(0);
  expect(parsed.page.offers[0]!.seller.name).toBeTruthy();
  expect(parsed.page.offers[0]!.condition).toMatch(/^(MT|NM|EX|GD|LP|PL|PO)$/);
  expect(parsed.page.offers[0]!.finish).toBe('foil');
  expect(parsed.page.offers[0]!.priceCents).toBeGreaterThan(0);
  expect(parsed.page.offers[0]!.stock).toBeGreaterThan(0);

  const applied = (await sendToContent({
    type: 'PAGE_ADD_TO_CART',
    items: [{ articleId: parsed.page.offers[0]!.id, quantity: 2 }],
  })) as { ok: boolean; added: number; message: string };

  expect(applied.ok).toBe(true);
  expect(applied.added).toBe(2);
});
