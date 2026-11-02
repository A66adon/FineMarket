import { CircleHelp, Filter, Library, SlidersHorizontal } from 'lucide-react';
import { countryName } from '@/src/shared/countries';
import { BOARD_LABELS, BOARD_ORDER } from '@/src/shared/constants';
import { boardOptions } from '@/src/shared/moxfield';
import type { CollectionIndex, Deck, Settings } from '@/src/shared/types';

export type CollectionStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export function OptionsTray({
  deck,
  settings,
  collection,
  collectionStatus,
  collectionError,
  wantCount,
  onSettings,
  onOpenSettings,
  onOpenCollection,
}: {
  deck: Deck;
  settings: Settings;
  collection?: CollectionIndex;
  collectionStatus: CollectionStatus;
  collectionError?: string | null;
  wantCount: number;
  onSettings: (patch: Partial<Settings>) => void;
  onOpenSettings: () => void;
  onOpenCollection: () => void;
}) {
  const boards = boardOptions(deck);
  const selectedBoards = new Set(settings.boards);

  function toggleBoard(name: (typeof boards)[number]['name']) {
    const next = new Set(selectedBoards);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onSettings({ boards: BOARD_ORDER.filter((board) => next.has(board)) });
  }

  return (
    <section className="tray options-tray" aria-labelledby="options-heading">
      <div className="options-top">
        <h2 id="options-heading">Buying</h2>
        <div className="segmented" role="group" aria-label="Buying mode">
          <button
            type="button"
            aria-pressed={settings.mode === 'cheapest-playable'}
            className={settings.mode === 'cheapest-playable' ? 'active' : ''}
            onClick={() => onSettings({ mode: 'cheapest-playable' })}
          >
            Cheapest playable
          </button>
          <button
            type="button"
            aria-pressed={settings.mode === 'deck-as-listed'}
            className={settings.mode === 'deck-as-listed' ? 'active' : ''}
            onClick={() => onSettings({ mode: 'deck-as-listed' })}
          >
            Deck as listed
          </button>
        </div>
      </div>

      <p className="mode-note">
        {settings.mode === 'cheapest-playable'
          ? 'Any English printing or finish, as long as the card is the same.'
          : 'Exact Moxfield printing and finish, English only.'}
      </p>

      <div className="option-group">
        <div className="option-label-row">
          <span className="field-label">Boards</span>
          <span className="muted num">{wantCount} cards to price</span>
        </div>
        <div className="chip-row" role="group" aria-label="Included boards">
          {boards.map((board) => (
            <button
              key={board.name}
              type="button"
              className="chip"
              aria-pressed={selectedBoards.has(board.name)}
              onClick={() => toggleBoard(board.name)}
              title={BOARD_LABELS[board.name]}
            >
              {board.label}
              <span className="chip-count num">{board.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="toggle-list">
        <button
          type="button"
          className="toggle-row"
          aria-pressed={settings.includeBasicLands}
          onClick={() => onSettings({ includeBasicLands: !settings.includeBasicLands })}
        >
          <span className="toggle-switch" aria-hidden="true" />
          <span>
            <strong>Basic lands</strong>
            <small>Buy the basics the deck needs</small>
          </span>
        </button>

        <button
          type="button"
          className="toggle-row"
          aria-pressed={settings.ignoreOwned && Boolean(collection)}
          onClick={() => {
            if (collection) onSettings({ ignoreOwned: !settings.ignoreOwned });
            else onOpenCollection();
          }}
        >
          <span className="toggle-switch" aria-hidden="true" />
          <span>
            <strong>Skip cards I own</strong>
            <small>
              {collectionStatus === 'loading'
                ? 'Checking your Moxfield collection…'
                : collection
                  ? `${collection.totalOwned} owned ${
                      collection.totalOwned === 1 ? 'copy' : 'copies'
                    } found`
                  : 'Connect a Moxfield collection or import a CSV'}
            </small>
          </span>
          {collectionError && !collection ? (
            <CircleHelp size={15} className="muted" aria-label="Collection unavailable" />
          ) : null}
        </button>
      </div>

      <div className="options-footer">
        <button type="button" className="button button-quiet" onClick={onOpenCollection}>
          <Library size={14} aria-hidden="true" />
          Collection
        </button>
        <button type="button" className="button button-quiet" onClick={onOpenSettings}>
          <SlidersHorizontal size={14} aria-hidden="true" />
          Filters
        </button>
        <span className="options-filter-summary">
          <Filter size={13} aria-hidden="true" />
          English · {settings.minCondition}+ · {countryName(settings.destinationCountryId)}
        </span>
      </div>
    </section>
  );
}
