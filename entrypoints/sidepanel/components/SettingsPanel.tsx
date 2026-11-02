import { SlidersHorizontal, X } from 'lucide-react';
import { COUNTRIES } from '@/src/shared/countries';
import { DEFAULT_SETTINGS } from '@/src/shared/constants';
import type { Condition, Settings } from '@/src/shared/types';

export function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const sellerCountryId = settings.sellerCountryIds[0] ?? 0;

  return (
    <section className="tray settings-panel" aria-labelledby="settings-heading">
      <div className="section-heading-row">
        <div className="section-heading">
          <SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
          <h2 id="settings-heading">Filters</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close filters" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="field-grid">
        <label className="field">
          <span className="field-label">Ships to</span>
          <select
            value={settings.destinationCountryId}
            onChange={(event) =>
              onChange({ destinationCountryId: Number(event.target.value) })
            }
          >
            {COUNTRIES.map((country) => (
              <option key={country.id} value={country.id}>
                {country.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Minimum condition</span>
          <select
            value={settings.minCondition}
            onChange={(event) =>
              onChange({ minCondition: event.target.value as Condition })
            }
          >
            <option value="EX">Excellent or better</option>
            <option value="NM">Near Mint or better</option>
            <option value="GD">Good or better</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span className="field-label">Seller country</span>
        <select
          value={sellerCountryId}
          onChange={(event) => {
            const id = Number(event.target.value);
            onChange({ sellerCountryIds: id > 0 ? [id] : [] });
          }}
        >
          <option value={0}>Any seller country</option>
          {COUNTRIES.map((country) => (
            <option key={country.id} value={country.id}>
              {country.name}
            </option>
          ))}
        </select>
        <small>Useful when you want domestic sellers only.</small>
      </label>

      <div className="check-list">
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.commercialOnly}
            onChange={(event) => onChange({ commercialOnly: event.target.checked })}
          />
          <span>
            <strong>Commercial sellers only</strong>
            <small>Exclude private sellers</small>
          </span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.alwaysTrack}
            onChange={(event) => onChange({ alwaysTrack: event.target.checked })}
          />
          <span>
            <strong>Tracked shipping only</strong>
            <small>Usually more expensive; required above €25 anyway</small>
          </span>
        </label>
      </div>

      <div className="settings-locked">
        <span className="field-label">Card language</span>
        <strong>English only</strong>
        <small>Locked for this build.</small>
      </div>

      <div className="settings-footer">
        <button
          type="button"
          className="button button-quiet"
          onClick={() =>
            onChange({
              destinationCountryId: DEFAULT_SETTINGS.destinationCountryId,
              minCondition: DEFAULT_SETTINGS.minCondition,
              sellerCountryIds: [],
              commercialOnly: false,
              alwaysTrack: false,
            })
          }
        >
          Reset filters
        </button>
        <button type="button" className="button button-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </section>
  );
}
