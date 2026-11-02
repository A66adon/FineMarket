# Testing a WXT + React Chrome MV3 extension

Research notes for DeckCart. Scope: WXT project setup, Playwright extension E2E,
content-script fixture tests, Cardmarket/Moxfield network mocking, and optional
Chrome DevTools MCP debugging. Everything here was checked against the official
docs and a small throwaway extension in this environment on 2026-11-02.

> This file is research only. It does not modify `src/`, the root
> `package.json`, or any app code.

---

## TL;DR: recommended setup

| Layer | Tool | Purpose |
| --- | --- | --- |
| Unit / parser tests | Vitest 4 + `WxtVitest()` + jsdom | Cardmarket/Moxfield HTML/JSON parsing, pure business logic, React components |
| Extension E2E | Playwright 1.64 + bundled Chromium (`channel: 'chromium'`) | Load unpacked `.output/chrome-mv3`, sidepanel, content scripts, service worker, mocked network |
| Interactive debugging | Playwright MCP (already available) | Normal page inspection |
| Extension-lifecycle debugging | Chrome DevTools MCP 1.12 + `--categoryExtensions` | `install_extension`, `reload_extension`, `trigger_extension_action`, service-worker `evaluate_script` |

Use **bundled Chromium**, not installed Chrome/Edge/Brave, for automated tests.
Chrome and Edge removed the command-line flags needed to side-load extensions;
Playwright's bundled Chromium still supports them. Brave is Chromium-based but is
not officially supported by Playwright or Chrome DevTools MCP. Treat Brave as a
manual smoke-test target.

### Versions verified on 2026-11-02

| Package | Version | Notes |
| --- | --- | --- |
| Node.js | 26.12.1 in this environment | WXT 0.21.5 requires Node >= 22 |
| `wxt` | **0.21.5** | Current stable |
| `@wxt-dev/module-react` | **1.2.2** | Current stable |
| `react` / `react-dom` | **19.3.1** | WXT React template pins ^19.2.4 |
| `typescript` | **5.9.3** | Template version; latest npm is 7.0.2 but not validated here |
| `vitest` | **4.1.12** | WXT 0.21.5 is tested against Vitest 4.1.x. Do **not** use Vitest 5 yet. |
| `jsdom` | **30.1.3** | For DOM/React tests |
| `@playwright/test` | **1.64.1** | `playwright` 1.64.1 is pulled in as its dependency |
| Playwright Chromium | **1248** / Chrome 156.0.8078.4 | Downloaded by `npx playwright install chromium` |
| `chrome-devtools-mcp` | **1.12.0** | Optional; experimental extension tools |
| `@webext-core/fake-browser` | 2.0.1 (transitive) | Import through `wxt/testing/fake-browser` |

WXT 0.21.5's Vite peer range is `^6.3.4 || ^7 || ^8`; let WXT/npm resolve Vite.
The demo build used Vite 8.3.5.

---

## 1. WXT project setup and MV3 entrypoints

### Create the project

```bash
# From an empty directory, or use a fresh project name.
npx wxt@latest init deckcart -t react --pm npm

cd deckcart
npm install
npm run dev          # Chrome dev mode, opens a browser with the extension
npm run build        # production Chrome MV3 build
```

To scaffold into the current empty directory:

```bash
npx wxt@latest init . -t react --pm npm
```

`wxt init` options (WXT 0.21.5):

```text
wxt init [directory]
  -t, --template <template>  template to use
  --pm <packageManager>      which package manager to use
  --git                      skip initializing a git repo
```

The React template already includes:

```json
{
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "compile": "tsc --noEmit",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@wxt-dev/module-react": "^1.1.5",
    "typescript": "^5.9.3",
    "web-ext": "^10.5.0",
    "wxt": "^0.21.3"
  }
}
```

### Entrypoint conventions for Chrome MV3

WXT uses file names and directory names under `entrypoints/` to decide what to
build and what to put in `manifest.json`.

| Purpose | WXT source path | Built path | Manifest result |
| --- | --- | --- | --- |
| Background service worker | `entrypoints/background.ts` or `entrypoints/background/index.ts` | `background.js` | `"background": { "service_worker": "background.js" }` |
| Content script, generic | `entrypoints/content.ts` | `content-scripts/content.js` | `content_scripts[].js` |
| Content script, named | `entrypoints/cardmarket.content.ts` or `entrypoints/cardmarket.content/index.ts` | `content-scripts/cardmarket.js` | `content_scripts[].js` |
| Side panel | `entrypoints/sidepanel/index.html` | `sidepanel.html` | `"side_panel": { "default_path": "sidepanel.html" }` |
| Side panel, one file | `entrypoints/sidepanel.html` | `sidepanel.html` | same |
| Popup | `entrypoints/popup/index.html` | `popup.html` | `action.default_popup` |
| Unlisted page | `entrypoints/debug.html` | `debug.html` | none; use `browser.runtime.getURL('/debug.html')` |

Important WXT rules:

- Entry points are zero or one directory level deep. A related file placed
  directly in `entrypoints/` is treated as another entrypoint and will usually
  break the build. Use a directory such as `entrypoints/sidepanel/index.html`
  and keep `main.tsx`/`App.tsx` beside it.
- `defineBackground()`'s `main` **cannot** be async. `defineContentScript()`'s
  `main` can be async.
- Do not put runtime code outside the `main` callback in an entrypoint. WXT
  imports entrypoint modules in Node during the build.
- Adding a sidepanel entrypoint automatically adds the `sidePanel` permission
  and the `side_panel` manifest key. You do not need to add `sidePanel`
  manually.
- If an `action.default_popup` exists, clicking the toolbar icon opens the
  popup, not the side panel. To use `openPanelOnActionClick`, remove the popup
  entrypoint (or don't create one).

### `wxt.config.ts` for this product

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'DeckCart',
    description: 'Moxfield to Cardmarket cart optimizer',
    permissions: ['storage'],
    host_permissions: [
      'https://www.cardmarket.com/*',
      'https://help.cardmarket.com/*',
      'https://moxfield.com/*',
      'https://www.moxfield.com/*',
      'https://api2.moxfield.com/*',
    ],
    action: { default_title: 'Open DeckCart' },
  },
});
```

`storage` is manual; `sidePanel` is added automatically by WXT when the
sidepanel entrypoint exists. The generated production manifest in the proof
build contained `"permissions": ["storage","sidePanel"]` and
`"side_panel": {"default_path":"sidepanel.html"}`.

### Background entrypoint

```ts
// entrypoints/background.ts
export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Keep message handling thin; put logic in testable modules.
    if (message?.type === 'ping') {
      sendResponse({ ok: true });
    }
    return false;
  });
});
```

`browser` is auto-imported by WXT. Prefer `browser` over raw `chrome` so the
same code can run under Vitest with `fakeBrowser` (see section 6).

### Content-script entrypoints

```ts
// entrypoints/cardmarket.content.ts
export default defineContentScript({
  matches: ['https://www.cardmarket.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    // Mount React UI, read offers, send messages to the background.
  },
});
```

```ts
// entrypoints/moxfield.content.ts
export default defineContentScript({
  matches: [
    'https://moxfield.com/decks/*',
    'https://www.moxfield.com/decks/*',
  ],
  runAt: 'document_idle',
  main(ctx) {
    // Read the open deck / notify the background.
  },
});
```

For multiple content scripts, the output names follow the source names:
`content-scripts/cardmarket.js`, `content-scripts/moxfield.js`. If you build a
React UI inside a content script, add `cssInjectionMode: 'ui'` and use WXT's
`createShadowRootUi` helper. Playwright locators pierce open shadow roots but
not closed ones.

### Sidepanel entrypoint

```text
entrypoints/sidepanel/
  index.html
  main.tsx
  App.tsx
  style.css
```

```html
<!-- entrypoints/sidepanel/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DeckCart</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

```tsx
// entrypoints/sidepanel/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

### Build output

```bash
npm run build
# .output/chrome-mv3/manifest.json
# .output/chrome-mv3/background.js
# .output/chrome-mv3/sidepanel.html
# .output/chrome-mv3/content-scripts/cardmarket.js
# .output/chrome-mv3/content-scripts/moxfield.js
```

Use **`.output/chrome-mv3`** for production E2E tests. WXT dev builds use a
different output folder and add development permissions/behavior; don't test
against a dev build unless you specifically need HMR.

---

## 2. Test pyramid

Use three layers:

1. **Pure parser/logic tests (Vitest, Node or jsdom).** Parse saved Cardmarket
   HTML and Moxfield JSON with functions that do not touch `chrome.*`. This is
   the fastest and most reliable layer.
2. **Component tests (Vitest + jsdom).** Render the sidepanel React app with a
   fake `browser` API. Mock messaging/storage.
3. **Extension E2E (Playwright).** Load the real production build, exercise
   sidepanel + background + content script injection + mocked network.

Don't try to test the whole extension through content-script fixtures only.
Extract parsing into pure modules first; then content scripts become a thin
DOM/messaging shell that is easier to test end to end.

---

## 3. Playwright setup for an unpacked MV3 extension

### Install

```bash
npm i -D @playwright/test@1.64.1
npx playwright install chromium
```

Do not install a mismatched `playwright`/`@playwright/test` pair. If both are
present, pin both to 1.64.1. `npx playwright install chromium` downloads the
full bundled Chromium and the headless shell; the full one is what supports
extensions.

### `playwright.config.ts`

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1, // cart/apply tests share external state; keep serial for now
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
```

Build before running E2E. Simplest package script:

```json
{
  "scripts": {
    "e2e": "wxt build && playwright test",
    "e2e:headed": "wxt build && HEADED=1 playwright test",
    "e2e:ui": "wxt build && playwright test --ui"
  }
}
```

### Extension fixture: `tests/e2e/fixtures.ts`

```ts
import {
  test as base,
  chromium,
  type BrowserContext,
  type Worker,
} from '@playwright/test';
import path from 'node:path';

const extensionPath = path.resolve(process.cwd(), '.output/chrome-mv3');

export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      // REQUIRED for extensions in headless mode. Do not use channel: 'chrome'
      // or the default headless shell. Bundled Chromium only.
      channel: 'chromium',
      headless: process.env.HEADED !== '1',
      viewport: { width: 420, height: 900 }, // sidepanel-ish viewport
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', {
        timeout: 15_000,
      });
    }
    await use(serviceWorker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    // MV3: chrome-extension://<id>/background.js
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;
```

Key points:

- **`launchPersistentContext` is mandatory.** A normal `browser.newContext()` is
  not a persistent context and cannot load an unpacked extension.
- `--disable-extensions-except` and `--load-extension` require **absolute**
  paths. A relative path can silently produce a browser with no extension.
- Use `channel: 'chromium'`, not `channel: 'chrome'`. Chrome and Edge 139+
  removed side-loading flags.
- Do not pass `--headless` manually. Playwright's `headless: true` with the
  `chromium` channel uses the new headless mode, which supports extensions.
  The default bundled **headless shell** does not.
- `userDataDir: ''` gives each context a fresh temporary profile. That avoids
  stale extension state and stale storage. If a test needs a real Cardmarket
  login, point it at a dedicated test profile instead.

### Sidepanel test

Playwright cannot click Chrome's browser-chrome toolbar or inspect the real side
panel UI. The reliable approach is to open the sidepanel HTML as a normal
extension page:

```ts
import { test, expect } from './fixtures';

test('sidepanel renders', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(page.getByRole('heading', { name: 'DeckCart' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Build cart' })).toBeEnabled();
});
```

This exercises the real extension origin (`chrome-extension://`), real
`chrome.*` APIs available to extension pages, and the real bundled React app.
It does not exercise Chrome's side-panel chrome or the toolbar action.

To test the actual action/side-panel opening, use Chrome DevTools MCP's
`trigger_extension_action` or a manual Brave/Chrome smoke test. `chrome.sidePanel.open()`
requires a user gesture, so it cannot simply be called from a test's `page.evaluate`.

### Service worker test

```ts
test('background is alive and responds', async ({ serviceWorker }) => {
  await expect
    .poll(() => serviceWorker.evaluate(() => (globalThis as any).chrome.runtime.id))
    .toBeTruthy();

  const response = await serviceWorker.evaluate(async () => {
    return (globalThis as any).chrome.runtime.sendMessage({ type: 'ping' });
  });
  expect(response).toEqual({ ok: true });
});
```

MV3 service workers are suspended after roughly 30 seconds of inactivity and
restarted on demand. Playwright 1.64 keeps the same `Worker` handle across a
restart; new `evaluate()` calls stall until the new context is ready. Avoid long
`sleep()` calls between SW operations. If an `evaluate()` was already in flight
at the exact restart moment it can throw `"Service worker restarted"`; retry or
poll.

### Extension ID

Do not hardcode it. Unpacked extension IDs are derived from the absolute path
(and manifest `key`, if present), so the ID changes across checkouts/machines.
Derive it from the service worker URL:

```ts
const extensionId = new URL(serviceWorker.url()).host;
```

If the extension has no background service worker, this fixture will time out.
DeckCart needs a background for sidepanel behavior and cart work, so keep one.
For an extension without a background, you can add a manifest `key` to make the
ID deterministic and compute it, but deriving from the SW is simpler.

`context.serviceWorkers()` may be empty until the SW starts. `waitForEvent('serviceworker')`
is the correct wait. Opening a `chrome-extension://.../sidepanel.html` page also
starts the extension if needed.

### Debugging

```bash
npx playwright test --ui
HEADED=1 npx playwright test
PWDEBUG=1 npx playwright test
npx playwright test --trace on
npx playwright show-report
npx playwright show-trace test-results/.../trace.zip
```

---

## 4. Content scripts against saved fixture pages

### Fixture files in this repo

`tests/fixtures` currently contains:

| File | Real URL to use when routing | Notes |
| --- | --- | --- |
| `cardmarket-product-command-tower.html` | `https://www.cardmarket.com/en/Magic/Products/Singles/Secret-Lair-Drop-Series/Command-Tower-V9` | **JSON-string encoded** HTML |
| `cardmarket-product-command-tower.html` | same | Raw HTML; easiest to use |
| `cardmarket-versions-command-tower.html` / `.html` | `https://www.cardmarket.com/en/Magic/Cards/Command-Tower/Versions` | Version list page |
| `cardmarket-metaproduct-command-tower.html` / `.html` | `https://www.cardmarket.com/en/Magic/Cards/Command-Tower` | Metaproduct/all-printings page |
| `moxfield-deck-command-tower.json` | `https://api2.moxfield.com/v3/decks/all/sPueARQ_KHiSbmZbhRYNnA` | Moxfield API-shaped JSON; public deck URL is `https://moxfield.com/decks/sPueARQ_KHiSbmZbhRYNnA` |

**Critical gotcha:** the `.html` files are JSON strings, not raw HTML. They begin
with a quote and contain escaped markup. The `.html` files are the raw
HTML. A helper must handle both:

```ts
// tests/fixtures/read-fixture.ts
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = path.resolve('tests/fixtures');

export function readHtmlFixture(name: string): string {
  const raw = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  return name.endsWith('.html') ? raw : JSON.parse(raw);
}

export function readJsonFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as T;
}
```

If you pass the `.html` file directly as a Playwright response body, the page
will display a quoted, escaped document and your content script will not find
the expected DOM. Use `.html`, or decode first.

There are no shipping JSON fixtures in `tests/fixtures` yet. If/when they are
added, route the public shipping API host instead: `https://help.cardmarket.com/*`.

### Unit-test the parser against HTML/JSON

Keep parsing independent of `chrome.*`:

```ts
// utils/cardmarket/parse-offers.ts (example location)
export function parseCardmarketOffers(doc: Document) {
  return [...doc.querySelectorAll('.article-row')].map((row) => ({
    seller: row.querySelector('.seller-name')?.textContent?.trim() ?? '',
    price: row.querySelector('.price-container')?.textContent?.trim() ?? '',
    // ...
  }));
}
```

```ts
// tests/unit/cardmarket-parser.test.ts
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { parseCardmarketOffers } from '@/utils/cardmarket/parse-offers';
import { readHtmlFixture } from '../fixtures/read-fixture';

describe('parseCardmarketOffers', () => {
  it('parses the saved product page', () => {
    const dom = new JSDOM(
      readHtmlFixture('cardmarket-product-command-tower.html'),
    );
    const offers = parseCardmarketOffers(dom.window.document);
    expect(offers).toHaveLength(50);
    expect(offers[0].seller).toBeTruthy();
    expect(offers[0].price).toMatch(/\d/);
  });
});
```

For Moxfield, parse the API JSON directly:

```ts
const deck = readJsonFixture<MoxfieldDeck>('moxfield-deck-command-tower.json');
expect(deck.boards.mainboard).toBeDefined();
```

This layer catches selector/structure regressions without a browser or network.

### E2E-test the real content script on the fixture URL

The page must be served at the **real origin and path** so the manifest's
`matches` and host permissions apply. Do not use `file://`, `page.setContent()`,
or `http://localhost`; the content script will not inject.

```ts
import { test, expect } from './fixtures';
import { readHtmlFixture } from '../fixtures/read-fixture';

const PRODUCT_URL =
  'https://www.cardmarket.com/en/Magic/Products/Singles/Secret-Lair-Drop-Series/Command-Tower-V9';

test('Cardmarket content script mounts on a saved page', async ({ context }) => {
  const page = await context.newPage();

  // Register the route BEFORE goto.
  await page.route('**/*', async (route) => {
    const url = route.request().url();

    if (url === PRODUCT_URL) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: readHtmlFixture('cardmarket-product-command-tower.html'),
      });
      return;
    }

    // Avoid real Cardmarket/CDN/analytics traffic. Don't let a fixture test
    // hit Cloudflare or the network.
    await route.abort();
  });

  await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded' });

  // document_idle injection may happen just after goto; web-first assertions
  // retry automatically.
  await expect(page.locator('[data-deckcart-root]')).toBeVisible();
  await expect(page.getByRole('button', { name: /add .* to cart/i })).toBeVisible();
});
```

Notes:

- `page.route` is registered before `page.goto`. Routes do not apply to
  in-flight requests.
- Aborting unmatched requests is intentional: fixtures reference Google Tag
  Manager, images, fonts, etc. Real requests make tests flaky and can trigger
  rate limits/Cloudflare.
- If the content script uses a shadow root, assert the host element first. For
  an **open** shadow root, Playwright locators pierce it. For a **closed**
  shadow root, use `locator.evaluate()` on the host or expose a testable DOM
  marker.
- Content scripts run in an isolated world. `page.evaluate()` cannot see their
  JS variables, and `context.addInitScript()` does not run in their world (see
  section 6). Assert DOM effects or real `chrome.runtime` messaging.
- The saved HTML is a snapshot. Re-save fixtures when Cardmarket's markup
  changes; treat fixture failures as a signal to inspect the live page, not to
  loosen selectors blindly.

### Moxfield content-script / API fixtures

If the content script reads the open Moxfield tab, you need a saved **page HTML**
fixture for `https://moxfield.com/decks/<publicId>`. The current fixture is the
API JSON, which is perfect for a background fetch or a pure parser but is not a
page. For API-driven code, route the API instead:

```ts
const DECK_API =
  'https://api2.moxfield.com/v3/decks/all/sPueARQ_KHiSbmZbhRYNnA';

await context.route(DECK_API, async (route) => {
  await route.fulfill({ json: readJsonFixture('moxfield-deck-command-tower.json') });
});
```

Do not assume the API is stable or public; Moxfield's endpoints are
undocumented and can change or be protected by Cloudflare. Keep the fixture
shape in a typed adapter and test the adapter, not the live API.

---

## 5. Mocking Cardmarket/Moxfield network requests

### `context.route` vs `page.route`

| API | Sees page requests | Sees extension service-worker `fetch` | Use for |
| --- | --- | --- | --- |
| `page.route()` | Yes, for that page only | **No** | Fixture document for a content-script page |
| `context.route()` | Yes, all pages | **Yes**, in Playwright 1.64 | Background/API/cart calls, shipping API, Moxfield API |

In this environment, Playwright 1.64.1 + Chromium 1248 was verified to intercept
a `fetch()` from an MV3 extension service worker via `context.route`, and
`route.request().serviceWorker()` was non-null inside the handler:

```ts
let hit = false;
await context.route('https://api2.moxfield.com/**', async (route) => {
  hit = true;
  console.log('from service worker:', Boolean(route.request().serviceWorker()));
  await route.fulfill({
    json: { name: 'Mock Deck', boards: { mainboard: {} } },
  });
});

const result = await serviceWorker.evaluate(async () => {
  const res = await fetch(
    'https://api2.moxfield.com/v3/decks/all/sPueARQ_KHiSbmZbhRYNnA',
  );
  return { status: res.status, body: await res.text() };
});

expect(hit).toBe(true);
expect(result.status).toBe(200);
```

Older Playwright versions may not expose service-worker traffic without an
experimental flag. If `context.route` never fires for background `fetch`, first
upgrade Playwright; do not work around it by moving all network calls into the
sidepanel just for testability.

Also: do **not** set `serviceWorkers: 'block'` in the context options if you need
to observe or mock extension service-worker requests. Playwright's SW request
events require service workers to be allowed.

### A practical routing layout

Use scoped routes, not one global catch-all, so extension pages and assets keep
working:

```ts
// Background/API calls: context-level so the service worker is covered.
await context.route('https://api2.moxfield.com/**', async (route) => {
  await route.fulfill({ json: moxfieldDeckFixture });
});

await context.route('https://help.cardmarket.com/**', async (route) => {
  await route.fulfill({ json: shippingFixture });
});

// Cart-apply endpoint: intercept and record, never hit the real endpoint.
let cartBodies: string[] = [];
await context.route(
  '**/ShoppingCart_Add_AddArticlesFromProductPage*',
  async (route) => {
    cartBodies.push(route.request().postData() ?? '');
    await route.fulfill({ json: { success: true } });
  },
);
```

### Cardmarket page fixtures at the real URL

For a content-script page, `page.route` is appropriate:

```ts
await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url === PRODUCT_URL) {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: readHtmlFixture('cardmarket-product-command-tower.html'),
    });
    return;
  }
  if (url.startsWith('chrome-extension://')) {
    return route.continue();
  }
  await route.abort();
});
await page.goto(PRODUCT_URL);
```

If the content script itself calls Cardmarket APIs, those may be page/frame
requests and are covered by `page.route`; background calls need `context.route`.
When in doubt, use `context.route` for the API host and `page.route` for the
document.

### Failure-mode fixtures

Test the behaviors the product promises to surface, not just happy paths:

```ts
// Cloudflare/challenge or blocked page
await context.route('https://www.cardmarket.com/**', (route) =>
  route.fulfill({
    status: 403,
    contentType: 'text/html',
    body: '<html><body>Just a moment...</body></html>',
  }),
);

// Rate limit
await context.route('https://www.cardmarket.com/**', (route) =>
  route.fulfill({
    status: 429,
    headers: { 'retry-after': '60' },
    body: 'Too many requests',
  }),
);

// Stock/offer changes: first request sees price A, second sees price B
let calls = 0;
await context.route(/cardmarket\.com\/.*/, async (route) => {
  const body = calls++ === 0 ? offerPageA : offerPageB;
  await route.fulfill({ status: 200, contentType: 'text/html', body });
});
```

For cart apply, assert the exact payload and then assert the UI's verification
step. Never let an automated test hit the real add-articles endpoint or checkout.
If the endpoint expects form-encoded data, inspect `route.request().postData()`
and parse it rather than assuming JSON.

### Logging and assertions

- Use `page.on('requestfailed')` / `context.on('requestfailed')` during fixture
  tests to catch accidental real traffic.
- Route handlers fire before the request goes out; `route.continue()` is the only
  handler that should hit the network.
- `route.fulfill({ json })` sets `application/json` automatically.
- `route.fulfill({ path })` reads a raw file; it cannot decode the JSON-string
  fixtures. Use `body: readHtmlFixture(...)`.
- `waitForResponse` is useful for asserting a request happened, but don't depend
  on network idle for React SPAs.

---

## 6. Mocking Chrome APIs

### Unit/component tests: WXT + fake browser

`WxtVitest()` gives you an in-memory `browser` implementation
(`@webext-core/fake-browser`), WXT aliases, auto-imports, and
`import.meta.env.BROWSER` / `MANIFEST_VERSION` globals.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.ts'],
    restoreMocks: true,
  },
});
```

```ts
// tests/unit/setup.ts
import { beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

beforeEach(() => {
  fakeBrowser.reset();
});
```

```ts
// tests/unit/messaging.test.ts
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { requestCartPlan } from '@/utils/messaging';

describe('requestCartPlan', () => {
  it('returns the background response', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({
      planId: 'plan-1',
    });

    await expect(requestCartPlan()).resolves.toEqual({ planId: 'plan-1' });
  });
});
```

This was verified in a throwaway project: `fakeBrowser.runtime.id` exists,
`fakeBrowser.storage.local` stores values in memory, and
`vi.spyOn(fakeBrowser.runtime, 'sendMessage')` works with Vitest 4.1.12.

Important details:

- Import `fakeBrowser` from `wxt/testing/fake-browser`, not directly from
  `@webext-core/fake-browser`.
- Use `browser` in app code, not raw `chrome`, so the fake browser can
  polyfill it. If app code imports `chrome.*` directly, Node/Vitest will throw
  `chrome is not defined`.
- WXT `#imports` are rewritten before Vitest sees them. To mock a WXT utility,
  mock its real path, e.g. `vi.mock('wxt/utils/inject-script', ...)`, not
  `vi.mock('#imports', ...)`. Check `.wxt/types/imports-module.d.ts` after
  `npx wxt prepare` for the mapping.
- `fakeBrowser` implements many but not necessarily every Chrome API. For
  `browser.sidePanel`, define a small stub in the test if the fake doesn't
  expose it:
  ```ts
  Object.defineProperty(fakeBrowser, 'sidePanel', {
    configurable: true,
    value: { open: vi.fn().mockResolvedValue(undefined) },
  });
  ```
- React StrictMode in the template runs effects twice in development. Make
  effects idempotent or assert on eventual state, not call counts.

### E2E: real Chrome APIs, selective stubs on extension pages

In Playwright, extension pages already have real `chrome.*`. Prefer testing the
real API. Stub only for error paths or unavailable browser UI.

`context.addInitScript()` runs in the **main world** of every new page,
including `chrome-extension://` pages. This was verified: a stub of
`chrome.runtime.sendMessage` was observed by the sidepanel page.

```ts
await context.addInitScript(() => {
  if (location.protocol !== 'chrome-extension:') return;

  // This is a page main-world stub; it does not affect content script worlds.
  chrome.runtime.sendMessage = async () => ({ mocked: true });
});
```

But there are hard limits:

- `context.addInitScript()` does **not** reach content-script isolated worlds.
  A content script that calls `chrome.runtime.sendMessage` will still use the
  real extension API. This was verified: a main-world flag set by
  `addInitScript` was `undefined` when read from a content script.
- `page.evaluate()` also runs in the page main world, not the content-script
  world. You cannot inspect content-script variables from it.
- For content scripts, test the real messaging path: load the real background,
  route background network calls to fixtures, and assert the DOM/UI result. If
  you need deterministic error responses, add a test-only background message
  handler behind an explicit build mode/environment flag — and keep it out of
  production builds. Do not try to monkey-patch the isolated world from a
  Playwright test; it is brittle and version-dependent.
- Stub at the narrowest scope. A global `addInitScript` that replaces
  `chrome.runtime` can break the sidepanel's real behavior and hide integration
  bugs.

If you need to assert messaging, expose a test-visible marker in the DOM (e.g.
`data-state="error"`), or use `expect.poll` on the React UI. Prefer assertions
on user-visible behavior over inspecting internal content-script globals.

---

## 7. Optional: Chrome DevTools MCP with `--categoryExtensions`

Playwright is the CI/test tool. Chrome DevTools MCP is useful for interactive
debugging of a real Chrome session: install/reload the unpacked extension, open
its action/sidepanel, inspect console/network, and evaluate code in the
background service worker. The extension tools are experimental and disabled by
default.

### Start the server

```bash
npx -y chrome-devtools-mcp@1.12.0 --categoryExtensions
```

Useful variants:

```bash
# Fresh profile, discarded afterwards
npx -y chrome-devtools-mcp@1.12.0 --categoryExtensions --isolated

# Headless (use headed for sidepanel/UI debugging)
npx -y chrome-devtools-mcp@1.12.0 --categoryExtensions --headless

# Allow install_extension to read the built extension outside the default temp root
npx -y chrome-devtools-mcp@1.12.0 \
  --categoryExtensions \
  --filesystemRoot=/home/davids/BetterMarket
```

Generic MCP client config:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@1.12.0",
        "--categoryExtensions",
        "--filesystemRoot=/home/davids/BetterMarket"
      ]
    }
  }
}
```

OpenCode v2 uses a `mcp.servers` object rather than the `mcpServers` shape
above. The equivalent entry is:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "chrome-devtools": {
        "type": "local",
        "command": [
          "npx",
          "-y",
          "chrome-devtools-mcp@1.12.0",
          "--categoryExtensions",
          "--filesystemRoot=/home/davids/BetterMarket"
        ]
      }
    }
  }
}
```

Restart the MCP server/client after changing `--categoryExtensions`; that flag
is read at startup.

### Tools available with the flag

| Tool | Parameters | Use |
| --- | --- | --- |
| `install_extension` | `path` (absolute unpacked extension folder) | Load `.output/chrome-mv3` |
| `list_extensions` | none | Verify name, ID, version, enabled state |
| `reload_extension` | `id` | Apply a rebuild without manually clicking reload |
| `trigger_extension_action` | `id` | Click the extension action; opens popup/sidepanel |
| `uninstall_extension` | `id` | Clean up |
| `list_pages` | none | Includes extension service workers as `sw-N` |
| `evaluate_script` | `pageId` or `serviceWorkerId`, `function` | Evaluate in a page or background SW |

Workflow:

1. Build: `npm run build`.
2. `install_extension({ path: "/home/davids/BetterMarket/.output/chrome-mv3" })`.
3. `list_extensions()` to get the ID and confirm it loaded.
4. `list_pages()` to get page IDs and the service worker ID (`sw-1`, ...).
5. `trigger_extension_action({ id })` to open the action/sidepanel.
6. Inspect:
   ```json
   {
     "pageId": 1,
     "function": "() => document.title"
   }
   ```
   or in the background:
   ```json
   {
     "serviceWorkerId": "sw-1",
     "function": "async () => ({ id: chrome.runtime.id, tabs: (await chrome.tabs.query({})).length })"
   }
   ```
7. After a rebuild, `reload_extension({ id })`; no need to reinstall.
8. `uninstall_extension({ id })` when done.

Caveats:

- `install_extension` requires an **absolute** path. If the path is outside the
  MCP server's workspace roots, it fails with `Access denied`; add
  `--filesystemRoot` / `--workspace`.
- `evaluate_script` returns JSON-serializable values only. `args` are element
  UIDs from a page snapshot, not arbitrary JS values. Omit `pageId` when using
  `serviceWorkerId`.
- The MCP server officially supports Google Chrome and Chrome for Testing. Brave
  is not officially supported; it may work but is not a reliable test target.
- MCP drives a real browser profile and exposes page content to the client. Use
  `--isolated` for exploration, or a dedicated profile when you need a real
  Cardmarket session. Never point it at a personal profile with credentials.
- Playwright MCP (already available in this environment) is fine for ordinary
  page automation, but it does not provide extension lifecycle tools like
  install/reload/trigger-action. Use Chrome DevTools MCP only when you need
  those.

---

## 8. Pitfalls checklist

### Headless / browser

- [ ] **Default headless shell does not load extensions.** In a proof run,
  `chromium.launchPersistentContext` without `channel: 'chromium'` timed out
  waiting for `serviceworker`. With `channel: 'chromium'` + `headless: true`, it
  worked. Always pass the channel.
- [ ] Do not use `channel: 'chrome'` or `channel: 'msedge'` for side-loading.
  Chrome/Edge removed the required flags. Use bundled Chromium.
- [ ] Extensions require a persistent context. `browser.newContext()` is not
  enough.
- [ ] Pass absolute paths to `--disable-extensions-except` and
  `--load-extension`.
- [ ] Run `npx playwright install chromium` after upgrading Playwright; the
  browser revision must match (1.64.1 expected Chromium 1248 here).
- [ ] On older Playwright/Linux CI without new headless support, use
  `xvfb-run` with `headless: false` rather than fighting the flags.

### Extension ID and service worker

- [ ] Never hardcode the extension ID. Derive it from
  `serviceWorker.url()` / `new URL(...).host`.
- [ ] Unpacked IDs depend on the absolute path and optional manifest `key`; a
  different checkout path produces a different ID.
- [ ] If `context.serviceWorkers()` is empty, wait for the `serviceworker`
  event. If it never fires, check that a background entrypoint exists and that
  the extension loaded at all.
- [ ] MV3 service workers suspend after ~30s. Avoid sleeps and long gaps; use
  `expect.poll` and re-trigger with a message.
- [ ] A SW restart can throw `"Service worker restarted"` for an in-flight
  `evaluate()`. Retry that assertion.
- [ ] `serviceWorker.evaluate()` has no DOM. Use an extension page for DOM
  assertions.

### Side panel

- [ ] Playwright cannot inspect Chrome's real side-panel UI. Test
  `chrome-extension://<id>/sidepanel.html` directly.
- [ ] If the manifest has `action.default_popup`, the toolbar icon opens the
  popup, not the side panel. Remove the popup entrypoint for
  `openPanelOnActionClick`.
- [ ] `chrome.sidePanel.open()` requires a user gesture. Use Chrome DevTools MCP
  `trigger_extension_action` or a manual smoke test for the real opening
  behavior.
- [ ] WXT auto-adds `sidePanel`; do not duplicate it manually. The built
  manifest should have `side_panel.default_path`.
- [ ] Direct navigation works because it is an extension page; it does not
  prove the action wiring. Test background `setPanelBehavior` separately
  (or via MCP/manual).

### Content scripts and fixtures

- [ ] Serve fixtures at the **real URL** (`https://www.cardmarket.com/...`),
  not `file://` or `localhost`, or `matches`/host permissions will not apply.
- [ ] Register `page.route` before `page.goto`; routes only affect future
  requests.
- [ ] `.html` fixtures are JSON-encoded; use `.html` or `JSON.parse`.
- [ ] Abort unmatched fixture requests to avoid real CDN/analytics/Cloudflare
  traffic.
- [ ] `document_idle` injection happens after `goto`; use web-first assertions,
  not immediate `evaluate`.
- [ ] Content scripts run in an isolated world. `page.evaluate` cannot see their
  variables and `addInitScript` cannot patch their `chrome.*`.
- [ ] If the content script uses a closed shadow root, Playwright locators cannot
  pierce it; assert the host or expose a DOM marker.
- [ ] WXT entrypoints must not have runtime code outside `main`; the build
  imports them in Node.
- [ ] Snapshots go stale. Re-capture fixtures when live markup changes, and
  don't "fix" tests by weakening selectors without checking the real page.

### Network and dangerous actions

- [ ] Use `context.route` for background/service-worker `fetch`; `page.route`
  does not see it. This was verified in Playwright 1.64.1.
- [ ] Do not set `serviceWorkers: 'block'` if you need SW request mocking.
- [ ] Never hit real Cardmarket/Moxfield in automated tests: rate limits,
  Cloudflare, login state, and undocumented APIs make tests flaky.
- [ ] Never hit the real cart-apply endpoint in tests. Intercept
  `ShoppingCart_Add_AddArticlesFromProductPage`, record the payload, and return
  a fixture. No checkout/payment automation.
- [ ] Cardmarket/Moxfield can return 403/429/503 or a challenge page. Add
  fixtures for those failure modes and assert the UI surfaces them.
- [ ] The Moxfield API is undocumented; keep its response shape behind an
  adapter and test the adapter with the saved JSON fixture.
- [ ] If shipping fixtures are added, route `https://help.cardmarket.com/*`,
  not the Cardmarket product host.

### Brave

- [ ] Playwright officially supports its bundled Chromium, not Brave. Brave may
  accept `executablePath` + extension flags, but don't make CI depend on it.
- [ ] Chrome DevTools MCP officially supports Chrome/Chrome for Testing, not
  Brave.
- [ ] Manual Brave smoke test: `brave://extensions` → enable Developer mode →
  Load unpacked → select `.output/chrome-mv3`; reload after each build.
- [ ] Brave profile and extension ID differ from Chromium; don't reuse a
  hardcoded ID or a Chromium test profile.
- [ ] Test with Brave Shields on and off. Shields can block third-party
  scripts/resources that Cardmarket/Moxfield rely on.
- [ ] Verify the actual side panel UI, real Cardmarket login, and the apply
  dry-run manually in Brave; keep automated tests in Chromium.

### General

- [ ] Use the production build for E2E: `.output/chrome-mv3`, not the dev
  output. Dev mode adds HMR permissions/behavior.
- [ ] Use `workers: 1` initially. Cart state and rate limits are shared external
  state; parallel tests can interfere even with separate profiles.
- [ ] Fresh `userDataDir` per run avoids storage/extension state leakage.
- [ ] React StrictMode double-invokes effects in dev; tests should be
  idempotent.
- [ ] Don't commit real credentials, cookies, or Cardmarket session data.

---

## 9. Exact command reference

### Project and build

```bash
npx wxt@latest init deckcart -t react --pm npm
cd deckcart
npm install
npm run dev                 # dev Chrome
npm run build               # production .output/chrome-mv3 (Chrome MV3)
npx wxt build -b chrome --mv3   # explicit equivalent
npx wxt prepare             # regenerate .wxt types after config changes
npm run compile             # tsc --noEmit
```

### Unit/component tests

```bash
npm i -D vitest@4.1.12 jsdom@30.1.3
npx vitest run
npx vitest
npx vitest run tests/unit/cardmarket-parser.test.ts
```

### Playwright

```bash
npm i -D @playwright/test@1.64.1
npx playwright install chromium

npm run build
npx playwright test
npx playwright test --ui
HEADED=1 npx playwright test
PWDEBUG=1 npx playwright test
npx playwright test --trace on
npx playwright show-report
```

### Chrome DevTools MCP (optional)

```bash
npx -y chrome-devtools-mcp@1.12.0 --categoryExtensions
npx -y chrome-devtools-mcp@1.12.0 --categoryExtensions --isolated
npx -y chrome-devtools-mcp@1.12.0 \
  --categoryExtensions \
  --filesystemRoot=/home/davids/BetterMarket
```

Then use `install_extension`, `list_extensions`, `list_pages`,
`trigger_extension_action`, `evaluate_script`, and `reload_extension` as
described above.

### Brave manual load

1. `npm run build`
2. Open `brave://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → `/home/davids/BetterMarket/.output/chrome-mv3`
5. Open a Moxfield deck and a Cardmarket tab, then test the side panel action.
6. After rebuilding, click **Reload** on the extension card.

---

## 10. What was actually verified here

A throwaway MV3 extension was built in `/tmp/opencode/proof` (outside this
repo; not committed) and run with Playwright 1.64.1 + bundled Chromium 1248:

- `channel: 'chromium'`, `headless: true` loaded the extension.
- The extension ID was derived from `chrome-extension://<id>/background.js`.
- `chrome-extension://<id>/sidepanel.html` loaded and rendered.
- The sidepanel could message the background (`chrome.runtime.sendMessage`).
- A content script injected into a Cardmarket fixture served by `page.route` at
  the real `https://www.cardmarket.com/...` URL.
- `context.route` intercepted a `fetch()` issued from the extension service
  worker; `route.request().serviceWorker()` was non-null.
- `context.addInitScript` overrode `chrome.runtime.sendMessage` on the
  extension page; the content script isolated world did **not** see the
  main-world flag.
- Without `channel: 'chromium'`, the default headless shell timed out waiting
  for the service worker (extension not loaded).
- A WXT 0.21.5 React build in `/tmp/opencode/wxt-demo` produced
  `.output/chrome-mv3/sidepanel.html` and a `side_panel` manifest entry, and
  loaded successfully in Playwright.
- Vitest 4.1.12 + jsdom 30.1.3 + `WxtVitest()` + `fakeBrowser` passed a smoke
  test covering `runtime.id`, storage, and a mocked `sendMessage`.

The snippets above are the distilled, reusable versions of those checks.

---

## 11. Sources

- WXT installation: <https://wxt.dev/guide/installation>
- WXT entrypoints (background/content/sidepanel/output paths):
  <https://wxt.dev/guide/essentials/entrypoints>
- WXT manifest/permissions: <https://wxt.dev/guide/essentials/config/manifest>
- WXT unit testing (Vitest, fake browser): <https://wxt.dev/guide/essentials/unit-testing>
- WXT E2E testing: <https://wxt.dev/guide/essentials/e2e-testing>
- WXT Playwright example:
  <https://github.com/wxt-dev/examples/tree/main/examples/playwright-e2e-testing>
- Playwright Chrome extensions:
  <https://playwright.dev/docs/chrome-extensions>
- Playwright service workers / routing:
  <https://playwright.dev/docs/service-workers>
  and <https://playwright.dev/docs/network>
- Chrome Side Panel API: <https://developer.chrome.com/docs/extensions/reference/api/sidePanel>
- Chrome content scripts (isolated worlds/matches):
  <https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts>
- Chrome DevTools MCP extension tools:
  <https://developer.chrome.com/docs/devtools/agents/extensions>
- Chrome DevTools MCP tool reference:
  <https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md>
- Chrome DevTools MCP configuration:
  <https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md>
- npm registry versions checked 2026-11-02 for `wxt`, `@wxt-dev/module-react`,
  `react`, `vitest`, `@playwright/test`, `chrome-devtools-mcp`.
