import { Settings2 } from 'lucide-react';

export function Header({
  settingsOpen,
  onOpenSettings,
}: {
  settingsOpen: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="brand-name">DeckCart</span>
        <span className="brand-badge">unofficial</span>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label="Open filters and settings"
        aria-expanded={settingsOpen}
        onClick={onOpenSettings}
      >
        <Settings2 size={17} strokeWidth={1.8} />
      </button>
    </header>
  );
}
