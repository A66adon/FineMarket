import { Layers, RotateCcw } from 'lucide-react';
import type { Deck } from '@/src/shared/types';

export function DeckReceipt({
  deck,
  onChangeDeck,
}: {
  deck: Deck;
  onChangeDeck: () => void;
}) {
  const totalCards = deck.boards.reduce((sum, board) => sum + board.count, 0);
  const boardSummary = deck.boards
    .filter((board) => board.count > 0)
    .slice(0, 4)
    .map((board) => `${board.label} ${board.count}`)
    .join(' · ');

  return (
    <section className="tray receipt-tray" aria-labelledby="deck-heading">
      <div className="receipt-top">
        <span className="receipt-icon" aria-hidden="true">
          <Layers size={18} strokeWidth={1.8} />
        </span>
        <div className="receipt-main">
          <h2 id="deck-heading">{deck.name || 'Untitled Moxfield deck'}</h2>
          <p className="receipt-meta">
            {deck.format ? capitalize(deck.format) : 'MTG'}
            {deck.author ? ` · ${deck.author}` : ''}
            <span className="receipt-dot">·</span>
            <span className="num">{totalCards}</span> cards
          </p>
        </div>
        <button type="button" className="icon-text-button" onClick={onChangeDeck}>
          <RotateCcw size={14} aria-hidden="true" />
          Change
        </button>
      </div>
      <div className="receipt-rule" />
      <div className="receipt-bottom">
        <span>{boardSummary || 'No boards selected yet'}</span>
        <span className="receipt-english">English only</span>
      </div>
    </section>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
