import type { ScriptPublicPath } from 'wxt/utils/inject-script';
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
const CARDMARKET_MIN_INTERVAL_MS = 3_500;
const CARDMARKET_PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const CARDMARKET_DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const CARDMARKET_MAX_ATTEMPTS = 4;
const MOXFIELD_DECK_PATTERN = /^https:\/\/(?:www\.)?moxfield\.com\/decks\/([A-Za-z0-9_-]{22})/;

interface ShippingCacheEntry {
  methods: ShippingMethod[];
  fetchedAt: number;
}

type ShippingCache = Record<string, ShippingCacheEntry>;

const shippingMemory = new Map<string, ShippingMethod[]>();
const cardmarketPageCache = new Map<
  string,
  { page: FetchWantResponse; fetchedAt: number }
>();
let cardmarketNextRequestAt = 0;
let cardmarketQueue: Promise<void> = Promise.resolve();

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

  const cached = cardmarketPageCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CARDMARKET_PAGE_CACHE_TTL_MS) {
    return cached.page;
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

  for (let attempt = 1; attempt <= CARDMARKET_MAX_ATTEMPTS; attempt += 1) {
    const page = await withCardmarketThrottle(() =>
      sendCardmarketMessage<FetchWantResponse>(tabId, message),
    );

    if (!page) {
      return {
        ok: false,
        error:
          'Cardmarket is not responding. Reload the Cardmarket tab, complete any security check, and try again.',
      };
    }

    if (page.ok) {
      cardmarketPageCache.set(url, { page, fetchedAt: Date.now() });
      return page;
    }

    if (page.status === 429) {
      const waitMs =
        Math.max(
          page.retryAfterMs ?? CARDMARKET_DEFAULT_RATE_LIMIT_WAIT_MS,
          CARDMARKET_DEFAULT_RATE_LIMIT_WAIT_MS,
        ) +
        (attempt - 1) * 15_000;
      console.info(
        `[DeckCart] Cardmarket rate limit; waiting ${waitMs}ms before retry ${attempt}/${CARDMARKET_MAX_ATTEMPTS}`,
      );
      await sleep(waitMs);
      continue;
    }

    return page;
  }

  return {
    ok: false,
    status: 429,
    error:
      'Cardmarket kept rate-limiting DeckCart. Wait a few minutes, then run again.',
  };
}

async function withCardmarketThrottle<T>(task: () => Promise<T>): Promise<T> {
  const previous = cardmarketQueue;
  const run = previous.then(async () => {
    const waitMs = cardmarketNextRequestAt - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    try {
      return await task();
    } finally {
      cardmarketNextRequestAt = Date.now() + CARDMARKET_MIN_INTERVAL_MS;
    }
  });

  cardmarketQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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

  const result = await sendCardmarketMessage<{
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

async function sendCardmarketMessage<T>(
  tabId: number,
  message: ContentMessage,
): Promise<T | null> {
  // Existing tabs may predate the extension installation and therefore have
  // no content script. Retry first; then inject the built content script once.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return (await browser.tabs.sendMessage(tabId, message)) as T;
    } catch {
      await sleep(350 + attempt * 350);
    }
  }

  if (!(await injectCardmarketContentScript(tabId))) return null;
  await sleep(450);

  try {
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

async function injectCardmarketContentScript(tabId: number): Promise<boolean> {
  const manifest = browser.runtime.getManifest();
  const scripts = (manifest.content_scripts ?? [])
    .filter((entry) =>
      entry.matches?.some((pattern) => pattern.includes('cardmarket.com')),
    )
    .flatMap((entry) => entry.js ?? []);

  if (scripts.length === 0) return false;

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: scripts as ScriptPublicPath[],
    });
    return true;
  } catch (error) {
    console.info('[DeckCart] Cardmarket content-script injection failed', error);
    return false;
  }
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
    const userId = state?.user?.userId as string | undefined;
    let token = state?.user?.accessToken as string | undefined;

    const requestHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (userId) headers['X-Session-User'] = userId;
      return headers;
    };

    const refreshToken = async (): Promise<boolean> => {
      if (!userId) return false;
      try {
        const response = await fetch(
          'https://api2.moxfield.com/v1/account/token/refresh',
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...(userId ? { 'X-Session-User': userId } : {}),
            },
            body: JSON.stringify({ userId, isAppLogin: false }),
          },
        );
        if (!response.ok) return false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await response.json()) as any;
        if (typeof data?.access_token !== 'string' || !data.access_token) {
          return false;
        }
        token = data.access_token;
        try {
          state.user.accessToken = data.access_token;
          state.user.expiration = data.expiration;
          localStorage.setItem('state', JSON.stringify(state));
        } catch {
          // The page store may be read-only in some sessions; the in-memory
          // token above is enough for this request.
        }
        return true;
      } catch {
        return false;
      }
    };

    let refreshed = false;
    for (const id of ids) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const url = new URL('https://api2.moxfield.com/v1/collections/search');
        url.searchParams.set('deckId', id);
        url.searchParams.set('game', 'paper');
        url.searchParams.set('pageNumber', '1');
        url.searchParams.set('pageSize', '500');
        url.searchParams.set('sortType', 'cardName');
        url.searchParams.set('sortDirection', 'ascending');

        const response = await fetch(url.toString(), {
          credentials: 'include',
          headers: requestHeaders(),
        });
        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            data: await response.json(),
          };
        }
        if (response.status === 401 && !refreshed) {
          refreshed = true;
          if (await refreshToken()) continue;
          return {
            ok: false,
            status: 401,
            error:
              'Moxfield session expired. Reload Moxfield and retry, or import a collection CSV.',
          };
        }
        if (response.status === 400 || response.status === 404) break;
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


