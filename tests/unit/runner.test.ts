import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  CardmarketRateLimitError,
  runWizard,
} from '../../src/shared/runner';
import type {
  DeckOptions,
  Offer,
  ShippingMethod,
  Want,
} from '../../src/shared/types';

function want(): Want {
  return {
    id: 'want-1',
    name: 'Dark Ritual',
    quantity: 1,
    finish: 'nonfoil',
    board: 'mainboard',
    isBasicLand: false,
    exactProductId: 18052,
    productUrl:
      'https://www.cardmarket.com/en/Magic/Products?idProduct=18052',
    allowAnyPrinting: true,
    allowAnyFinish: true,
    ownedQuantity: 0,
    ownedExactQuantity: 0,
    offers: [],
  };
}

function options(): DeckOptions {
  return {
    boards: ['mainboard'],
    includeBasicLands: true,
    ignoreOwned: false,
    mode: 'cheapest-playable',
    minCondition: 'EX',
    sellerCountryIds: [],
    commercialOnly: false,
    alwaysTrack: false,
    destinationCountryId: 7,
  };
}

function offer(): Offer {
  return {
    id: 'article-1',
    wantId: 'want-1',
    productName: 'Phyrexian Walker',
    condition: 'EX',
    language: 'EN',
    finish: 'nonfoil',
    isSigned: false,
    isAltered: false,
    priceCents: 200,
    stock: 1,
    seller: {
      id: 'seller-1',
      name: 'seller-1',
      country: 'Germany',
      countryId: 7,
      isCommercial: true,
      isPowerseller: false,
    },
  };
}

function shippingMethod(): ShippingMethod {
  return {
    methodKey: 'letter',
    name: 'Letter',
    isTracked: false,
    maxValueCents: 10_000,
    maxWeightG: 500,
    stampPriceRaw: '',
    stampPriceCents: null,
    priceCents: 200,
    isLetter: true,
    isVirtual: false,
  };
}

describe('runWizard rate limiting', () => {
  it('stops the run on the first 429 instead of walking the deck', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(
      async () =>
        ({
          ok: false,
          status: 429,
          rateLimited: true,
          retryAfterMs: 60_000,
          error: 'Cardmarket is rate-limiting this IP.',
        }) as never,
    );

    await expect(
      runWizard({ wants: [want()], options: options() }),
    ).rejects.toBeInstanceOf(CardmarketRateLimitError);
  });
});

describe('runWizard cheapest-playable requests', () => {
  it('fetches the all-printings page without fetching the exact product first', async () => {
    const calls: string[] = [];
    const target = {
      ...want(),
      name: 'Phyrexian Walker',
      exactProductId: 792623,
      productUrl:
        'https://www.cardmarket.com/en/Magic/Products?idProduct=792623',
    };
    const metaproductPage = {
      pageKind: 'metaproduct' as const,
      name: 'Phyrexian Walker',
      metaproductId: 203332,
      offers: [offer()],
      hasMore: false,
      cloudflare: false,
    };

    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(
      async (message) => {
        const msg = message as unknown as {
          type: string;
          url?: string;
        };
        if (msg.type === 'FETCH_CARDMARKET_WANT') {
          calls.push(msg.url ?? '');
          return { ok: true, page: metaproductPage } as never;
        }
        if (msg.type === 'FETCH_SHIPPING') {
          return { ok: true, methods: [shippingMethod()] } as never;
        }
        return { ok: false } as never;
      },
    );

    const result = await runWizard({ wants: [target], options: options() });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/en/Magic/Cards/Phyrexian-Walker');
    expect(calls[0]).toContain('language=1');
    expect(calls[0]).toContain('minCondition=3');
    expect(result.wants[0]?.offers).toHaveLength(1);
    expect(result.result.plans.length).toBeGreaterThan(0);
  });

  it('falls back to the exact product when the all-printings page is empty', async () => {
    const calls: string[] = [];
    const target = {
      ...want(),
      name: 'Phyrexian Walker',
      exactProductId: 792623,
      productUrl:
        'https://www.cardmarket.com/en/Magic/Products?idProduct=792623',
    };
    const emptyMetaproductPage = {
      pageKind: 'metaproduct' as const,
      name: 'Phyrexian Walker',
      metaproductId: 203332,
      offers: [],
      hasMore: false,
      cloudflare: false,
    };
    const productPage = {
      pageKind: 'product' as const,
      name: 'Phyrexian Walker',
      productId: 792623,
      offers: [offer()],
      hasMore: false,
      cloudflare: false,
    };

    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(
      async (message) => {
        const msg = message as unknown as {
          type: string;
          url?: string;
        };
        if (msg.type === 'FETCH_CARDMARKET_WANT') {
          calls.push(msg.url ?? '');
          return {
            ok: true,
            page: msg.url?.includes('/Magic/Cards/')
              ? emptyMetaproductPage
              : productPage,
          } as never;
        }
        if (msg.type === 'FETCH_SHIPPING') {
          return { ok: true, methods: [shippingMethod()] } as never;
        }
        return { ok: false } as never;
      },
    );

    const result = await runWizard({ wants: [target], options: options() });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/en/Magic/Cards/Phyrexian-Walker');
    expect(calls[1]).toContain('idProduct=792623');
    expect(result.wants[0]?.offers).toHaveLength(1);
  });
});
