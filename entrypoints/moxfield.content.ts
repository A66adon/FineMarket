const DECK_PATH = /\/decks\/([A-Za-z0-9_-]{22})(?:[/?#]|$)/;

export default defineContentScript({
  matches: ['https://moxfield.com/decks/*', 'https://www.moxfield.com/decks/*'],
  runAt: 'document_idle',
  main() {
    console.info('[DeckCart] Moxfield content script ready');

    ensureButton();
    const observer = new MutationObserver(() => ensureButton());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.addEventListener('popstate', ensureButton);
  },
});

function ensureButton(): void {
  if (document.getElementById('deckcart-moxfield-host')) return;
  const publicId = DECK_PATH.exec(location.pathname)?.[1];
  if (!publicId) return;

  const host = document.createElement('div');
  host.id = 'deckcart-moxfield-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.deckcartButton = '';
  button.textContent = 'Find cheapest Cardmarket cart';
  button.setAttribute(
    'aria-label',
    'Open DeckCart and find the cheapest Cardmarket cart for this deck',
  );
  button.style.cssText = [
    'position:fixed',
    'right:22px',
    'bottom:22px',
    'z-index:2147483647',
    'border:1px solid rgba(255,255,255,.24)',
    'background:#C94724',
    'color:#fff',
    'font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
    'padding:12px 16px',
    'border-radius:10px',
    'box-shadow:0 10px 26px rgba(24,20,16,.28)',
    'cursor:pointer',
    'letter-spacing:.01em',
  ].join(';');

  const hint = document.createElement('div');
  hint.textContent = 'DeckCart · unofficial';
  hint.style.cssText = [
    'position:fixed',
    'right:24px',
    'bottom:6px',
    'z-index:2147483647',
    'color:rgba(20,18,16,.55)',
    'font:500 10px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
    'letter-spacing:.04em',
    'text-transform:uppercase',
    'pointer-events:none',
  ].join(';');

  button.addEventListener('mouseenter', () => {
    button.style.background = '#B9401F';
  });
  button.addEventListener('mouseleave', () => {
    button.style.background = '#C94724';
  });
  button.addEventListener('focus', () => {
    button.style.outline = '3px solid #1F4E79';
    button.style.outlineOffset = '2px';
  });
  button.addEventListener('blur', () => {
    button.style.outline = 'none';
  });

  button.addEventListener('click', () => {
    const currentId = DECK_PATH.exec(location.pathname)?.[1];
    if (!currentId) return;
    button.disabled = true;
    button.textContent = 'Opening DeckCart…';
    void browser.runtime
      .sendMessage({ type: 'START_FROM_MOXFIELD', publicId: currentId })
      .catch(() => {
        button.textContent = 'Reload the page and try again';
      })
      .finally(() => {
        window.setTimeout(() => {
          button.disabled = false;
          button.textContent = 'Find cheapest Cardmarket cart';
        }, 1800);
      });
  });

  shadow.append(button, hint);
  document.documentElement.append(host);
}
