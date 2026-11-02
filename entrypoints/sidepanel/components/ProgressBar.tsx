import type { WizardProgress } from '@/src/shared/runner';

export function ProgressBar({ progress }: { progress: WizardProgress | null }) {
  if (!progress) return null;
  const percent =
    progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0;

  return (
    <div className="progress" aria-live="polite">
      <div className="progress-row">
        <span>{progress.label}</span>
        <span className="num">
          {progress.current}
          <span className="muted"> / {progress.total}</span>
        </span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.current}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
