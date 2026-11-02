import type { ParsedCardmarketPage } from './cardmarket';
import type {
  AppContext,
  ApplyItem,
  ApplyResult,
  CollectionEntry,
  Deck,
  ShippingMethod,
  Want,
} from './types';

export type ExtensionMessage =
  | { type: 'GET_APP_CONTEXT' }
  | { type: 'FETCH_MOXFIELD_DECK'; publicId: string; tabId?: number }
  | {
      type: 'FETCH_MOXFIELD_COLLECTION';
      deckInternalId?: string;
      publicId: string;
      tabId?: number;
    }
  | { type: 'FETCH_CARDMARKET_WANT'; want: Want; url: string }
  | { type: 'FETCH_SHIPPING'; fromCountryId: number; toCountryId: number }
  | { type: 'APPLY_TO_CART'; items: ApplyItem[]; dryRun?: boolean }
  | { type: 'START_FROM_MOXFIELD'; publicId: string }
  | { type: 'OPEN_CARDMARKET'; path?: string };

export interface FetchDeckResponse {
  ok: boolean;
  deck?: Deck;
  error?: string;
}

export interface FetchCollectionResponse {
  ok: boolean;
  entries?: CollectionEntry[];
  source?: 'moxfield' | 'csv';
  error?: string;
}

export interface FetchWantResponse {
  ok: boolean;
  page?: ParsedCardmarketPage;
  error?: string;
  status?: number;
  retryAfterMs?: number;
  rateLimited?: boolean;
}

export interface FetchShippingResponse {
  ok: boolean;
  methods?: ShippingMethod[];
  error?: string;
}

export type MessageResponse =
  | AppContext
  | FetchDeckResponse
  | FetchCollectionResponse
  | FetchWantResponse
  | FetchShippingResponse
  | ApplyResult
  | { ok: boolean; error?: string };

/** A content-script-only message; not part of the side-panel API. */
export interface PageParseWantMessage {
  type: 'PAGE_PARSE_WANT';
  url: string;
  want: Want;
}

export interface PageAddToCartMessage {
  type: 'PAGE_ADD_TO_CART';
  items: ApplyItem[];
}

export interface MoxfieldCollectionMessage {
  type: 'PAGE_FETCH_COLLECTION';
  deckInternalId?: string;
  publicId: string;
}

export interface MoxfieldDeckMessage {
  type: 'PAGE_FETCH_DECK';
  publicId: string;
}

export type ContentMessage =
  | PageParseWantMessage
  | PageAddToCartMessage
  | MoxfieldCollectionMessage
  | MoxfieldDeckMessage;

export interface WantFetchResult {
  want: Want;
  page?: ParsedCardmarketPage;
  error?: string;
}
