import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DEFAULT_SETTINGS, UNOFFICIAL_DISCLAIMER } from '@/src/shared/constants';
import { loadStoredCollection, clearStoredCollection, saveStoredCollection } from '@/src/shared/collection-storage';
import { createCollectionIndex, parseMoxfieldCollectionCsv } from '@/src/shared/moxfield-collection';
import { boardOptions, buildWants, extractMoxfieldPublicId } from '@/src/shared/moxfield';
import { loadSettings, saveSettings } from '@/src/shared/settings';
import {
  CardmarketRateLimitError,
  runWizard,
  type WizardProgress,
} from '@/src/shared/runner';
import { planToCartItems, sortPlans } from '@/src/shared/plan';
import type { FetchCollectionResponse, FetchDeckResponse, ExtensionMessage } from '@/src/shared/messages';
import type {
  AppContext,
  ApplyResult,
  CollectionIndex,
  Deck,
  OptimizationResult,
  Settings,
  Want,
} from '@/src/shared/types';
import { Header } from './components/Header';
import { DeckSource } from './components/DeckSource';
import { DeckReceipt } from './components/DeckReceipt';
import { OptionsTray, type CollectionStatus } from './components/OptionsTray';
import { SettingsPanel } from './components/SettingsPanel';
import { CollectionPanel } from './components/CollectionPanel';
import { RunPanel } from './components/RunPanel';
import { PlanComparison } from './components/PlanComparison';
import { PlanSummary } from './components/PlanSummary';
import { OrderRail } from './components/OrderRail';
import { SellerStacks } from './components/SellerStacks';
import { ApplyDialog } from './components/ApplyDialog';
import { DonePanel } from './components/DonePanel';
import { ErrorNotice, Notice } from './components/ErrorNotice';

type Phase =
  | 'boot'
  | 'empty'
  | 'loading-deck'
  | 'deck'
  | 'running'
  | 'plans'
  | 'applying'
  | 'done'
  | 'error';

const PENDING_DECK_KEY = 'deckcart.pendingDeck';

export function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [context, setContext] = useState<AppContext | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [collection, setCollection] = useState<CollectionIndex | undefined>();
  const [collectionStatus, setCollectionStatus] =
    useState<CollectionStatus>('idle');
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [focusedOrderId, setFocusedOrderId] = useState<string | null>(null);
  const [progress, setProgress] = useState<WizardProgress | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [runWants, setRunWants] = useState<Want[]>([]);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bootedRef = useRef(false);
  const loadDeckRef = useRef<(publicId: string) => Promise<void>>(
    async () => undefined,
  );

  const baseWants = useMemo(
    () => (deck ? buildWants(deck, settings, collection) : []),
    [deck, settings, collection],
  );
  const wantedCards = useMemo(
    () => baseWants.reduce((sum, want) => sum + want.quantity, 0),
    [baseWants],
  );
  const selectedPlan = useMemo(
    () =>
      result?.plans.find((plan) => plan.id === selectedPlanId) ??
      result?.plans[0] ??
      null,
    [result, selectedPlanId],
  );
  const extensionVersion = browser.runtime.getManifest().version;

  const invalidatePlans = useCallback(() => {
    setResult(null);
    setSelectedPlanId(null);
    setFocusedOrderId(null);
    setApplyResult(null);
    setApplyOpen(false);
    setPhase((current) => {
      if (current === 'running' || current === 'applying') return current;
      return deck ? 'deck' : 'empty';
    });
  }, [deck]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        void saveSettings(next);
        return next;
      });
      invalidatePlans();
    },
    [invalidatePlans],
  );

  const refreshCollection = useCallback(async (targetDeck: Deck) => {
    setCollectionStatus('loading');
    setCollectionError(null);
    const response = await sendMessage<FetchCollectionResponse>({
      type: 'FETCH_MOXFIELD_COLLECTION',
      deckInternalId: targetDeck.internalId,
      publicId: targetDeck.publicId,
    });

    if (response.ok && response.entries?.length) {
      const index = createCollectionIndex(
        response.entries,
        response.source ?? 'moxfield',
      );
      setCollection(index);
      setCollectionStatus('ready');
      await saveStoredCollection(index);
      return;
    }

    const stored = await loadStoredCollection();
    if (stored) {
      setCollection(stored);
      setCollectionStatus('ready');
      setCollectionError(
        response.error
          ? `Using the saved collection. ${response.error}`
          : 'Using the saved collection.',
      );
      return;
    }

    setCollection(undefined);
    setCollectionStatus('unavailable');
    setCollectionError(
      response.error ??
        'Moxfield collection tracker is not available. Import a collection CSV instead.',
    );
  }, []);

  const loadDeck = useCallback(
    async (publicId: string) => {
      setPhase('loading-deck');
      setError(null);
      setUrlError(null);
      setWarning(null);
      setResult(null);
      setSelectedPlanId(null);
      setApplyResult(null);

      const response = await sendMessage<FetchDeckResponse>({
        type: 'FETCH_MOXFIELD_DECK',
        publicId,
      });

      if (!response.ok || !response.deck) {
        setError(
          response.error ??
            'Could not read the deck. Open it in Moxfield and try again.',
        );
        setPhase('empty');
        return;
      }

      const nextDeck = response.deck;
      const options = boardOptions(nextDeck);
      const defaults = options
        .filter(
          (board) =>
            board.defaultIncluded ||
            (board.name === 'sideboard' && !/commander/i.test(nextDeck.format)),
        )
        .map((board) => board.name);

      const nextSettings: Settings = {
        ...settings,
        boards: defaults.length > 0 ? defaults : ['mainboard'],
      };
      setSettings(nextSettings);
      void saveSettings(nextSettings);
      setDeck(nextDeck);
      setPhase('deck');
      void refreshCollection(nextDeck);
    },
    [refreshCollection, settings],
  );

  useEffect(() => {
    loadDeckRef.current = loadDeck;
  }, [loadDeck]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    let cancelled = false;

    async function boot() {
      try {
        const [storedSettings, storedCollection, appContext, stored] =
          await Promise.all([
            loadSettings(),
            loadStoredCollection(),
            sendMessage<AppContext>({ type: 'GET_APP_CONTEXT' }),
            browser.storage.local.get(PENDING_DECK_KEY),
          ]);

        if (cancelled) return;
        setSettings(storedSettings);
        setContext(appContext);
        if (storedCollection) {
          setCollection(storedCollection);
          setCollectionStatus('ready');
        }

        const pending = stored[PENDING_DECK_KEY];
        if (typeof pending === 'string' && pending) {
          await browser.storage.local.remove(PENDING_DECK_KEY);
          await loadDeckRef.current(pending);
          return;
        }

        const activeId = appContext.activeTab
          ? extractMoxfieldPublicId(appContext.activeTab.url)
          : null;
        if (activeId) {
          await loadDeckRef.current(activeId);
          return;
        }

        setPhase('empty');
      } catch (bootError) {
        if (cancelled) return;
        setError(
          bootError instanceof Error ? bootError.message : String(bootError),
        );
        setPhase('empty');
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const listener = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      const next = changes[PENDING_DECK_KEY]?.newValue;
      if (typeof next !== 'string' || !next) return;
      void browser.storage.local.remove(PENDING_DECK_KEY);
      void loadDeckRef.current(next);
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!selectedPlan) return;
    setFocusedOrderId((current) => {
      if (current && selectedPlan.orders.some((order) => order.seller.id === current)) {
        return current;
      }
      return selectedPlan.orders[0]?.seller.id ?? null;
    });
  }, [selectedPlan]);

  async function handleUrlLoad() {
    const publicId = extractMoxfieldPublicId(urlInput.trim());
    if (!publicId) {
      setUrlError('Paste a full link like https://moxfield.com/decks/…');
      return;
    }
    setUrlInput('');
    await loadDeck(publicId);
  }

  function handleOpenMoxfield() {
    void browser.tabs.create({ url: 'https://moxfield.com' });
  }

  function handleChangeDeck() {
    abortRef.current?.abort();
    setDeck(null);
    setResult(null);
    setSelectedPlanId(null);
    setApplyResult(null);
    setProgress(null);
    setError(null);
    setWarning(null);
    setPhase('empty');
  }

  async function handleRun() {
    if (!deck || baseWants.length === 0) return;

    if (cooldownUntil > Date.now()) {
      setError(
        'Cardmarket is still rate-limiting this IP. Wait for the countdown to finish before running again.',
      );
      setPhase('error');
      return;
    }

    setCooldownUntil(0);
    const controller = new AbortController();
    abortRef.current = controller;
    setSettingsOpen(false);
    setCollectionOpen(false);
    setPhase('running');
    setError(null);
    setWarning(null);
    setResult(null);
    setApplyResult(null);
    setSelectedPlanId(null);
    setProgress({
      phase: 'offers',
      current: 0,
      total: baseWants.length,
      label: 'Starting',
    });

    try {
      const response = await runWizard({
        wants: baseWants,
        options: settings,
        onProgress: setProgress,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        setPhase('deck');
        return;
      }

      const plans = sortPlans(response.result.plans);
      setCooldownUntil(0);
      setRunWants(response.wants);
      setResult(response.result);
      setSelectedPlanId(plans[0]?.id ?? null);
      setFocusedOrderId(plans[0]?.orders[0]?.seller.id ?? null);
      setPhase('plans');

      if (response.shippingErrors.length > 0) {
        const shown = response.shippingErrors.slice(0, 2).join(' · ');
        const rest =
          response.shippingErrors.length > 2
            ? ` · +${response.shippingErrors.length - 2} more`
            : '';
        setWarning(`Some shipping routes failed: ${shown}${rest}`);
      }
    } catch (runError) {
      if (runError instanceof DOMException && runError.name === 'AbortError') {
        setPhase('deck');
      } else if (runError instanceof CardmarketRateLimitError) {
        const until =
          Date.now() + Math.max(runError.retryAfterMs ?? 0, 15 * 60 * 1000);
        setCooldownUntil(until);
        setError(runError.message);
        setPhase('error');
      } else {
        setError(runError instanceof Error ? runError.message : String(runError));
        setPhase('error');
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleRetry() {
    if (deck) void handleRun();
    else setPhase('empty');
  }

  function handleSelectPlan(planId: string) {
    setSelectedPlanId(planId);
    const plan = result?.plans.find((candidate) => candidate.id === planId);
    setFocusedOrderId(plan?.orders[0]?.seller.id ?? null);
  }

  async function handleApply(dryRun: boolean) {
    if (!selectedPlan) return;
    setApplyOpen(false);
    setPhase('applying');
    setError(null);

    const items = planToCartItems(selectedPlan);
    const response = await sendMessage<ApplyResult>({
      type: 'APPLY_TO_CART',
      items,
      dryRun,
    });

    setApplyResult(response);
    if (response.ok) {
      setPhase('done');
    } else {
      setError(response.message);
      setPhase('plans');
    }
  }

  async function handleOpenCart() {
    const response = await sendMessage<{ ok: boolean }>({
      type: 'OPEN_CARDMARKET',
      path: '/en/Magic/ShoppingCart',
    });
    if (!response.ok) {
      void browser.tabs.create({
        url: 'https://www.cardmarket.com/en/Magic/ShoppingCart',
      });
    }
  }

  async function handleCollectionImport(file: File) {
    try {
      const text = await file.text();
      const index = parseMoxfieldCollectionCsv(text);
      setCollection(index);
      setCollectionStatus('ready');
      setCollectionError(null);
      await saveStoredCollection(index);
      invalidatePlans();
    } catch (importError) {
      setCollectionError(
        importError instanceof Error ? importError.message : String(importError),
      );
    }
  }

  async function handleClearCollection() {
    await clearStoredCollection();
    setCollection(undefined);
    setCollectionStatus('idle');
    setCollectionError(null);
    updateSettings({ ignoreOwned: false });
  }

  function handleRefreshCollection() {
    if (!deck) return;
    void refreshCollection(deck);
  }

  function handleOpenSettings() {
    setSettingsOpen((current) => !current);
    setCollectionOpen(false);
  }

  function handleOpenCollection() {
    setCollectionOpen((current) => !current);
    setSettingsOpen(false);
  }

  function handleRunAgain() {
    setApplyResult(null);
    setResult(null);
    setRunWants([]);
    setSelectedPlanId(null);
    setFocusedOrderId(null);
    setError(null);
    setWarning(null);
    setPhase('deck');
  }

  async function handleCopyDiagnostics() {
    const tabs = await browser.tabs.query({});
    const diagnostics = {
      version: extensionVersion,
      userAgent: navigator.userAgent,
      cardmarketTabs: tabs
        .filter((tab) => (tab.url ?? '').includes('cardmarket.com'))
        .map((tab) => ({
          url: tab.url,
          title: tab.title,
          active: tab.active,
          status: tab.status,
        })),
      settings,
      deck: deck
        ? {
            name: deck.name,
            publicId: deck.publicId,
            internalId: deck.internalId,
            format: deck.format,
            cards: deck.cards.length,
          }
        : null,
      collection: collection
        ? {
            source: collection.source,
            totalOwned: collection.totalOwned,
            entries: collection.entries.length,
          }
        : null,
      cardmarketTab: context?.cardmarketTab ?? null,
      activeTab: context?.activeTab ?? null,
      wants: (runWants.length > 0 ? runWants : baseWants).map((want) => ({
        name: want.name,
        quantity: want.quantity,
        finish: want.finish,
        allowAnyPrinting: want.allowAnyPrinting,
        allowAnyFinish: want.allowAnyFinish,
        ownedQuantity: want.ownedQuantity,
        missingReason: want.missingReason ?? null,
        offers: want.offers.length,
        firstOffer:
          want.offers[0] != null
            ? {
                seller: want.offers[0].seller.name,
                country: want.offers[0].seller.country,
                priceCents: want.offers[0].priceCents,
                condition: want.offers[0].condition,
                finish: want.offers[0].finish,
              }
            : null,
      })),
      plans: result?.plans.map((plan) => ({
        variant: plan.variant,
        totalCents: plan.totals.totalCents,
        orders: plan.orders.length,
        missing: plan.missing.map((line) => ({
          name: line.name,
          reason: line.reason,
          shortfall: line.shortfall,
        })),
      })),
      error,
      warning,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    window.setTimeout(() => setCopyState('idle'), 2200);
  }

  const showDeck =
    deck != null &&
    phase !== 'boot' &&
    phase !== 'empty' &&
    phase !== 'loading-deck';
  const showOptions = deck != null && (phase === 'deck' || phase === 'error' || phase === 'plans');
  const showRunPanel =
    deck != null &&
    (phase === 'deck' || phase === 'running' || phase === 'error' || phase === 'plans');

  return (
    <div className="app-shell">
      <Header
        settingsOpen={settingsOpen}
        onOpenSettings={handleOpenSettings}
      />

      <main className="app-main">
        {phase === 'boot' || phase === 'loading-deck' ? <LoadingSkeleton /> : null}

        {phase === 'empty' ? (
          <DeckSource
            context={context}
            url={urlInput}
            loading={false}
            error={urlError ?? error}
            onUrlChange={(value) => {
              setUrlInput(value);
              setUrlError(null);
            }}
            onLoadUrl={() => void handleUrlLoad()}
            onLoadDeck={(publicId) => void loadDeck(publicId)}
            onOpenMoxfield={handleOpenMoxfield}
          />
        ) : null}

        {showDeck ? <DeckReceipt deck={deck} onChangeDeck={handleChangeDeck} /> : null}

        {showOptions ? (
          <OptionsTray
            deck={deck}
            settings={settings}
            collection={collection}
            collectionStatus={collectionStatus}
            collectionError={collectionError}
            wantCount={wantedCards}
            onSettings={updateSettings}
            onOpenSettings={handleOpenSettings}
            onOpenCollection={handleOpenCollection}
          />
        ) : null}

        {showRunPanel ? (
          <RunPanel
            phase={phase}
            wantCount={wantedCards}
            progress={progress}
            error={error}
            cooldownUntil={cooldownUntil}
            onRun={() => void handleRun()}
            onStop={handleStop}
            onRetry={handleRetry}
          />
        ) : null}

        {settingsOpen && deck ? (
          <SettingsPanel
            settings={settings}
            onChange={updateSettings}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}

        {collectionOpen && deck ? (
          <CollectionPanel
            collection={collection}
            status={collectionStatus}
            error={collectionError}
            onRefresh={handleRefreshCollection}
            onImport={(file) => void handleCollectionImport(file)}
            onClear={() => void handleClearCollection()}
            onClose={() => setCollectionOpen(false)}
          />
        ) : null}

        {phase === 'plans' && result ? (
          <>
            {error ? (
              <ErrorNotice
                message={error}
                onRetry={() => {
                  setError(null);
                  void handleRun();
                }}
              />
            ) : null}
            {warning ? (
              <Notice tone="warning">{warning}</Notice>
            ) : null}
            {result.plans.every((plan) => plan.orders.length === 0) ? (
              <Notice tone="warning">
                No Cardmarket offers came back. Reload the Cardmarket tab,
                complete any security check, and run again. If you use Brave
                Shields, allow cardmarket.com for this extension.
              </Notice>
            ) : null}
            <PlanComparison
              plans={result.plans}
              selectedPlanId={selectedPlan?.id ?? null}
              onSelect={handleSelectPlan}
            />
            {selectedPlan ? (
              <>
                <PlanSummary plan={selectedPlan} onApply={() => setApplyOpen(true)} />
                <OrderRail
                  plan={selectedPlan}
                  focusedOrderId={focusedOrderId}
                  onFocus={setFocusedOrderId}
                />
                <SellerStacks plan={selectedPlan} focusedOrderId={focusedOrderId} />
              </>
            ) : (
              <Notice tone="warning">
                No feasible plan was found. Try allowing more boards or a lower
                minimum condition.
              </Notice>
            )}
          </>
        ) : null}

        {phase === 'applying' ? (
          <Notice tone="neutral">
            Adding articles to your real Cardmarket cart…
          </Notice>
        ) : null}

        {phase === 'done' && applyResult ? (
          <DonePanel
            result={applyResult}
            onOpenCart={() => void handleOpenCart()}
            onRunAgain={handleRunAgain}
          />
        ) : null}

        <footer className="app-footer">
          <span>
            {UNOFFICIAL_DISCLAIMER} · v{extensionVersion}
          </span>
          <button
            type="button"
            className="footer-link"
            onClick={() => void handleCopyDiagnostics()}
          >
            {copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Copy failed'
                : 'Copy diagnostics'}
          </button>
        </footer>
      </main>

      {selectedPlan && phase === 'plans' ? (
        <ApplyDialog
          open={applyOpen}
          plan={selectedPlan}
          onClose={() => setApplyOpen(false)}
          onApply={(dryRun) => void handleApply(dryRun)}
        />
      ) : null}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <section className="tray skeleton-tray" aria-label="Loading" aria-busy="true">
      <div className="skeleton-line skeleton-short" />
      <div className="skeleton-line skeleton-long" />
      <div className="skeleton-line skeleton-mid" />
      <div className="skeleton-block" />
    </section>
  );
}

async function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  return (await browser.runtime.sendMessage(message)) as T;
}
