import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boardOptions,
  buildWants,
  extractIdProductFromCardMarketUrl,
  extractMoxfieldPublicId,
  normalizeMoxfieldDeck,
  selectDeckCards,
} from '../../src/shared/moxfield';
import type {
  Deck,
  DeckCard,
  DeckOptions,
  Finish,
} from '../../src/shared/types';

interface RawFixtureCard {
  cardMarketUrl: string | null;
  cardmarket_id: number | null;
}

interface RawFixtureEntry {
  quantity: number;
  finish: string;
  isFoil: boolean;
  isProxy?: boolean;
  isAlter?: boolean;
  card: RawFixtureCard;
}

interface RawFixture {
  publicId: string;
  name: string;
  format: string;
  visibility: string;
  publicUrl: string;
  authors: Array<{ userName?: string; displayName?: string }>;
  boards: Record<
    string,
    { count: number; cards: Record<string, RawFixtureEntry> }
  >;
}

const rawFixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'tests/fixtures/moxfield-deck-command-tower.json'),
    'utf8',
  ),
) as RawFixture;

const deck = normalizeMoxfieldDeck(rawFixture);

function deckOptions(overrides: Partial<DeckOptions> = {}): DeckOptions {
  return {
    boards: ['mainboard', 'commanders'],
    includeBasicLands: true,
    ignoreOwned: false,
    mode: 'deck-as-listed',
    minCondition: 'EX',
    sellerCountryIds: [],
    commercialOnly: false,
    alwaysTrack: false,
    destinationCountryId: 7,
    ...overrides,
  };
}

function finishCounts(cards: readonly DeckCard[]): Record<Finish, number> {
  const counts: Record<Finish, number> = { nonfoil: 0, foil: 0, etched: 0 };
  for (const card of cards) counts[card.finish] += card.quantity;
  return counts;
}

function firstMainboardCard(source: Deck): DeckCard {
  const card = source.cards.find((candidate) => candidate.board === 'mainboard');
  if (!card) throw new Error('Fixture has no mainboard card');
  return card;
}

describe('extractMoxfieldPublicId', () => {
  it('accepts canonical, www, trailing slash, query, and fragment forms', () => {
    const id = 'sPueARQ_KHiSbmZbhRYNnA';

    expect(extractMoxfieldPublicId(`https://moxfield.com/decks/${id}`)).toBe(id);
    expect(extractMoxfieldPublicId(`https://www.moxfield.com/decks/${id}`)).toBe(
      id,
    );
    expect(extractMoxfieldPublicId(`https://moxfield.com/decks/${id}/`)).toBe(id);
    expect(
      extractMoxfieldPublicId(
        `https://moxfield.com/decks/${id}?utm_source=deckcart#primer`,
      ),
    ).toBe(id);
  });

  it('rejects non-deck pages, extra paths, and lookalike hosts', () => {
    const id = 'sPueARQ_KHiSbmZbhRYNnA';

    expect(
      extractMoxfieldPublicId(`https://moxfield.com.evil.test/decks/${id}`),
    ).toBeNull();
    expect(
      extractMoxfieldPublicId(`https://moxfield.com/decks/${id}/primer`),
    ).toBeNull();
    expect(
      extractMoxfieldPublicId(`https://moxfield.com/cards/${id}`),
    ).toBeNull();
    expect(extractMoxfieldPublicId('not a url')).toBeNull();
    expect(
      extractMoxfieldPublicId('https://moxfield.com/decks/short'),
    ).toBeNull();
  });
});

describe('extractIdProductFromCardMarketUrl', () => {
  it('reads idProduct from a real Moxfield Cardmarket URL', () => {
    const commandTower = Object.values(
      rawFixture.boards.mainboard?.cards ?? {},
    ).find((entry) => entry.card.cardMarketUrl?.includes('idProduct=844281'));

    expect(commandTower).toBeDefined();
    expect(
      extractIdProductFromCardMarketUrl(commandTower?.card.cardMarketUrl),
    ).toBe(844281);
  });

  it('accepts URLSearchParams and the direct cardmarket_id number fallback', () => {
    expect(
      extractIdProductFromCardMarketUrl(
        'https://www.cardmarket.com/en/Magic/Products?idProduct=123&referrer=moxfield',
      ),
    ).toBe(123);
    expect(extractIdProductFromCardMarketUrl(844281)).toBe(844281);
  });

  it('returns null for missing, invalid, or non-positive ids', () => {
    expect(extractIdProductFromCardMarketUrl(null)).toBeNull();
    expect(extractIdProductFromCardMarketUrl(undefined)).toBeNull();
    expect(
      extractIdProductFromCardMarketUrl(
        'https://www.cardmarket.com/en/Magic/Products?idProduct=abc',
      ),
    ).toBeNull();
    expect(extractIdProductFromCardMarketUrl(0)).toBeNull();
    expect(extractIdProductFromCardMarketUrl(-5)).toBeNull();
  });
});

describe('normalizeMoxfieldDeck', () => {
  it('keeps deck metadata and uses real board quantities', () => {
    expect(deck.publicId).toBe('sPueARQ_KHiSbmZbhRYNnA');
    expect(deck.name).toBe(
      'Weatherlight Labs Secret Vault - Temple of Doom (Public)',
    );
    expect(deck.format).toBe('commander');
    expect(deck.visibility).toBe('public');
    expect(deck.author).toBe('JDvonAwesome');
    expect(deck.url).toBe('https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA');

    expect(deck.boards).toHaveLength(12);
    expect(deck.boards.find((board) => board.name === 'mainboard')).toMatchObject(
      { label: 'Mainboard', count: 99 },
    );
    expect(
      deck.boards.find((board) => board.name === 'commanders'),
    ).toMatchObject({ label: 'Commanders', count: 1 });
    expect(
      deck.boards.find((board) => board.name === 'maybeboard'),
    ).toMatchObject({ label: 'Maybeboard', count: 9 });
    expect(deck.boards.find((board) => board.name === 'sideboard')?.count).toBe(
      0,
    );

    expect(deck.cards).toHaveLength(109);
  });

  it('does not import top-level main or tokens', () => {
    const sisayPrintings = deck.cards.filter((card) =>
      card.name.startsWith('Sisay, Weatherlight Captain'),
    );

    expect(sisayPrintings).toHaveLength(1);
    expect(sisayPrintings[0]).toMatchObject({
      set: 'sld',
      collectorNumber: '1444',
      finish: 'foil',
    });
    expect(deck.cards.some((card) => card.set === 'mh1')).toBe(false);
  });

  it('uses entry.finish as authoritative (foil/etched edge cases)', () => {
    const mainboard = deck.boards.find((board) => board.name === 'mainboard');
    const byName = new Map(
      (mainboard?.cards ?? []).map((card) => [card.name, card]),
    );

    expect(byName.get('Quirion Ranger')?.finish).toBe('foil');
    expect(byName.get('Mox Opal')?.finish).toBe('etched');
    expect(byName.get('Dark Ritual')?.finish).toBe('etched');

    expect(finishCounts(mainboard?.cards ?? [])).toEqual({
      foil: 70,
      etched: 3,
      nonfoil: 26,
    });
  });

  it('detects basics from the front type line and falls back to card_faces', () => {
    const synthetic = normalizeMoxfieldDeck({
      publicId: 'aaaaaaaaaaaaaaaaaaaaaa',
      name: 'Synthetic',
      format: 'commander',
      visibility: 'unlisted',
      publicUrl: 'https://moxfield.com/decks/aaaaaaaaaaaaaaaaaaaaaa',
      authors: [{ userName: 'tester' }],
      main: { name: 'Not a deck card' },
      tokens: [{ name: 'Also not a deck card' }],
      boards: {
        mainboard: {
          count: 3,
          cards: {
            basic: {
              quantity: 2,
              finish: 'nonFoil',
              card: {
                id: 'basic',
                name: 'Forest',
                set: 'unf',
                set_name: 'Unfinity',
                cn: '1',
                type_line: 'Basic Land — Forest',
                digital: false,
                lang: 'en',
                cardmarket_id: null,
                cardMarketUrl: null,
              },
            },
            snow: {
              quantity: 1,
              finish: 'foil',
              isProxy: true,
              card: {
                id: 'snow',
                name: 'Snow-Covered Island',
                set: 'khm',
                set_name: 'Kaldheim',
                cn: '2',
                type_line: null,
                card_faces: [{ type_line: 'Basic Snow Land — Island' }],
                digital: false,
                lang: 'en',
                cardmarket_id: 777777,
                cardMarketUrl: null,
              },
            },
          },
        },
      },
    });

    expect(synthetic.author).toBe('tester');
    expect(synthetic.cards).toHaveLength(2);
    expect(synthetic.cards.find((card) => card.name === 'Forest')).toMatchObject({
      isBasicLand: true,
      language: 'EN',
      productId: null,
    });
    expect(
      synthetic.cards.find((card) => card.name === 'Snow-Covered Island'),
    ).toMatchObject({
      isBasicLand: true,
      finish: 'foil',
      productId: 777777,
      typeLine: 'Basic Snow Land — Island',
    });
  });
});

describe('boardOptions', () => {
  it('returns only populated boards in canonical order with defaults', () => {
    expect(boardOptions(deck)).toEqual([
      {
        name: 'mainboard',
        label: 'Mainboard',
        count: 99,
        defaultIncluded: true,
      },
      {
        name: 'commanders',
        label: 'Commanders',
        count: 1,
        defaultIncluded: true,
      },
      {
        name: 'maybeboard',
        label: 'Maybeboard',
        count: 9,
        defaultIncluded: false,
      },
    ]);
  });
});

describe('selectDeckCards', () => {
  it('selects the 100-card commander deck and preserves finishes', () => {
    const selected = selectDeckCards(deck, {
      boards: ['mainboard', 'commanders'],
      includeBasicLands: true,
    });

    expect(selected).toHaveLength(100);
    expect(finishCounts(selected)).toEqual({
      foil: 71,
      etched: 3,
      nonfoil: 26,
    });
    expect(selected.every((card) => typeof card.productId === 'number')).toBe(
      true,
    );
  });

  it('applies board selection and the basic-land toggle', () => {
    const withBasic = structuredClone(deck);
    const sample = firstMainboardCard(withBasic);
    const basic: DeckCard = {
      ...sample,
      id: 'synthetic-basic',
      name: 'Forest',
      productId: 123456,
      productUrl:
        'https://www.cardmarket.com/en/Magic/Products?idProduct=123456',
      quantity: 2,
      finish: 'nonfoil',
      isBasicLand: true,
      typeLine: 'Basic Land — Forest',
    };
    withBasic.cards.push(basic);

    expect(
      selectDeckCards(withBasic, {
        boards: ['mainboard', 'commanders'],
        includeBasicLands: true,
      }),
    ).toHaveLength(101);
    expect(
      selectDeckCards(withBasic, {
        boards: ['mainboard', 'commanders'],
        includeBasicLands: false,
      }),
    ).toHaveLength(100);
    expect(
      selectDeckCards(withBasic, {
        boards: ['commanders'],
        includeBasicLands: true,
      }),
    ).toHaveLength(1);
  });

  it('excludes proxies, alters, and digital cards', () => {
    const filtered = structuredClone(deck);
    const sample = firstMainboardCard(filtered);
    filtered.cards.push(
      { ...sample, id: 'synthetic-proxy', isProxy: true },
      { ...sample, id: 'synthetic-alter', isAlter: true },
      { ...sample, id: 'synthetic-digital', isDigital: true },
    );

    const selected = selectDeckCards(filtered, {
      boards: ['mainboard', 'commanders'],
      includeBasicLands: true,
    });

    expect(selected).toHaveLength(100);
    expect(
      selected.some((card) =>
        ['synthetic-proxy', 'synthetic-alter', 'synthetic-digital'].includes(
          card.id,
        ),
      ),
    ).toBe(false);
  });
});

describe('buildWants', () => {
  it('deck-as-listed groups by product + finish + board and sums quantities', () => {
    const grouped = structuredClone(deck);
    const commandTower = grouped.cards.find(
      (card) => card.board === 'mainboard' && card.name === 'Command Tower',
    );
    if (!commandTower || commandTower.productId == null) {
      throw new Error('Command Tower fixture entry missing');
    }

    grouped.cards.push({
      ...commandTower,
      id: 'synthetic-same-product',
    });
    grouped.cards.push({
      ...commandTower,
      id: 'synthetic-other-printing',
      productId: commandTower.productId + 100000,
      productUrl: `https://www.cardmarket.com/en/Magic/Products?idProduct=${
        commandTower.productId + 100000
      }`,
    });

    const wants = buildWants(
      grouped,
      deckOptions({ mode: 'deck-as-listed' }),
    );
    const sameProduct = wants.find(
      (want) =>
        want.exactProductId === commandTower.productId &&
        want.finish === commandTower.finish &&
        want.board === commandTower.board,
    );
    const sameName = wants.filter(
      (want) =>
        want.name === commandTower.name &&
        want.finish === commandTower.finish &&
        want.board === commandTower.board,
    );

    expect(sameProduct?.quantity).toBe(commandTower.quantity + 1);
    expect(sameProduct?.allowAnyPrinting).toBe(false);
    expect(sameProduct?.allowAnyFinish).toBe(false);
    expect(sameProduct?.productUrl).toBe(commandTower.productUrl);
    expect(sameProduct?.offers).toEqual([]);
    expect(sameName).toHaveLength(2);
  });

  it('cheapest-playable merges normalized names across printings and sums', () => {
    const grouped = structuredClone(deck);
    const commandTower = grouped.cards.find(
      (card) => card.board === 'mainboard' && card.name === 'Command Tower',
    );
    if (!commandTower || commandTower.productId == null) {
      throw new Error('Command Tower fixture entry missing');
    }

    grouped.cards.push({
      ...commandTower,
      id: 'synthetic-other-printing',
      name: '  CoMmAnD tOwEr  ',
      productId: commandTower.productId + 100000,
      productUrl: `https://www.cardmarket.com/en/Magic/Products?idProduct=${
        commandTower.productId + 100000
      }`,
    });

    const wants = buildWants(
      grouped,
      deckOptions({ mode: 'cheapest-playable' }),
    );
    const merged = wants.filter(
      (want) => want.name.trim().toLowerCase() === 'command tower',
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      quantity: commandTower.quantity + 1,
      finish: commandTower.finish,
      allowAnyPrinting: true,
      allowAnyFinish: true,
      exactProductId: commandTower.productId,
      productUrl: commandTower.productUrl,
    });
    expect(merged[0]?.missingReason).toBeUndefined();
  });

  it('keeps cards without a product id and reports the missing reason', () => {
    const grouped = structuredClone(deck);
    const sample = firstMainboardCard(grouped);
    grouped.cards.push({
      ...sample,
      id: 'synthetic-missing-product',
      name: 'Mystery Card',
      productId: null,
      productUrl: undefined,
      quantity: 2,
    });

    const wants = buildWants(
      grouped,
      deckOptions({ mode: 'cheapest-playable' }),
    );
    const missing = wants.find((want) => want.name === 'Mystery Card');

    expect(missing).toMatchObject({
      quantity: 2,
      missingReason: 'No Cardmarket product id',
    });
    expect(missing?.exactProductId).toBeUndefined();
  });

  it('keeps every fixture want as an English exact product', () => {
    const wants = buildWants(deck, deckOptions({ mode: 'deck-as-listed' }));

    expect(wants).toHaveLength(100);
    expect(wants.reduce((sum, want) => sum + want.quantity, 0)).toBe(100);
    expect(
      wants.every(
        (want) =>
          typeof want.exactProductId === 'number' &&
          want.productUrl?.includes(`idProduct=${want.exactProductId}`) ===
            true &&
          want.missingReason === undefined,
      ),
    ).toBe(true);
  });
});
