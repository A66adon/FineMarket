import { ExternalLink, Link2 } from 'lucide-react';
import type { AppContext } from '@/src/shared/types';

export function DeckSource({
  context,
  url,
  loading,
  error,
  onUrlChange,
  onLoadUrl,
  onLoadDeck,
  onOpenMoxfield,
}: {
  context: AppContext | null;
  url: string;
  loading: boolean;
  error: string | null;
  onUrlChange: (value: string) => void;
  onLoadUrl: () => void;
  onLoadDeck: (publicId: string) => void;
  onOpenMoxfield: () => void;
}) {
  return (
    <section className="tray source-tray" aria-labelledby="source-heading">
      <div className="source-heading">
        <div>
          <h1 id="source-heading">Turn a Moxfield deck into a cheaper cart.</h1>
          <p className="lede">
            DeckCart prices English, EX-or-better cards and compares sellers
            with postage included. Start from the deck you already have open, or
            paste its link.
          </p>
        </div>
        <span className="meta-stamp">MTG · English · EX+</span>
      </div>

      {context?.moxfieldTabs.length ? (
        <div className="source-block">
          <h2>Open Moxfield decks</h2>
          <div className="source-list">
            {context.moxfieldTabs.map((tab) => (
              <button
                key={tab.tabId}
                type="button"
                className="source-row"
                onClick={() => onLoadDeck(tab.publicId)}
                disabled={loading}
              >
                <span className="source-row-main">
                  <span className="source-row-title">
                    {tab.title || 'Moxfield deck'}
                  </span>
                  <span className="source-row-url">{tab.url}</span>
                </span>
                <ExternalLink size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form
        className="url-form"
        onSubmit={(event) => {
          event.preventDefault();
          onLoadUrl();
        }}
      >
        <label htmlFor="moxfield-url" className="field-label">
          Moxfield deck link
        </label>
        <div className="url-row">
          <span className="input-icon" aria-hidden="true">
            <Link2 size={15} />
          </span>
          <input
            id="moxfield-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://moxfield.com/decks/…"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            className="button button-primary"
            disabled={loading || url.trim().length === 0}
          >
            {loading ? 'Loading…' : 'Load deck'}
          </button>
        </div>
      </form>

      {error ? <p className="form-error">{error}</p> : null}

      <ol className="source-steps">
        <li>
          <span className="num">01</span>
          Read the open deck and your board choices.
        </li>
        <li>
          <span className="num">02</span>
          Price English, EX-or-better offers with postage.
        </li>
        <li>
          <span className="num">03</span>
          Review a plan before touching your cart.
        </li>
      </ol>

      <div className="source-footer">
        <button type="button" className="button button-quiet" onClick={onOpenMoxfield}>
          Open Moxfield
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
