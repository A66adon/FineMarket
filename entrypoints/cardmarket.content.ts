import { parseCardmarketPage } from '../src/shared/cardmarket';
import { parseRetryAfterMs } from '../src/shared/http';
import type { ContentMessage } from '../src/shared/messages';
import type { ApplyItem, Want } from '../src/shared/types';

let loggedEmptyRowDebug = false;

const CARD_LANGUAGE_LABELS = new Set([
  'English',
  'Englisch',
  'French',
  'Französisch',
  'German',
  'Deutsch',
  'Spanish',
  'Spanisch',
  'Italian',
  'Italienisch',
  'Simplified Chinese',
  'Chinesisch (vereinfacht)',
  'Japanese',
  'Japanisch',
  'Portuguese',
  'Portugiesisch',
  'Russian',
  'Russisch',
  'Korean',
  'Koreanisch',
  'Traditional Chinese',
  'Chinesisch (traditionell)',
  'Dutch',
  'Niederländisch',
  'Polish',
  'Polnisch',
  'Czech',
  'Tschechisch',
  'Hungarian',
  'Ungarisch',
]);

function tooltipLabel(element: Element): string | null {
  const raw =
    element.getAttribute('aria-label') ??
    element.getAttribute('data-bs-original-title') ??
    element.getAttribute('data-bs-title') ??
    element.getAttribute('title');
  return raw?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

export default defineContentScript({
  matches: ['https://www.cardmarket.com/*'],
  runAt: 'document_idle',
  main() {
    console.info('[DeckCart] Cardmarket content script ready');

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const msg = message as ContentMessage;

      if (msg.type === 'PAGE_PARSE_WANT') {
        void fetchAndParseWant(msg.url, msg.want)
          .then(sendResponse)
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return true;
      }

      if (msg.type === 'PAGE_ADD_TO_CART') {
        void addToCart(msg.items)
          .then(sendResponse)
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              added: 0,
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        return true;
      }

      return false;
    });
  },
});

async function fetchAndParseWant(
  url: string,
  want: Want,
): Promise<{
  ok: boolean;
  page?: unknown;
  error?: string;
  status?: number;
  retryAfterMs?: number;
}> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });

  if (!response.ok) {
    const retryAfterMs = parseRetryAfterMs(
      response.headers.get('Retry-After'),
    );
    console.warn(
      '[DeckCart] Cardmarket fetch failed',
      response.status,
      retryAfterMs != null ? `retry in ${retryAfterMs}ms` : '',
      url,
    );
    return {
      ok: false,
      status: response.status,
      ...(retryAfterMs != null ? { retryAfterMs } : {}),
      error:
        response.status === 429
          ? 'Cardmarket is rate-limiting DeckCart. Wait a minute and retry.'
          : `Cardmarket returned HTTP ${response.status}. Reload the tab and complete any security check.`,
    };
  }

  const html = await response.text();
  const finalUrl = response.url || url;
  const page = parseCardmarketPage(html, finalUrl, want);

  if (page.cloudflare) {
    console.warn('[DeckCart] Cardmarket security check for', url);
    return {
      ok: false,
      error:
        'Cardmarket is showing a security check. Open Cardmarket, complete it, then retry.',
    };
  }

  if (page.pageKind === 'unknown') {
    console.warn('[DeckCart] Cardmarket page kind unknown for', url);
    return {
      ok: false,
      error:
        'Cardmarket returned an unexpected page. Reload the tab and complete any security check.',
    };
  }

  if (page.offers.length === 0) {
    const rawRows = (html.match(/id=["']articleRow/g) ?? []).length;
    console.warn(
      '[DeckCart] No eligible offers parsed for',
      url,
      `(articleRow ids in fetched HTML: ${rawRows})`,
    );

    if (!loggedEmptyRowDebug && rawRows > 0) {
      loggedEmptyRowDebug = true;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const rows = Array.from(
        doc.querySelectorAll(
          '.article-table .table-body > .row[id^="articleRow"], [id^="articleRow"]',
        ),
      );
      const row = rows[0];
      const attributes = row?.querySelector('.product-attributes') ?? row;
      const labelsFor = (root: Element | null | undefined): string[] =>
        root
          ? Array.from(
              root.querySelectorAll(
                '[aria-label], [data-bs-original-title], [data-bs-title]',
              ),
            )
              .map((element) => tooltipLabel(element))
              .filter((label): label is string => Boolean(label))
          : [];
      const languages: Record<string, number> = {};
      for (const offerRow of rows) {
        const rowAttributes =
          offerRow.querySelector('.product-attributes') ?? offerRow;
        const language =
          labelsFor(rowAttributes).find((label) =>
            CARD_LANGUAGE_LABELS.has(label),
          ) ?? 'none';
        languages[language] = (languages[language] ?? 0) + 1;
      }
      console.warn('[DeckCart] First offer row debug', {
        requestedUrl: url,
        finalUrl,
        pageKind: page.pageKind,
        productId: page.productId,
        metaproductId: page.metaproductId,
        englishChecked: Array.from(
          doc.querySelectorAll<HTMLInputElement>(
            'input[name^="language["]:checked',
          ),
        ).map((input) => input.name),
        minCondition: doc.querySelector<HTMLSelectElement>(
          'select[name="minCondition"]',
        )?.value,
        rawRows,
        parsedRows: rows.length,
        languages,
        id: row?.id,
        seller: row?.querySelector('.seller-name a')?.textContent?.trim(),
        condition: row?.querySelector('.article-condition')?.textContent?.trim(),
        conditionClass: row?.querySelector('.article-condition')?.className,
        labels: labelsFor(attributes).slice(0, 8),
        price: row
          ?.querySelector('.col-offer .price-container')
          ?.textContent?.trim(),
        itemCount: row
          ?.querySelector('.col-offer .amount-container .item-count')
          ?.textContent?.trim(),
        amount: row
          ?.querySelector('.col-offer .amount-container')
          ?.textContent?.trim(),
        input: row
          ?.querySelector('.col-offer input, .actions-container input')
          ?.outerHTML.slice(0, 220),
        rowHtml: row?.outerHTML.slice(0, 1200),
      });
    }
  }

  // An empty offer list is a valid result, not a transport error. The runner
  // adds the user's actual minimum condition and keeps this card in the
  // missing list instead of hiding the reason.
  return { ok: true, page };
}

async function addToCart(
  items: ApplyItem[],
): Promise<{ ok: boolean; added: number; message: string }> {
  const token = document.querySelector<HTMLInputElement>(
    'input[name="__cmtkn"]',
  )?.value;

  if (!token) {
    return {
      ok: false,
      added: 0,
      message:
        'No Cardmarket session token found. Reload the Cardmarket tab and log in again.',
    };
  }

  const segments = location.pathname.split('/').filter(Boolean);
  const language = segments[0] || 'en';
  const game = segments[1] || 'Magic';
  const actionUrl =
    `/${language}/${game}/AjaxAction/` +
    'ShoppingCart_Add_AddArticlesFromProductPage';

  const idArticle: Record<string, string> = {};
  const amount: Record<string, number> = {};
  for (const item of items) {
    if (!item.articleId || item.quantity <= 0) continue;
    idArticle[item.articleId] = item.articleId;
    amount[item.articleId] = item.quantity;
  }

  if (Object.keys(amount).length === 0) {
    return { ok: false, added: 0, message: 'No valid articles to add.' };
  }

  const form = new FormData();
  form.set('__cmtkn', token);
  form.set('idArticle', JSON.stringify(idArticle));
  form.set('amount', JSON.stringify(amount));

  const response = await fetch(actionUrl, {
    method: 'POST',
    body: form,
    credentials: 'include',
    headers: { Accept: 'application/xml,text/xml,*/*' },
  });

  const body = await response.text();
  if (!response.ok) {
    console.warn(
      '[DeckCart] Cardmarket cart request failed',
      response.status,
      body.slice(0, 240),
    );
    return {
      ok: false,
      added: 0,
      message: `Cardmarket rejected the cart request (HTTP ${response.status}).`,
    };
  }

  const encoded = /<resultsCode>(.*?)<\/resultsCode>/s.exec(body)?.[1]?.trim();
  if (!encoded) {
    return {
      ok: false,
      added: 0,
      message:
        'Cardmarket returned an unexpected cart response. Reload the tab and try again.',
    };
  }

  let decoded = '';
  try {
    decoded = new TextDecoder().decode(
      Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
    );
  } catch {
    decoded = atob(encoded);
  }

  if (decoded !== 'generalOK') {
    return {
      ok: false,
      added: 0,
      message: `Cardmarket did not add the articles: ${decoded}`,
    };
  }

  return {
    ok: true,
    added: items.reduce((sum, item) => sum + item.quantity, 0),
    message: 'Articles were added to the Cardmarket cart.',
  };
}
