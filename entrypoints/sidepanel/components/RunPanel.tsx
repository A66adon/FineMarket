import { useEffect, useState } from 'react';
import { Play, RefreshCw, Square } from 'lucide-react';
import type { WizardProgress } from '@/src/shared/runner';
import { ProgressBar } from './ProgressBar';
import { ErrorNotice, Notice } from './ErrorNotice';

export function RunPanel({
  phase,
  wantCount,
  progress,
  error,
  cooldownUntil,
  onRun,
  onStop,
  onRetry,
}: {
  phase:
    | 'deck'
    | 'running'
    | 'plans'
    | 'applying'
    | 'done'
    | 'error'
    | 'empty'
    | 'boot'
    | 'loading-deck';
  wantCount: number;
  progress: WizardProgress | null;
  error: string | null;
  cooldownUntil: number;
  onRun: () => void;
  onStop: () => void;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const cooldownRemaining = Math.max(0, cooldownUntil - now);

  if (phase === 'running') {
    return (
      <section className="tray run-tray" aria-labelledby="run-heading">
        <div className="run-top">
          <div>
            <h2 id="run-heading">Reading the market</h2>
            <p className="section-copy">
              Cardmarket pages are paced to avoid its rate limit. Cheapest
              playable reads one page per card — usually about 3–4 seconds
              each.
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
    if (cooldownRemaining > 0) {
      return (
        <section className="tray run-tray" aria-labelledby="run-heading">
          <h2 id="run-heading">Cardmarket rate-limited</h2>
          <Notice tone="warning">
            Cardmarket is rejecting requests from this IP. Try again in{' '}
            <strong>{formatRemaining(cooldownRemaining)}</strong>. Repeated
            attempts can extend the wait.
          </Notice>
        </section>
      );
    }

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
          <button
            type="button"
            className="button button-quiet"
            onClick={onRun}
            disabled={cooldownRemaining > 0}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Run again
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary button-large"
            onClick={onRun}
            disabled={wantCount === 0 || cooldownRemaining > 0}
          >
            <Play size={15} aria-hidden="true" />
            Find cheapest cart
          </button>
        )}
      </div>
      <div className="run-meta">
        <span className="num">{wantCount}</span> cards to price
        <span className="receipt-dot">·</span>
        About 3–4 seconds per card; cached pages are instant
      </div>
      {cooldownRemaining > 0 ? (
        <Notice tone="warning">
          Cardmarket rate-limited this IP. Try again in{' '}
          <strong>{formatRemaining(cooldownRemaining)}</strong>. Do not start
          repeated runs; each one can extend the wait.
        </Notice>
      ) : null}
      {wantCount === 0 ? (
        <p className="form-error">
          No cards are left after the board, basic-land and collection filters.
        </p>
      ) : null}
    </section>
  );
}

function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
