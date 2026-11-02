import { parseCardmarketPage } from '../src/shared/cardmarket';
import type { ContentMessage } from '../src/shared/messages';
import type { ApplyItem, Want } from '../src/shared/types';

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
): Promise<{ ok: boolean; page?: unknown; error?: string }> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });

  if (!response.ok) {
    return {
      ok: false,
      error: `Cardmarket returned HTTP ${response.status}. Reload the tab and complete any security check.`,
    };
  }

  const html = await response.text();
  const finalUrl = response.url || url;
  const page = parseCardmarketPage(html, finalUrl, want);

  if (page.cloudflare) {
    return {
      ok: false,
      error:
        'Cardmarket is showing a security check. Open Cardmarket, complete it, then retry.',
    };
  }

  if (page.offers.length === 0) {
    return {
      ok: false,
      error:
        page.pageKind === 'unknown'
          ? 'Cardmarket returned an unexpected page. The site layout may have changed.'
          : 'No English offers at EX or better were found for this card.',
    };
  }

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
