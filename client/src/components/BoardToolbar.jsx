import { PLATFORMS } from '../constants.js';
import { PERIOD_OPTIONS, SORT_OPTIONS, SOURCE_OPTIONS } from '../hooks/useBoardView.js';
import { IconClose, IconSearch } from './Icons.jsx';

function Select({ label, value, options, onChange }) {
  return (
    <label className="toolbar-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const platformOptions = [{ value: 'all', label: 'All platforms' }, ...PLATFORMS.map((p) => ({ value: p, label: capitalize(p) }))];

export default function BoardToolbar({ view, onChange, onReset, isFiltered, shown, total, newCount }) {
  return (
    <div className="toolbar">
      <label className="toolbar-search">
        <IconSearch size={16} />
        <input
          type="search"
          value={view.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search company or role…"
          aria-label="Search applications"
        />
      </label>

      <Select label="Sort" value={view.sort} options={SORT_OPTIONS} onChange={(sort) => onChange({ sort })} />
      <Select label="Platform" value={view.platform} options={platformOptions} onChange={(platform) => onChange({ platform })} />
      <Select label="Source" value={view.source} options={SOURCE_OPTIONS} onChange={(source) => onChange({ source })} />
      <Select label="Updated" value={view.period} options={PERIOD_OPTIONS} onChange={(period) => onChange({ period })} />

      <div className="toolbar-meta">
        {newCount > 0 && view.period !== 'new' && (
          <button className="new-chip" onClick={() => onChange({ period: 'new' })}>
            {newCount} new from last sync
          </button>
        )}
        <span className="toolbar-count">
          {isFiltered ? `${shown} of ${total}` : `${total}`} applications
        </span>
        {isFiltered && (
          <button className="btn btn-ghost btn-sm" onClick={onReset}>
            <IconClose size={14} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
