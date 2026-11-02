import {
  buildMetaproductUrlFromName,
  buildProductUrl,
  withOfferFilters,
} from './cardmarket';
import { DEFAULT_POLICY } from './constants';
import { countryName } from './countries';
import type {
  FetchShippingResponse,
  FetchWantResponse,
  ExtensionMessage,
} from './messages';
import { optimize } from './optimizer';
import type {
  DeckOptions,
  OptimizationResult,
  ShippingMethod,
  Want,
} from './types';

export interface WizardProgress {
  phase: 'offers' | 'shipping' | 'optimizing';
  current: number;
  total: number;
  label: string;
}

export class CardmarketRateLimitError extends Error {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'CardmarketRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export interface RunWizardOptions {
  wants: Want[];
  options: DeckOptions;
  onProgress?: (progress: WizardProgress) => void;
  signal?: AbortSignal;
}

export interface RunWizardResult {
  wants: Want[];
  result: OptimizationResult;
  shippingErrors: string[];
}

export async function runWizard(
  input: RunWizardOptions,
): Promise<RunWizardResult> {
  const { wants, options, onProgress, signal } = input;
  const updatedWants: Want[] = [];

  for (let index = 0; index < wants.length; index += 1) {
    throwIfAborted(signal);
    const want = wants[index]!;
    onProgress?.({
      phase: 'offers',
      current: index,
      total: wants.length,
      label: want.name,
    });

    updatedWants.push(await fetchWantOffers(want, options, signal));
  }

  const filteredWants = updatedWants.map((want) => ({
    ...want,
    offers: want.offers.filter(
      (offer) =>
        (options.sellerCountryIds.length === 0 ||
          options.sellerCountryIds.includes(offer.seller.countryId)) &&
        (!options.commercialOnly || offer.seller.isCommercial),
    ),
  }));

  throwIfAborted(signal);
  const shipping = new Map<string, readonly ShippingMethod[]>();
  const shippingErrors: string[] = [];
  const sellerCountries = new Set<number>();
  for (const want of filteredWants) {
    for (const offer of want.offers) {
      if (offer.seller.countryId > 0) sellerCountries.add(offer.seller.countryId);
    }
  }

  const countryIds = Array.from(sellerCountries);
  let countriesDone = 0;
  onProgress?.({
    phase: 'shipping',
    current: 0,
    total: Math.max(countryIds.length, 1),
    label: 'Loading shipping methods',
  });

  // These requests go to help.cardmarket.com, not the marketplace, and are
  // cached by country pair. Fetching a few in parallel cuts several seconds
  // off a run without touching the Cardmarket page rate limit.
  await mapWithConcurrency(countryIds, 4, async (fromCountryId) => {
    throwIfAborted(signal);
    const response = await sendMessage<FetchShippingResponse>({
      type: 'FETCH_SHIPPING',
      fromCountryId,
      toCountryId: options.destinationCountryId,
    });

    if (response.ok && response.methods) {
      shipping.set(
        `${fromCountryId}->${options.destinationCountryId}`,
        response.methods,
      );
    } else {
      shippingErrors.push(
        `${countryName(fromCountryId)}: ${response.error ?? 'no shipping route'}`,
      );
    }

    countriesDone += 1;
    onProgress?.({
      phase: 'shipping',
      current: countriesDone,
      total: countryIds.length,
      label: `Shipping from ${countryName(fromCountryId)}`,
    });
  });

  throwIfAborted(signal);
  onProgress?.({
    phase: 'optimizing',
    current: 0,
    total: 1,
    label: 'Comparing seller combinations',
  });

  await delay(20);
  const result = optimize({
    wants: filteredWants,
    buyerCountryId: options.destinationCountryId,
    shipping,
    routeEta: new Map(),
    policy: {
      ...DEFAULT_POLICY,
      alwaysTrack: options.alwaysTrack,
      allowPartial: true,
    },
    mode: options.mode,
  });

  // The optimizer only knows "no_offer". Preserve the actual fetch/parse
  // reason so the UI can say "security check", "reload the tab", etc.
  const wantsById = new Map(filteredWants.map((want) => [want.id, want]));
  for (const plan of result.plans) {
    for (const missing of plan.missing) {
      const reason = wantsById.get(missing.wantId)?.missingReason;
      if (reason) missing.reason = reason;
    }
  }

  return { wants: filteredWants, result, shippingErrors };
}

async function fetchWantOffers(
  want: Want,
  options: DeckOptions,
  signal?: AbortSignal,
): Promise<Want> {
  if (want.missingReason) return want;

  let metaproductUrl: string | undefined;
  if (options.mode === 'cheapest-playable') {
    // Cheapest-playable does not need the exact printing first. Going straight
    // to the all-printings page halves the number of Cardmarket page requests
    // and avoids exact product URLs that redirect and lose their filters.
    metaproductUrl =
      want.metaproductUrl ??
      buildMetaproductUrlFromName(want.name, options.minCondition) ??
      undefined;

    if (metaproductUrl) {
      throwIfAborted(signal);
      metaproductUrl = withOfferFilters(
        metaproductUrl,
        options.minCondition,
      );
      const metaproductResponse = await requestCardmarketPage(
        { ...want, allowAnyFinish: true, allowAnyPrinting: true },
        metaproductUrl,
      );

      if (
        metaproductResponse.ok &&
        metaproductResponse.page &&
        metaproductResponse.page.offers.length > 0
      ) {
        return {
          ...want,
          offers: metaproductResponse.page.offers,
          metaproductUrl,
        };
      }
    }
  }

  if (want.exactProductId == null) {
    return { ...want, missingReason: 'No Cardmarket product id' };
  }

  const productUrl = withOfferFilters(
    want.productUrl ?? buildProductUrl(want.exactProductId, options.minCondition),
    options.minCondition,
  );
  const productResponse = await requestCardmarketPage(want, productUrl);

  if (!productResponse.ok || !productResponse.page) {
    return {
      ...want,
      missingReason: productResponse.error ?? 'Could not read Cardmarket offers',
    };
  }

  const updated: Want = {
    ...want,
    offers: productResponse.page.offers,
  };
  if (metaproductUrl) updated.metaproductUrl = metaproductUrl;
  if (productResponse.page.offers.length === 0) {
    updated.missingReason =
      options.mode === 'cheapest-playable'
        ? `No English offers at ${options.minCondition} or better for any printing`
        : `No English offers for this exact printing (try Cheapest playable)`;
  }
  return updated;
}

async function requestCardmarketPage(
  want: Want,
  url: string,
): Promise<FetchWantResponse> {
  const response = await sendMessage<FetchWantResponse>({
    type: 'FETCH_CARDMARKET_WANT',
    want,
    url,
  });

  if (response.rateLimited || response.status === 429) {
    throw new CardmarketRateLimitError(
      response.error ??
        'Cardmarket is rate-limiting DeckCart. Wait before running again.',
      response.retryAfterMs,
    );
  }

  return response;
}

async function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  return (await browser.runtime.sendMessage(message)) as T;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Wizard cancelled', 'AbortError');
  }
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      await task(item);
    }
  });
  await Promise.all(workers);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
