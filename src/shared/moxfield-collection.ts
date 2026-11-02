import type {
  CollectionEntry,
  CollectionIndex,
  Finish,
} from './types';

/**
 * Moxfield's collection-tracker response is undocumented. It has appeared in
 * two shapes:
 *  - `data`: collection entries, each with a `card` object and `quantity`
 *  - `ownedCards`: a map of uniqueCardId -> owned card IDs
 *
 * Parse both defensively. The `data` form is preferred because it carries
 * quantities; the map form assumes one entry per owned copy.
 */
export function parseMoxfieldCollectionResponse(raw: unknown): CollectionIndex {
  const root = asRecord(raw);
  if (!root) throw new Error('Invalid Moxfield collection response');

  const fromData = parseCollectionEntries(root.data);
  if (fromData.length > 0) return createCollectionIndex(fromData, 'moxfield');

  const fromOwned = parseOwnedCards(root.ownedCards);
  return createCollectionIndex(fromOwned, 'moxfield');
}

/**
 * Fallback for users whose Moxfield session cannot be read automatically.
 * Accepts the normal Moxfield collection CSV columns:
 * Name, Set, Collector Number, Foil, Quantity, Condition, Language.
 */
export function parseMoxfieldCollectionCsv(csv: string): CollectionIndex {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    throw new Error('Collection CSV needs a header and at least one card');
  }

  const header = rows[0]!.map((cell) => normalizeHeader(cell));
  const index = (names: string[]): number =>
    header.findIndex((cell) => names.includes(cell));

  const nameIndex = index(['name', 'card name']);
  const setIndex = index(['set', 'edition', 'set code']);
  const collectorIndex = index([
    'collector number',
    'collector no',
    'collector number (cn)',
    'number',
    'cn',
  ]);
  const quantityIndex = index(['quantity', 'qty', 'count']);
  const foilIndex = index(['foil', 'finish', 'is foil']);
  const languageIndex = index(['language', 'lang']);

  if (nameIndex < 0) throw new Error('Collection CSV is missing a Name column');

  const entries: CollectionEntry[] = [];
  for (const row of rows.slice(1)) {
    const name = clean(row[nameIndex]);
    if (!name) continue;
    const rawQuantity = clean(row[quantityIndex]);
    if (rawQuantity === '0') continue;
    const quantity = positiveInt(rawQuantity) ?? 1;
    const set = clean(row[setIndex]).toLowerCase();
    const collectorNumber = clean(row[collectorIndex]);
    const finish = parseCsvFinish(row[foilIndex]);
    const language = clean(row[languageIndex]).toLowerCase();

    // The deck is English-only. A non-English collection copy still proves the
    // card is owned, so keep it; the want is about the card, not the language.
    if (language && language !== 'en' && language !== 'english') {
      // keep it: ownership is by card, not language
    }

    entries.push({
      uniqueCardId: '',
      cardId: '',
      quantity,
      name,
      ...(set ? { set } : {}),
      ...(collectorNumber ? { collectorNumber } : {}),
      ...(finish ? { finish } : {}),
    });
  }

  return createCollectionIndex(entries, 'csv');
}

export function createCollectionIndex(
  entries: readonly CollectionEntry[],
  source: 'moxfield' | 'csv',
): CollectionIndex {
  const byUniqueCardId = new Map<string, number>();
  const byCardId = new Map<string, number>();
  const bySetCn = new Map<string, number>();
  const byName = new Map<string, number>();
  const byProductId = new Map<number, number>();
  const merged: CollectionEntry[] = [];

  for (const entry of entries) {
    const quantity = positiveInt(entry.quantity);
    if (quantity == null) continue;

    const uniqueCardId = entry.uniqueCardId.trim();
    const cardId = entry.cardId.trim();
    const setName = entry.set?.trim().toLowerCase() ?? '';
    const collectorNumber = entry.collectorNumber?.trim() ?? '';
    const name = normalizeName(entry.name ?? '');
    const productId = entry.productId;

    if (uniqueCardId) add(byUniqueCardId, uniqueCardId, quantity);
    if (cardId) add(byCardId, cardId, quantity);
    if (setName && collectorNumber) {
      add(bySetCn, `${setName}|${collectorNumber}`, quantity);
    }
    if (name) add(byName, name, quantity);
    if (productId != null) add(byProductId, productId, quantity);

    merged.push({
      ...entry,
      uniqueCardId,
      cardId,
      quantity,
      ...(entry.name ? { name: entry.name.trim() } : {}),
      ...(setName ? { set: setName } : {}),
      ...(collectorNumber ? { collectorNumber } : {}),
    });
  }

  return {
    entries: merged,
    byUniqueCardId,
    byCardId,
    bySetCn,
    byName,
    byProductId,
    source,
    totalOwned: merged.reduce((sum, entry) => sum + entry.quantity, 0),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Build the collection-search URL used by Moxfield's deck collection tracker.
 * The internal deck id is preferred; callers can retry with the public id.
 */
export function buildMoxfieldCollectionUrl(deckId: string): string {
  const url = new URL('https://api2.moxfield.com/v1/collections/search');
  url.searchParams.set('deckId', deckId);
  url.searchParams.set('game', 'paper');
  url.searchParams.set('pageNumber', '1');
  url.searchParams.set('pageSize', '500');
  url.searchParams.set('sortType', 'cardName');
  url.searchParams.set('sortDirection', 'ascending');
  return url.toString();
}

export function collectionLookupKeys(
  uniqueCardId: string | undefined,
  cardId: string | undefined,
  set: string,
  collectorNumber: string,
  name: string,
  productId: number | null,
): {
  uniqueCardId?: string;
  cardId?: string;
  setCn?: string;
  name?: string;
  productId?: number;
} {
  return {
    ...(uniqueCardId ? { uniqueCardId } : {}),
    ...(cardId ? { cardId } : {}),
    ...(set && collectorNumber
      ? { setCn: `${set.toLowerCase()}|${collectorNumber}` }
      : {}),
    ...(name ? { name: normalizeName(name) } : {}),
    ...(productId != null ? { productId } : {}),
  };
}

function parseCollectionEntries(raw: unknown): CollectionEntry[] {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.values(raw)
      : [];
  const entries: CollectionEntry[] = [];

  for (const value of values) {
    const item = asRecord(value);
    if (!item) continue;
    const card = asRecord(item.card) ?? item;

    const cardId = stringValue(
      card.id,
      card.cardId,
      item.cardId,
      item.card_id,
    );
    const uniqueCardId = stringValue(
      card.uniqueCardId,
      card.unique_card_id,
      item.uniqueCardId,
      item.unique_card_id,
      cardId,
    );
    const quantity = positiveInt(
      item.quantity ?? item.qty ?? card.quantity ?? 1,
    );
    if (!cardId && !uniqueCardId) continue;
    if (quantity == null) continue;

    const name = stringValue(card.name, item.name);
    const set = stringValue(card.set, item.set);
    const collectorNumber = stringValue(
      card.cn,
      card.collector_number,
      item.cn,
      item.collector_number,
    );
    const finish = parseFinish(
      item.finish ?? card.finish,
      item.isFoil ?? card.foil,
    );
    const productId =
      extractProductId(card.cardMarketUrl) ??
      positiveInt(card.cardmarket_id) ??
      positiveInt(item.productId) ??
      undefined;

    entries.push({
      uniqueCardId: uniqueCardId ?? cardId ?? '',
      cardId: cardId ?? uniqueCardId ?? '',
      quantity,
      ...(name ? { name } : {}),
      ...(set ? { set } : {}),
      ...(collectorNumber ? { collectorNumber } : {}),
      ...(finish ? { finish } : {}),
      ...(productId != null ? { productId } : {}),
    });
  }

  return entries;
}

function parseOwnedCards(raw: unknown): CollectionEntry[] {
  const map = asRecord(raw);
  if (!map) return [];
  const entries: CollectionEntry[] = [];

  for (const [uniqueCardId, value] of Object.entries(map)) {
    const cardIds = Array.isArray(value) ? value : [value];
    for (const cardIdRaw of cardIds) {
      const cardId = stringValue(cardIdRaw);
      if (!cardId) continue;
      entries.push({
        uniqueCardId,
        cardId,
        quantity: 1,
      });
    }
  }

  return entries;
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i]!;
    if (quoted) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && csv[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }

  return rows;
}

function parseCsvFinish(raw: string | undefined): Finish | undefined {
  const value = clean(raw).toLowerCase();
  if (!value) return undefined;
  if (value === 'foil' || value === 'true' || value === 'yes' || value === '1') {
    return 'foil';
  }
  if (
    value === 'nonfoil' ||
    value === 'non-foil' ||
    value === 'false' ||
    value === 'no' ||
    value === '0'
  ) {
    return 'nonfoil';
  }
  if (value === 'etched') return 'etched';
  return undefined;
}

function parseFinish(raw: unknown, foil: unknown): Finish | undefined {
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (value === 'foil') return 'foil';
    if (value === 'etched') return 'etched';
    if (value === 'nonfoil' || value === 'non-foil') return 'nonfoil';
  }
  if (foil === true) return 'foil';
  if (foil === false) return 'nonfoil';
  return undefined;
}

function extractProductId(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const url = new URL(raw);
    const id = url.searchParams.get('idProduct');
    return id && /^\d+$/.test(id) ? Number(id) : undefined;
  } catch {
    return undefined;
  }
}

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function clean(raw: string | undefined): string {
  return (raw ?? '').trim();
}

function add<K>(map: Map<K, number>, key: K, quantity: number): void {
  map.set(key, (map.get(key) ?? 0) + quantity);
}

function positiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
