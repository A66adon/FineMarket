import { AlertTriangle } from 'lucide-react';

export function ErrorNotice({
  title = 'That did not work',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="notice notice-error" role="alert">
      <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" />
      <div className="notice-copy">
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {onRetry ? (
        <button type="button" className="button button-quiet" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Notice({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'success';
}) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}
