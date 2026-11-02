import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';
import { parseShippingMethods } from '../../src/shared/shipping';
import type {
  CollectionEntry,
  Deck,
  DeckCard,
  Seller,
  ShippingMethod,
} from '../../src/shared/types';

const cardNames = [
  'Command Tower',
  'Sol Ring',
  'Arcane Signet',
  'Swords to Plowshares',
  'Counterspell',
  'Cultivate',
];

function makeCard(
  name: string,
  index: number,
  quantity = 1,
): DeckCard {
  return {
    id: `card-${index}`,
    name,
    set: 'tst',
    setName: 'Test Set',
    collectorNumber: String(100 + index),
    uniqueCardId: `unique-${index}`,
    moxfieldCardId: `printing-${index}`,
    productId: 900000 + index,
    productUrl: `https://www.cardmarket.com/en/Magic/Products?idProduct=${900000 + index}`,
    quantity,
    finish: 'nonfoil',
    board: 'mainboard',
    isBasicLand: false,
    isProxy: false,
    isAlter: false,
    isDigital: false,
    language: 'EN',
    typeLine: 'Artifact',
  };
}

const deck: Deck = {
  publicId: 'sPueARQ_KHiSbmZbhRYNnA',
  internalId: 'avma32',
  name: 'Test Deck — Six Card Sample',
  format: 'commander',
  author: 'fixture',
  url: 'https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA',
  visibility: 'public',
  boards: [
    {
      name: 'mainboard',
      label: 'Mainboard',
      count: cardNames.length,
      cards: cardNames.map((name, index) => makeCard(name, index)),
    },
    {
      name: 'commanders',
      label: 'Commanders',
      count: 0,
      cards: [],
    },
  ],
  cards: cardNames.map((name, index) => makeCard(name, index)),
};

const collectionEntries: CollectionEntry[] = [
  {
    uniqueCardId: 'unique-1',
    cardId: 'printing-1',
    quantity: 1,
    name: 'Sol Ring',
  },
];

const shippingJson = JSON.parse(
  fs.readFileSync(
    path.resolve('tests/fixtures/shipping-de-de.json'),
    'utf8',
  ),
) as unknown;
const shippingMethods: ShippingMethod[] = parseShippingMethods(shippingJson);

interface MockData {
  deck: Deck;
  collectionEntries: CollectionEntry[];
  shippingMethods: ShippingMethod[];
  sellers: Seller[];
}

const sellers: Seller[] = [
  {
    id: 'alpha',
    name: 'alphaCards',
    country: 'Germany',
    countryId: 7,
    isCommercial: true,
    isPowerseller: false,
    etaDays: 3,
  },
  {
    id: 'beta',
    name: 'betaCards',
    country: 'Netherlands',
    countryId: 23,
    isCommercial: true,
    isPowerseller: true,
    etaDays: 5,
  },
];

const mockData: MockData = {
  deck,
  collectionEntries,
  shippingMethods,
  sellers,
};

function installMockRuntime(data: MockData): void {
  const chromeApi = (window as unknown as { chrome: any }).chrome;
  if (!chromeApi?.runtime) return;

  const basePrice = (name: string): number =>
    90 + (name.length % 7) * 17 + name.charCodeAt(0) % 11;

  const handle = async (message: any): Promise<unknown> => {
    switch (message?.type) {
      case 'GET_APP_CONTEXT':
        return {
          activeTab: {
            tabId: 1,
            url: 'https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA',
            title: data.deck.name,
          },
          moxfieldTabs: [
            {
              tabId: 1,
              publicId: data.deck.publicId,
              url: data.deck.url,
              title: data.deck.name,
            },
          ],
          destinationCountryId: 7,
        };
      case 'FETCH_MOXFIELD_DECK':
        return { ok: true, deck: data.deck };
      case 'FETCH_MOXFIELD_COLLECTION':
        return {
          ok: true,
          entries: data.collectionEntries,
          source: 'moxfield',
        };
      case 'FETCH_CARDMARKET_WANT': {
        const want = message.want as {
          id: string;
          name: string;
          finish: string;
        };
        const price = basePrice(want.name);
        const offers = data.sellers.map((seller, index) => ({
          id: `${want.id}-${seller.id}`,
          wantId: want.id,
          productId: 900000,
          productName: want.name,
          expansion: 'Test Set',
          condition: index === 0 ? 'NM' : 'EX',
          language: 'EN',
          finish: want.finish,
          isSigned: false,
          isAltered: false,
          priceCents: price + index * 37,
          stock: 4,
          seller,
          etaDays: seller.etaDays,
          comment: index === 0 ? 'Sleeved and ready' : '',
        }));
        return {
          ok: true,
          page: {
            pageKind: 'product',
            name: want.name,
            metaproductUrl: `https://www.cardmarket.com/en/Magic/Cards/${encodeURIComponent(want.name)}`,
            offers,
            hasMore: false,
            cloudflare: false,
          },
        };
      }
      case 'FETCH_SHIPPING':
        return { ok: true, methods: data.shippingMethods };
      case 'APPLY_TO_CART':
        return {
          ok: true,
          added: (message.items as Array<{ quantity: number }>).reduce(
            (sum, item) => sum + item.quantity,
            0,
          ),
          message: message.dryRun
            ? 'Dry run: the cart was not changed.'
            : 'Articles were added to the Cardmarket cart.',
        };
      case 'OPEN_CARDMARKET':
        return { ok: true };
      default:
        return { ok: false, error: `Unmocked message: ${message?.type}` };
    }
  };

  chromeApi.runtime.sendMessage = (
    message: unknown,
    callback?: (response: unknown) => void,
  ) => {
    const result = handle(message);
    if (typeof callback === 'function') {
      void result.then(callback);
      return undefined;
    }
    return result;
  };
}

test('runs a mocked deck to a plan and dry-run apply', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.addInitScript(installMockRuntime, mockData);
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(
    page.getByRole('heading', { name: /Test Deck/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Find cheapest cart' }),
  ).toBeEnabled();

  await page.getByRole('button', { name: 'Find cheapest cart' }).click();
  await expect(
    page.getByRole('heading', { name: 'Choose a plan' }),
  ).toBeVisible({ timeout: 30_000 });

  fs.mkdirSync('.impeccable/review', { recursive: true });
  await page.screenshot({
    path: '.impeccable/review/sidepanel-plans.png',
    fullPage: true,
  });

  await expect(
    page.locator('.plan-lane').filter({ hasText: 'Cheapest' }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Seller stacks' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Review and apply' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('checkbox', { name: /I understand/ }).check();
  await page.getByRole('checkbox', { name: /Dry run/ }).check();
  await page.getByRole('button', { name: 'Test request' }).click();

  await expect(
    page.getByRole('heading', { name: 'Dry run complete' }),
  ).toBeVisible({ timeout: 10_000 });
});

test('shows the Moxfield source screen when there is no active deck', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const chromeApi = (window as unknown as { chrome: any }).chrome;
    if (!chromeApi?.runtime) return;
    chromeApi.runtime.sendMessage = async (message: any) => {
      if (message?.type === 'GET_APP_CONTEXT') {
        return { moxfieldTabs: [], destinationCountryId: 7 };
      }
      return { ok: false, error: 'Unmocked message' };
    };
  });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(
    page.getByRole('heading', {
      name: 'Turn a Moxfield deck into a cheaper cart.',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Load deck' }),
  ).toBeVisible();
});
