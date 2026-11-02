import { normalizeMoxfieldDeck } from '../src/shared/moxfield';
import { parseMoxfieldCollectionResponse } from '../src/shared/moxfield-collection';
import { loadSettings } from '../src/shared/settings';
import { parseShippingMethods } from '../src/shared/shipping';
import type {
  ApplyItem,
  AppContext,
  MoxfieldTab,
  ShippingMethod,
  Want,
} from '../src/shared/types';
import type {
  ContentMessage,
  ExtensionMessage,
  FetchCollectionResponse,
  FetchDeckResponse,
  FetchShippingResponse,
  FetchWantResponse,
} from '../src/shared/messages';

const PENDING_DECK_KEY = 'deckcart.pendingDeck';
const SHIPPING_CACHE_KEY = 'deckcart.shippingCache.v1';
const CARDMARKET_HOME = 'https://www.cardmarket.com/en/Magic';
const MOXFIELD_DECK_PATTERN = /^https:\/\/(?:www\.)?moxfield\.com\/decks\/([A-Za-z0-9_-]{22})/;

interface ShippingCacheEntry {
  methods: ShippingMethod[];
  fetchedAt: number;
}

type ShippingCache = Record<string, ShippingCacheEntry>;

const shippingMemory = new Map<string, ShippingMethod[]>();

export default defineBackground(() => {
  console.info('[DeckCart] background ready');

  void configureSidePanel();

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message as ExtensionMessage, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  });
});

async function configureSidePanel(): Promise<void> {
  const sidePanel = (browser as unknown as {
    sidePanel?: {
      setPanelBehavior?: (options: {
        openPanelOnActionClick: boolean;
      }) => Promise<void>;
    };
  }).sidePanel;

  let configured = false;
  try {
    if (sidePanel?.setPanelBehavior) {
      await sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      configured = true;
    }
  } catch (error) {
    console.warn('[DeckCart] side panel behavior unavailable', error);
  }

  if (!configured) {
    browser.action.onClicked.addListener(() => {
      void browser.tabs.create({
        url: browser.runtime.getURL('/sidepanel.html'),
      });
    });
  }
}

async function handleMessage(
  message: ExtensionMessage,
  sender: { tab?: { id?: number } },
): Promise<unknown> {
  switch (message.type) {
    case 'GET_APP_CONTEXT':
      return getAppContext();
    case 'FETCH_MOXFIELD_DECK':
      return fetchMoxfieldDeck(message.publicId, message.tabId);
    case 'FETCH_MOXFIELD_COLLECTION':
      return fetchMoxfieldCollection(
        message.deckInternalId,
        message.publicId,
        message.tabId,
      );
    case 'FETCH_CARDMARKET_WANT':
      return fetchCardmarketWant(message.want, message.url);
    case 'FETCH_SHIPPING':
      return fetchShipping(message.fromCountryId, message.toCountryId);
    case 'APPLY_TO_CART':
      return applyToCart(message.items, message.dryRun === true);
    case 'START_FROM_MOXFIELD':
      return startFromMoxfield(message.publicId, sender.tab?.id);
    case 'OPEN_CARDMARKET':
      return openCardmarket(message.path);
    default:
      return { ok: false, error: 'Unknown message' };
  }
}

async function getAppContext(): Promise<AppContext> {
  const tabs = await browser.tabs.query({});
  const activeTabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  const settings = await loadSettings();
  const activeTab = activeTabs[0];

  const moxfieldTabs: MoxfieldTab[] = [];
  let cardmarketTab: AppContext['cardmarketTab'];

  for (const tab of tabs) {
    const url = tab.url ?? '';
    const moxfieldMatch = MOXFIELD_DECK_PATTERN.exec(url);
    if (moxfieldMatch?.[1] && tab.id != null) {
      moxfieldTabs.push({
        tabId: tab.id,
        publicId: moxfieldMatch[1],
        url,
        title: tab.title ?? 'Moxfield deck',
      });
    }
    if (
      !cardmarketTab &&
      tab.id != null &&
      url.startsWith('https://www.cardmarket.com/')
    ) {
      cardmarketTab = {
        tabId: tab.id,
        url,
        title: tab.title ?? 'Cardmarket',
      };
    }
  }

  const context: AppContext = {
    moxfieldTabs,
    destinationCountryId: settings.destinationCountryId,
  };
  if (activeTab?.id != null && activeTab.url) {
    context.activeTab = {
      tabId: activeTab.id,
      url: activeTab.url,
      title: activeTab.title ?? '',
    };
  }
  if (cardmarketTab) context.cardmarketTab = cardmarketTab;
  return context;
}

async function fetchMoxfieldDeck(
  publicId: string,
  tabId?: number,
): Promise<FetchDeckResponse> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(publicId)) {
    return { ok: false, error: 'Invalid Moxfield deck id' };
  }

  const apiUrl = `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(publicId)}`;

  try {
    const response = await fetch(apiUrl, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const raw = (await response.json()) as unknown;
      return { ok: true, deck: normalizeMoxfieldDeck(raw) };
    }
  } catch (error) {
    console.info('[DeckCart] direct Moxfield fetch failed', error);
  }

  const moxfieldTabId = tabId ?? (await findMoxfieldTabId(publicId));
  if (moxfieldTabId == null) {
    return {
      ok: false,
      error:
        'Moxfield did not allow the deck request. Open the deck in a tab and try again.',
    };
  }

  const result = await executeInMoxfieldTab<{
    ok: boolean;
    status?: number;
    data?: unknown;
    error?: string;
  }>(moxfieldTabId, pageFetchJson, [apiUrl]);

  if (!result?.ok || result.data == null) {
    return {
      ok: false,
      error:
        result?.error ??
        'Could not read the Moxfield deck from the open tab. Reload the deck and try again.',
    };
  }

  try {
    return { ok: true, deck: normalizeMoxfieldDeck(result.data) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchMoxfieldCollection(
  deckInternalId: string | undefined,
  publicId: string,
  tabId?: number,
): Promise<FetchCollectionResponse> {
  const moxfieldTabId = tabId ?? (await findMoxfieldTabId(publicId));
  if (moxfieldTabId == null) {
    return {
      ok: false,
      error:
        'Open the Moxfield deck in a tab. Collection ownership needs your Moxfield session.',
    };
  }

  const ids = [deckInternalId, publicId].filter(
    (value): value is string => Boolean(value),
  );
  if (ids.length === 0) {
    return { ok: false, error: 'No Moxfield deck id available' };
  }

  const result = await executeInMoxfieldTab<{
    ok: boolean;
    status?: number;
    data?: unknown;
    error?: string;
  }>(moxfieldTabId, pageFetchCollection, [ids]);

  if (!result?.ok || result.data == null) {
    return {
      ok: false,
      error:
        result?.error ??
        'Moxfield collection tracker is not available. Enable Collection Tracker on the deck, or import a collection CSV.',
    };
  }

  try {
    const index = parseMoxfieldCollectionResponse(result.data);
    return {
      ok: true,
      entries: index.entries,
      source: index.source,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchCardmarketWant(
  want: Want,
  url: string,
): Promise<FetchWantResponse> {
  if (!url.startsWith('https://www.cardmarket.com/')) {
    return { ok: false, error: 'Invalid Cardmarket URL' };
  }

  const tabId = await ensureCardmarketTab();
  if (tabId == null) {
    return { ok: false, error: 'Could not open a Cardmarket tab' };
  }

  const message: ContentMessage = {
    type: 'PAGE_PARSE_WANT',
    url,
    want,
  };

  const page = await sendToTabWithRetry<FetchWantResponse>(tabId, message);
  if (!page) {
    return {
      ok: false,
      error:
        'Cardmarket is not responding. Reload the Cardmarket tab, complete any security check, and try again.',
    };
  }
  return page;
}

async function fetchShipping(
  fromCountryId: number,
  toCountryId: number,
): Promise<FetchShippingResponse> {
  const key = `${fromCountryId}->${toCountryId}`;
  const memory = shippingMemory.get(key);
  if (memory) return { ok: true, methods: memory };

  const cached = await readShippingCache(key);
  if (cached) {
    shippingMemory.set(key, cached);
    return { ok: true, methods: cached };
  }

  const url =
    `https://help.cardmarket.com/api/shippingCosts?locale=en` +
    `&fromCountry=${fromCountryId}&toCountry=${toCountryId}`;

  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return {
        ok: false,
        error: `Cardmarket shipping lookup failed (${response.status})`,
      };
    }
    const methods = parseShippingMethods(await response.json());
    if (methods.length === 0) {
      return {
        ok: false,
        error: 'No physical shipping route is available for this country pair.',
      };
    }
    shippingMemory.set(key, methods);
    await writeShippingCache(key, methods);
    return { ok: true, methods };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function applyToCart(
  items: ApplyItem[],
  dryRun: boolean,
): Promise<unknown> {
  const cleaned = items
    .map((item) => ({
      articleId: String(item.articleId),
      quantity: Math.max(0, Math.floor(item.quantity)),
    }))
    .filter((item) => item.articleId && item.quantity > 0);

  if (cleaned.length === 0) {
    return { ok: false, added: 0, message: 'No articles to add' };
  }

  if (dryRun) {
    return {
      ok: true,
      added: cleaned.reduce((sum, item) => sum + item.quantity, 0),
      message: 'Dry run: the cart was not changed.',
    };
  }

  const tabId = await ensureCardmarketTab();
  if (tabId == null) {
    return { ok: false, added: 0, message: 'Could not open a Cardmarket tab' };
  }

  const result = await sendToTabWithRetry<{
    ok: boolean;
    added: number;
    message: string;
  }>(tabId, {
    type: 'PAGE_ADD_TO_CART',
    items: cleaned,
  } as ContentMessage);

  return (
    result ?? {
      ok: false,
      added: 0,
      message:
        'Cardmarket is not responding. Reload the tab, complete any security check, and try again.',
    }
  );
}

async function startFromMoxfield(
  publicId: string,
  tabId?: number,
): Promise<{ ok: boolean; error?: string }> {
  await browser.storage.local.set({ [PENDING_DECK_KEY]: publicId });

  const sidePanel = (browser as unknown as {
    sidePanel?: { open?: (options: { tabId?: number }) => Promise<void> };
  }).sidePanel;

  try {
    if (sidePanel?.open && tabId != null) {
      await sidePanel.open({ tabId });
      return { ok: true };
    }
  } catch (error) {
    console.info('[DeckCart] side panel open failed, using a tab', error);
  }

  await browser.tabs.create({
    url: browser.runtime.getURL('/sidepanel.html'),
  });
  return { ok: true };
}

async function openCardmarket(path?: string): Promise<{ ok: boolean }> {
  const url = path?.startsWith('https://www.cardmarket.com/')
    ? path
    : new URL(path ?? '/en/Magic', 'https://www.cardmarket.com').toString();

  const tabs = await browser.tabs.query({});
  const existing = tabs.find((tab) =>
    (tab.url ?? '').startsWith('https://www.cardmarket.com/'),
  );
  if (existing?.id != null) {
    await browser.tabs.update(existing.id, { url, active: true });
    return { ok: true };
  }

  const created = await browser.tabs.create({ url, active: true });
  return { ok: created.id != null };
}

async function ensureCardmarketTab(
  preferredUrl = CARDMARKET_HOME,
): Promise<number | null> {
  const tabs = await browser.tabs.query({});
  const existing = tabs.find((tab) =>
    (tab.url ?? '').startsWith('https://www.cardmarket.com/'),
  );
  if (existing?.id != null) return existing.id;

  const created = await browser.tabs.create({ url: preferredUrl, active: false });
  if (created.id == null) return null;

  await waitForTab(created.id);
  return created.id;
}

async function findMoxfieldTabId(publicId: string): Promise<number | undefined> {
  const tabs = await browser.tabs.query({});
  return tabs.find(
    (tab) =>
      tab.id != null &&
      new RegExp(`/decks/${publicId}(?:[/?#]|$)`).test(tab.url ?? ''),
  )?.id;
}

async function sendToTabWithRetry<T>(
  tabId: number,
  message: ContentMessage,
  attempts = 4,
): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return (await browser.tabs.sendMessage(tabId, message)) as T;
    } catch {
      await sleep(350 + attempt * 350);
    }
  }
  return null;
}

async function executeInMoxfieldTab<T>(
  tabId: number,
  // The scripting API serializes the function; typing its params as any keeps
  // specific page helpers assignable without weakening the rest of the file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  func: (...args: any[]) => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[],
): Promise<T | null> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func,
      args,
    });
    return (results[0]?.result as T | undefined) ?? null;
  } catch (error) {
    console.info('[DeckCart] executeScript failed', error);
    return null;
  }
}

async function waitForTab(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tab = await browser.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await sleep(250);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readShippingCache(key: string): Promise<ShippingMethod[] | null> {
  const stored = await browser.storage.local.get(SHIPPING_CACHE_KEY);
  const cache = stored[SHIPPING_CACHE_KEY] as ShippingCache | undefined;
  const entry = cache?.[key];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > 24 * 60 * 60 * 1000) return null;
  return entry.methods;
}

async function writeShippingCache(
  key: string,
  methods: ShippingMethod[],
): Promise<void> {
  const stored = await browser.storage.local.get(SHIPPING_CACHE_KEY);
  const cache = (stored[SHIPPING_CACHE_KEY] as ShippingCache | undefined) ?? {};
  cache[key] = { methods, fetchedAt: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > 60) {
    delete cache[keys[0]!];
  }
  await browser.storage.local.set({ [SHIPPING_CACHE_KEY]: cache });
}

/**
 * Runs in Moxfield's MAIN world. Uses the page's localStorage access token and
 * session to fetch JSON, so Cloudflare/auth behave exactly like the page.
 */
async function pageFetchJson(
  url: string,
): Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = JSON.parse(localStorage.getItem('state') ?? '{}') as any;
    const token = state?.user?.accessToken as string | undefined;
    const userId = state?.user?.userId as string | undefined;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (userId) headers['X-Session-User'] = userId;
    const response = await fetch(url, { credentials: 'include', headers });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, data: await response.json() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Runs in Moxfield's MAIN world. Tries the internal deck id first, then the
 * public id. The endpoint is the same one the deck's Collection Tracker uses.
 */
async function pageFetchCollection(
  ids: string[],
): Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = JSON.parse(localStorage.getItem('state') ?? '{}') as any;
    const token = state?.user?.accessToken as string | undefined;
    const userId = state?.user?.userId as string | undefined;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (userId) headers['X-Session-User'] = userId;

    for (const id of ids) {
      const url = new URL('https://api2.moxfield.com/v1/collections/search');
      url.searchParams.set('deckId', id);
      url.searchParams.set('game', 'paper');
      url.searchParams.set('pageNumber', '1');
      url.searchParams.set('pageSize', '500');
      url.searchParams.set('sortType', 'cardName');
      url.searchParams.set('sortDirection', 'ascending');

      const response = await fetch(url.toString(), {
        credentials: 'include',
        headers,
      });
      if (response.ok) {
        return { ok: true, status: response.status, data: await response.json() };
      }
      if (response.status !== 400 && response.status !== 404) {
        return {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}`,
        };
      }
    }
    return {
      ok: false,
      error: 'Collection Tracker returned no data for this deck.',
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}


