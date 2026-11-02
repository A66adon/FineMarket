import {
  BOARD_DEFAULT_INCLUDED,
  BOARD_LABELS,
  BOARD_ORDER,
} from './constants';
import type {
  BoardName,
  BoardOption,
  CollectionIndex,
  Deck,
  DeckBoard,
  DeckCard,
  DeckOptions,
  Finish,
  Want,
} from './types';

const MOXFIELD_HOSTS = new Set(['moxfield.com', 'www.moxfield.com']);
const DECK_PATH = /^\/decks\/([A-Za-z0-9_-]{22})\/?$/;
const BASIC_LAND = /\bBasic(?: Snow)? Land\b/i;
const MISSING_PRODUCT_REASON = 'No Cardmarket product id';

const CARDMARKET_HOSTS = new Set(['cardmarket.com', 'www.cardmarket.com']);

/**
 * Parse a Moxfield deck URL and return its 22-character public id.
 * Query strings and fragments are ignored; extra path segments are rejected.
 */
export function extractMoxfieldPublicId(url: string): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!MOXFIELD_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  return DECK_PATH.exec(parsed.pathname)?.[1] ?? null;
}

/**
 * Parse the idProduct query parameter from a Cardmarket URL.
 *
 * A number is also accepted so callers can pass Moxfield's direct
 * `card.cardmarket_id` fallback instead of a URL.
 */
export function extractIdProductFromCardMarketUrl(
  url: string | number | undefined | null,
): number | null {
  if (typeof url === 'number') return positiveSafeInteger(url);
  if (typeof url !== 'string' || !url.trim()) return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!CARDMARKET_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const rawId = parsed.searchParams.get('idProduct');
  if (!rawId || !/^\d+$/.test(rawId)) return null;
  return positiveSafeInteger(Number(rawId));
}

/** Convert a raw Moxfield v3 deck response into the app's normalized Deck. */
export function normalizeMoxfieldDeck(raw: unknown): Deck {
  const root = asRecord(raw);
  if (!root) throw new Error('Invalid Moxfield deck: expected an object');

  const boardsRaw = asRecord(root.boards);
  if (!boardsRaw) throw new Error('Invalid Moxfield deck: missing boards');

  const publicId = asString(root.publicId) ?? '';
  const name = asString(root.name) ?? '';
  const format = asString(root.format) ?? '';
  const visibility = asString(root.visibility) ?? '';
  const url =
    asString(root.publicUrl) ?? (publicId ? `https://moxfield.com/decks/${publicId}` : '');
  const author = extractAuthor(root);

  const boards: DeckBoard[] = [];
  const cards: DeckCard[] = [];

  for (const boardName of BOARD_ORDER) {
    const boardRaw = asRecord(boardsRaw[boardName]);
    const entriesRaw = asRecord(boardRaw?.cards);
    const boardCards: DeckCard[] = [];

    if (entriesRaw) {
      let fallbackId = 0;
      for (const [entryKey, entryRaw] of Object.entries(entriesRaw)) {
        fallbackId += 1;
        const card = normalizeMoxfieldEntry(
          entryKey || `${boardName}-${fallbackId}`,
          boardName,
          entryRaw,
        );
        if (card) boardCards.push(card);
      }
    }

    const count = boardCards.reduce((sum, card) => sum + card.quantity, 0);
    boards.push({
      name: boardName,
      label: BOARD_LABELS[boardName],
      count,
      cards: boardCards,
    });
    cards.push(...boardCards);
  }

  const deck: Deck = {
    publicId,
    name,
    format,
    url,
    visibility,
    boards,
    cards,
  };
  const internalId = asString(root.id);
  if (internalId) deck.internalId = internalId;
  if (author) deck.author = author;
  return deck;
}

/** Board choices in the app's canonical order, omitting empty boards. */
export function boardOptions(deck: Deck): BoardOption[] {
  const byName = new Map(deck.boards.map((board) => [board.name, board]));

  return BOARD_ORDER.flatMap((name) => {
    const board = byName.get(name);
    if (!board || board.count <= 0) return [];
    return [
      {
        name,
        label: BOARD_LABELS[name],
        count: board.count,
        defaultIncluded: BOARD_DEFAULT_INCLUDED[name],
      },
    ];
  });
}

/** Apply board and basic-land filters; proxies, alters, and digital cards never buy. */
export function selectDeckCards(
  deck: Deck,
  options: Pick<DeckOptions, 'boards' | 'includeBasicLands'>,
): DeckCard[] {
  const selectedBoards = new Set(options.boards);

  return deck.cards.filter(
    (card) =>
      selectedBoards.has(card.board) &&
      card.language === 'EN' &&
      !card.isProxy &&
      !card.isAlter &&
      !card.isDigital &&
      (options.includeBasicLands || !card.isBasicLand),
  );
}

/** Turn selected deck cards into purchasing wants for the chosen mode. */
export function buildWants(
  deck: Deck,
  options: DeckOptions,
  collection?: CollectionIndex,
): Want[] {
  const cards = selectDeckCards(deck, options);
  if (options.mode === 'cheapest-playable') {
    return buildCheapestPlayableWants(cards, options, collection);
  }
  return buildDeckAsListedWants(cards, options, collection);
}

function buildDeckAsListedWants(
  cards: readonly DeckCard[],
  options: DeckOptions,
  collection?: CollectionIndex,
): Want[] {
  const groups = new Map<string, DeckCard[]>();

  for (const card of cards) {
    const identity =
      card.productId != null
        ? `p:${card.productId}|f:${card.finish}|b:${card.board}`
        : `m:${normalizeName(card.name)}|f:${card.finish}|b:${card.board}`;
    const group = groups.get(identity);
    if (group) group.push(card);
    else groups.set(identity, [card]);
  }

  return Array.from(groups.values(), (group, index) => {
    const seed = group[0]!;
    const requested = sumQuantity(group);
    const ownedAny = group.reduce(
      (sum, card) => sum + ownedAnyPrinting(card, collection),
      0,
    );
    const ownedExact = group.reduce(
      (sum, card) => sum + ownedExactPrinting(card, collection),
      0,
    );
    const quantity = Math.max(
      0,
      requested - (options.ignoreOwned ? ownedExact : 0),
    );
    if (quantity === 0) return null;

    const want: Want = {
      id: `want-${index + 1}`,
      name: seed.name,
      quantity,
      finish: seed.finish,
      board: seed.board,
      isBasicLand: seed.isBasicLand,
      allowAnyPrinting: false,
      allowAnyFinish: false,
      ownedQuantity: ownedAny,
      ownedExactQuantity: ownedExact,
      offers: [],
    };
    if (seed.productId != null) want.exactProductId = seed.productId;
    if (seed.productUrl) want.productUrl = seed.productUrl;
    if (seed.productId == null) want.missingReason = MISSING_PRODUCT_REASON;
    return want;
  }).filter((want): want is Want => want !== null);
}

function buildCheapestPlayableWants(
  cards: readonly DeckCard[],
  options: DeckOptions,
  collection?: CollectionIndex,
): Want[] {
  const groups = new Map<string, DeckCard[]>();

  for (const card of cards) {
    const identity = normalizeName(card.name);
    const group = groups.get(identity);
    if (group) group.push(card);
    else groups.set(identity, [card]);
  }

  return Array.from(groups.values(), (group, index) => {
    const first = group[0]!;
    const productSeed = group.find((card) => card.productId != null) ?? first;
    const requested = sumQuantity(group);
    const ownedAny = group.reduce(
      (sum, card) => sum + ownedAnyPrinting(card, collection),
      0,
    );
    const ownedExact = group.reduce(
      (sum, card) => sum + ownedExactPrinting(card, collection),
      0,
    );
    const quantity = Math.max(
      0,
      requested - (options.ignoreOwned ? ownedAny : 0),
    );
    if (quantity === 0) return null;

    const want: Want = {
      id: `want-${index + 1}`,
      name: first.name,
      quantity,
      finish: first.finish,
      board: first.board,
      isBasicLand: first.isBasicLand,
      allowAnyPrinting: true,
      allowAnyFinish: true,
      ownedQuantity: ownedAny,
      ownedExactQuantity: ownedExact,
      offers: [],
    };
    if (productSeed.productId != null) want.exactProductId = productSeed.productId;
    if (productSeed.productUrl) want.productUrl = productSeed.productUrl;
    if (productSeed.productId == null) want.missingReason = MISSING_PRODUCT_REASON;
    return want;
  }).filter((want): want is Want => want !== null);
}

function ownedAnyPrinting(
  card: DeckCard,
  collection: CollectionIndex | undefined,
): number {
  if (!collection) return 0;
  if (card.uniqueCardId) {
    const exact = collection.byUniqueCardId.get(card.uniqueCardId);
    if (exact != null) return exact;
  }
  return collection.byName.get(normalizeName(card.name)) ?? 0;
}

function ownedExactPrinting(
  card: DeckCard,
  collection: CollectionIndex | undefined,
): number {
  if (!collection) return 0;
  if (card.moxfieldCardId) {
    const exact = collection.byCardId.get(card.moxfieldCardId);
    if (exact != null) return exact;
  }
  if (card.set && card.collectorNumber) {
    const exact = collection.bySetCn.get(
      `${card.set.toLowerCase()}|${card.collectorNumber}`,
    );
    if (exact != null) return exact;
  }
  if (card.productId != null) {
    const exact = collection.byProductId.get(card.productId);
    if (exact != null) return exact;
  }
  return 0;
}

function normalizeMoxfieldEntry(
  entryKey: string,
  board: BoardName,
  entryRaw: unknown,
): DeckCard | null {
  const entry = asRecord(entryRaw);
  if (!entry) return null;

  const quantity = positiveSafeInteger(entry.quantity);
  if (quantity == null) return null;

  const card = asRecord(entry.card);
  if (!card) return null;

  const name = asString(card.name)?.trim();
  if (!name) return null;

  const typeLine = frontTypeLine(card);
  const productUrl = asString(card.cardMarketUrl) ?? undefined;
  const productId =
    extractIdProductFromCardMarketUrl(asString(card.cardMarketUrl)) ??
    extractIdProductFromCardMarketUrl(asNumber(card.cardmarket_id));

  return {
    id: entryKey,
    name,
    set: asString(card.set) ?? '',
    setName: asString(card.set_name) ?? '',
    collectorNumber: asString(card.cn) ?? '',
    ...(asString(card.scryfall_id)
      ? { scryfallId: asString(card.scryfall_id)! }
      : {}),
    ...(asString(card.uniqueCardId)
      ? { uniqueCardId: asString(card.uniqueCardId)! }
      : {}),
    ...(asString(card.id) ? { moxfieldCardId: asString(card.id)! } : {}),
    productId,
    ...(productUrl ? { productUrl } : {}),
    quantity,
    finish: normalizeFinish(entry.finish, entry.isFoil),
    board,
    isBasicLand: BASIC_LAND.test(typeLine),
    isProxy: entry.isProxy === true,
    isAlter: entry.isAlter === true,
    isDigital: card.digital === true,
    language: 'EN',
    ...(typeLine ? { typeLine } : {}),
  };
}

function extractAuthor(root: Record<string, unknown>): string | undefined {
  const authors = Array.isArray(root.authors) ? root.authors : [];
  for (const authorRaw of authors) {
    const author = asRecord(authorRaw);
    if (!author) continue;
    const name = asString(author.userName) ?? asString(author.displayName);
    if (name) return name;
  }
  return asString(root.author)?.trim() || undefined;
}

function normalizeFinish(raw: unknown, isFoil: unknown): Finish {
  if (typeof raw === 'string') {
    switch (raw.trim().toLowerCase()) {
      case 'foil':
        return 'foil';
      case 'etched':
        return 'etched';
      case 'nonfoil':
      case 'non-foil':
      case 'non foil':
        return 'nonfoil';
    }
  }
  return isFoil === true ? 'foil' : 'nonfoil';
}

function frontTypeLine(card: Record<string, unknown>): string {
  const top = asString(card.type_line)?.trim() ?? '';
  const faces = Array.isArray(card.card_faces) ? card.card_faces : [];
  const firstFace = asRecord(faces[0]);
  const front = asString(firstFace?.type_line)?.trim() ?? '';
  return (top || front).split(/\s*\/\/\s*/)[0]?.trim() ?? '';
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function sumQuantity(cards: readonly DeckCard[]): number {
  return cards.reduce((sum, card) => sum + card.quantity, 0);
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
