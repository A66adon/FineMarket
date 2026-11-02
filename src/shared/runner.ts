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
    await delay(220);
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
  onProgress?.({
    phase: 'shipping',
    current: 0,
    total: 1,
    label: 'Loading shipping methods',
  });

  const shipping = new Map<string, readonly ShippingMethod[]>();
  const shippingErrors: string[] = [];
  const sellerCountries = new Set<number>();
  for (const want of filteredWants) {
    for (const offer of want.offers) {
      if (offer.seller.countryId > 0) sellerCountries.add(offer.seller.countryId);
    }
  }

  let countryIndex = 0;
  for (const fromCountryId of sellerCountries) {
    throwIfAborted(signal);
    countryIndex += 1;
    onProgress?.({
      phase: 'shipping',
      current: countryIndex - 1,
      total: sellerCountries.size,
      label: `Shipping from ${countryName(fromCountryId)}`,
    });

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
  }

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
  if (want.exactProductId == null) {
    return { ...want, missingReason: 'No Cardmarket product id' };
  }

  const productUrl = withOfferFilters(
    want.productUrl ?? buildProductUrl(want.exactProductId, options.minCondition),
    options.minCondition,
  );

  const productResponse = await sendMessage<FetchWantResponse>({
    type: 'FETCH_CARDMARKET_WANT',
    want,
    url: productUrl,
  });

  if (productResponse.rateLimited || productResponse.status === 429) {
    throw new CardmarketRateLimitError(
      productResponse.error ??
        'Cardmarket is rate-limiting DeckCart. Wait before running again.',
      productResponse.retryAfterMs,
    );
  }

  if (!productResponse.ok || !productResponse.page) {
    return {
      ...want,
      missingReason: productResponse.error ?? 'Could not read Cardmarket offers',
    };
  }

  let page = productResponse.page;
  let metaproductUrl = page.metaproductUrl;

  if (options.mode === 'cheapest-playable' && !metaproductUrl) {
    // Some exact product IDs redirect to a different printing, and those
    // redirects can lose the product's Show Versions link. Falling back to the
    // name-based /Cards/ URL keeps cheapest-playable from being stuck on a
    // printing that has no English offers.
    metaproductUrl = buildMetaproductUrlFromName(
      want.name,
      options.minCondition,
    ) ?? undefined;
  }

  if (options.mode === 'cheapest-playable' && metaproductUrl) {
    throwIfAborted(signal);
    const filteredMetaproductUrl = withOfferFilters(
      metaproductUrl,
      options.minCondition,
    );
    const metaproductResponse = await sendMessage<FetchWantResponse>({
      type: 'FETCH_CARDMARKET_WANT',
      want: { ...want, allowAnyFinish: true, allowAnyPrinting: true },
      url: filteredMetaproductUrl,
    });
    if (metaproductResponse.rateLimited || metaproductResponse.status === 429) {
      throw new CardmarketRateLimitError(
        metaproductResponse.error ??
          'Cardmarket is rate-limiting DeckCart. Wait before running again.',
        metaproductResponse.retryAfterMs,
      );
    }
    if (
      metaproductResponse.ok &&
      metaproductResponse.page &&
      (metaproductResponse.page.offers.length > 0 || page.offers.length === 0)
    ) {
      page = metaproductResponse.page;
      metaproductUrl = filteredMetaproductUrl;
    }
  }

  const updated: Want = {
    ...want,
    offers: page.offers,
  };
  if (metaproductUrl) updated.metaproductUrl = metaproductUrl;
  if (page.offers.length === 0) {
    updated.missingReason =
      options.mode === 'cheapest-playable'
        ? `No English offers at ${options.minCondition} or better for any printing`
        : `No English offers for this exact printing (try Cheapest playable)`;
  }
  return updated;
}

async function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  return (await browser.runtime.sendMessage(message)) as T;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Wizard cancelled', 'AbortError');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
