import { describe, expect, it } from 'vitest';
import deckJson from '../fixtures/moxfield-deck-command-tower.json';
import { buildWants, normalizeMoxfieldDeck } from '../../src/shared/moxfield';
import {
  createCollectionIndex,
  parseMoxfieldCollectionCsv,
  parseMoxfieldCollectionResponse,
} from '../../src/shared/moxfield-collection';
import type { DeckOptions } from '../../src/shared/types';

function options(overrides: Partial<DeckOptions> = {}): DeckOptions {
  return {
    boards: ['mainboard', 'commanders'],
    includeBasicLands: true,
    ignoreOwned: true,
    mode: 'cheapest-playable',
    minCondition: 'EX',
    sellerCountryIds: [],
    commercialOnly: false,
    alwaysTrack: false,
    destinationCountryId: 7,
    ...overrides,
  };
}

describe('Moxfield collection parsing', () => {
  it('parses ownedCards maps as one entry per copy', () => {
    const index = parseMoxfieldCollectionResponse({
      ownedCards: {
        uniqueA: ['printingA', 'printingA', 'printingB'],
        uniqueB: ['printingC'],
      },
    });

    expect(index.source).toBe('moxfield');
    expect(index.totalOwned).toBe(4);
    expect(index.byUniqueCardId.get('uniqueA')).toBe(3);
    expect(index.byCardId.get('printingA')).toBe(2);
    expect(index.byCardId.get('printingB')).toBe(1);
  });

  it('prefers data entries because they carry quantities', () => {
    const index = parseMoxfieldCollectionResponse({
      data: [
        {
          quantity: 3,
          card: {
            id: 'printingA',
            uniqueCardId: 'uniqueA',
            name: 'Command Tower',
            set: 'sld',
            cn: '7030',
            cardMarketUrl:
              'https://www.cardmarket.com/en/Magic/Products?idProduct=844281',
          },
        },
        {
          quantity: 2,
          card: {
            id: 'printingB',
            uniqueCardId: 'uniqueB',
            name: 'Swan Song',
          },
        },
      ],
      ownedCards: { uniqueA: ['printingA'] },
    });

    expect(index.totalOwned).toBe(5);
    expect(index.byUniqueCardId.get('uniqueA')).toBe(3);
    expect(index.byCardId.get('printingA')).toBe(3);
    expect(index.byName.get('command tower')).toBe(3);
    expect(index.bySetCn.get('sld|7030')).toBe(3);
    expect(index.byProductId.get(844281)).toBe(3);
  });

  it('parses a Moxfield collection CSV', () => {
    const csv = [
      'Name,Set,Collector Number,Foil,Quantity,Language',
      '"Command Tower",SLD,7030,foil,2,en',
      'Swan Song,SLD,1591,false,1,English',
      'Sol Ring,C21,263,,0,en',
    ].join('\n');

    const index = parseMoxfieldCollectionCsv(csv);
    expect(index.source).toBe('csv');
    expect(index.totalOwned).toBe(3);
    expect(index.byName.get('command tower')).toBe(2);
    expect(index.bySetCn.get('sld|7030')).toBe(2);
    expect(index.byName.get('sol ring')).toBeUndefined();
  });

  it('rejects a CSV without a Name column', () => {
    expect(() => parseMoxfieldCollectionCsv('Set,Qty\nSLD,2')).toThrow(
      /Name column/,
    );
  });

  it('builds an index from direct entries', () => {
    const index = createCollectionIndex(
      [
        {
          uniqueCardId: 'u1',
          cardId: 'c1',
          quantity: 2,
          name: 'Sol Ring',
          set: 'C21',
          collectorNumber: '263',
        },
      ],
      'csv',
    );
    expect(index.totalOwned).toBe(2);
    expect(index.byUniqueCardId.get('u1')).toBe(2);
    expect(index.byCardId.get('c1')).toBe(2);
    expect(index.bySetCn.get('c21|263')).toBe(2);
    expect(index.byName.get('sol ring')).toBe(2);
  });
});

describe('buildWants with collection ownership', () => {
  const deck = normalizeMoxfieldDeck(deckJson);

  it('keeps all cards when the toggle is off', () => {
    const card = deck.cards.find((entry) => entry.quantity === 1)!;
    const collection = createCollectionIndex(
      [
        {
          uniqueCardId: card.uniqueCardId!,
          cardId: card.moxfieldCardId!,
          quantity: 1,
          name: card.name,
        },
      ],
      'moxfield',
    );

    const wants = buildWants(deck, options({ ignoreOwned: false }), collection);
    const want = wants.find((entry) => entry.name === card.name);
    expect(want?.quantity).toBe(1);
    expect(want?.ownedQuantity).toBe(1);
    expect(want?.ownedExactQuantity).toBe(1);
  });

  it('skips fully owned cards when the toggle is on', () => {
    const card = deck.cards.find((entry) => entry.quantity === 1)!;
    const collection = createCollectionIndex(
      [
        {
          uniqueCardId: card.uniqueCardId!,
          cardId: card.moxfieldCardId!,
          quantity: 1,
          name: card.name,
        },
      ],
      'moxfield',
    );

    const wants = buildWants(deck, options(), collection);
    expect(wants.some((entry) => entry.name === card.name)).toBe(false);
  });

  it('subtracts partial ownership from a multi-copy card', () => {
    const seed = deck.cards.find((entry) => entry.quantity === 1)!;
    const card = { ...seed, quantity: 4 };
    const multiDeck = { ...deck, cards: [card] };
    const collection = createCollectionIndex(
      [
        {
          uniqueCardId: card.uniqueCardId!,
          cardId: card.moxfieldCardId!,
          quantity: 1,
          name: card.name,
        },
      ],
      'moxfield',
    );

    const wants = buildWants(multiDeck, options(), collection);
    const want = wants.find((entry) => entry.name === card.name);
    expect(want?.quantity).toBe(3);
    expect(want?.ownedQuantity).toBe(1);
  });

  it('uses exact printing in deck-as-listed mode', () => {
    const card = deck.cards.find(
      (entry) => entry.quantity === 1 && entry.uniqueCardId,
    )!;
    const collection = createCollectionIndex(
      [
        {
          uniqueCardId: card.uniqueCardId!,
          cardId: 'different-printing',
          quantity: 1,
          name: card.name,
        },
      ],
      'moxfield',
    );

    const wants = buildWants(
      deck,
      options({ mode: 'deck-as-listed' }),
      collection,
    );
    const want = wants.find((entry) => entry.name === card.name);
    expect(want?.quantity).toBe(1);
    expect(want?.ownedQuantity).toBe(1);
    expect(want?.ownedExactQuantity).toBe(0);
  });

  it('uses any printing in cheapest-playable mode', () => {
    const card = deck.cards.find(
      (entry) => entry.quantity === 1 && entry.uniqueCardId,
    )!;
    const collection = createCollectionIndex(
      [
        {
          uniqueCardId: card.uniqueCardId!,
          cardId: 'different-printing',
          quantity: 1,
          name: card.name,
        },
      ],
      'moxfield',
    );

    const wants = buildWants(
      deck,
      options({ mode: 'cheapest-playable' }),
      collection,
    );
    expect(wants.some((entry) => entry.name === card.name)).toBe(false);
  });

  it('does not subtract anything when collection data is missing', () => {
    const wants = buildWants(deck, options(), undefined);
    expect(wants.length).toBeGreaterThan(0);
    expect(wants.every((want) => want.ownedQuantity === 0)).toBe(true);
  });
});
