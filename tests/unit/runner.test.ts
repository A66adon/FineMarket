import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  CardmarketRateLimitError,
  runWizard,
} from '../../src/shared/runner';
import type { DeckOptions, Want } from '../../src/shared/types';

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
