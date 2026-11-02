import { Play, RefreshCw, Square } from 'lucide-react';
import type { WizardProgress } from '@/src/shared/runner';
import { ProgressBar } from './ProgressBar';
import { ErrorNotice } from './ErrorNotice';

export function RunPanel({
  phase,
  wantCount,
  progress,
  error,
  onRun,
  onStop,
  onRetry,
}: {
  phase: 'deck' | 'running' | 'plans' | 'applying' | 'done' | 'error' | 'empty' | 'boot' | 'loading-deck';
  wantCount: number;
  progress: WizardProgress | null;
  error: string | null;
  onRun: () => void;
  onStop: () => void;
  onRetry: () => void;
}) {
  if (phase === 'running') {
    return (
      <section className="tray run-tray" aria-labelledby="run-heading">
        <div className="run-top">
          <div>
            <h2 id="run-heading">Reading the market</h2>
            <p className="section-copy">
              Cardmarket pages are read one at a time. You can stop at any point.
            </p>
          </div>
          <button type="button" className="button button-quiet" onClick={onStop}>
            <Square size={13} aria-hidden="true" />
            Stop
          </button>
        </div>
        <ProgressBar progress={progress} />
      </section>
    );
  }

  if (phase === 'error') {
    return (
      <section className="tray run-tray" aria-labelledby="run-heading">
        <h2 id="run-heading">Run stopped</h2>
        <ErrorNotice message={error ?? 'Something went wrong.'} onRetry={onRetry} />
      </section>
    );
  }

  return (
    <section className="tray run-tray" aria-labelledby="run-heading">
      <div className="run-top">
        <div>
          <h2 id="run-heading">
            {phase === 'plans' ? 'Plans ready' : 'Find the cheapest cart'}
          </h2>
          <p className="section-copy">
            {phase === 'plans'
              ? 'Change any option and run again, or review a plan below.'
              : 'Reads English, EX-or-better offers and compares sellers with postage included.'}
          </p>
        </div>
        {phase === 'plans' ? (
          <button type="button" className="button button-quiet" onClick={onRun}>
            <RefreshCw size={14} aria-hidden="true" />
            Run again
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary button-large"
            onClick={onRun}
            disabled={wantCount === 0}
          >
            <Play size={15} aria-hidden="true" />
            Find cheapest cart
          </button>
        )}
      </div>
      <div className="run-meta">
        <span className="num">{wantCount}</span> cards to price
        <span className="receipt-dot">·</span>
        100 cards usually takes a few minutes
      </div>
      {wantCount === 0 ? (
        <p className="form-error">
          No cards are left after the board, basic-land and collection filters.
        </p>
      ) : null}
    </section>
  );
}
