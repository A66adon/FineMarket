import { useRef } from 'react';
import { RefreshCw, Trash2, Upload, X } from 'lucide-react';
import type { CollectionIndex } from '@/src/shared/types';
import type { CollectionStatus } from './OptionsTray';

export function CollectionPanel({
  collection,
  status,
  error,
  onRefresh,
  onImport,
  onClear,
  onClose,
}: {
  collection?: CollectionIndex;
  status: CollectionStatus;
  error?: string | null;
  onRefresh: () => void;
  onImport: (file: File) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <section className="tray collection-panel" aria-labelledby="collection-heading">
      <div className="section-heading-row">
        <div className="section-heading">
          <RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />
          <h2 id="collection-heading">Collection</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close collection" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <p className="section-copy">
        DeckCart can subtract cards you already own. Automatic detection uses
        the Collection Tracker on the open Moxfield deck; if Moxfield blocks it,
        import your collection CSV instead.
      </p>

      {collection ? (
        <div className="collection-facts">
          <div>
            <span className="field-label">Owned copies</span>
            <strong className="num">{collection.totalOwned}</strong>
          </div>
          <div>
            <span className="field-label">Source</span>
            <strong>{collection.source === 'moxfield' ? 'Moxfield' : 'CSV import'}</strong>
          </div>
          <div>
            <span className="field-label">Fetched</span>
            <strong>{new Date(collection.fetchedAt).toLocaleString()}</strong>
          </div>
        </div>
      ) : (
        <div className="collection-empty">
          <strong>
            {status === 'loading' ? 'Checking your collection…' : 'No collection connected'}
          </strong>
          <small>
            {status === 'loading'
              ? 'Reading the Collection Tracker from the open Moxfield tab.'
              : 'Open the deck in Moxfield with Collection Tracker enabled, or import a CSV.'}
          </small>
        </div>
      )}

      {error ? <p className="form-error">{error}</p> : null}

      <div className="collection-actions">
        <button type="button" className="button button-primary" onClick={onRefresh}>
          <RefreshCw size={14} aria-hidden="true" />
          Refresh from Moxfield
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={14} aria-hidden="true" />
          Import CSV
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.target.value = '';
          }}
        />
        {collection ? (
          <button type="button" className="button button-danger-quiet" onClick={onClear}>
            <Trash2 size={14} aria-hidden="true" />
            Clear saved
          </button>
        ) : null}
      </div>

      <p className="fineprint">
        Moxfield collection access is read-only and stays in this browser.
      </p>
    </section>
  );
}
