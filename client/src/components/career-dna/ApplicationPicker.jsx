import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconClose } from '../Icons.jsx';

const describe = (app) => `${app.company} – ${app.role || 'Role not set'}`;

// Searchable list of tracked applications. Calls onChange with an id, or '' to clear.
// The input only ever holds the search text; the chosen application shows as its placeholder.
export default function ApplicationPicker({ id, applications, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const listId = useId();

  const selected = applications.find((app) => app._id === value);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter((app) => `${app.company} ${app.role} ${app.stage}`.toLowerCase().includes(q));
  }, [applications, query]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (app) => {
    onChange(app._id);
    close();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (!matches.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.min(Math.max(i + step, 0), matches.length - 1));
    } else if (e.key === 'Enter' && open) {
      // Keeps Enter from submitting the analysis form.
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="app-picker">
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        className={selected ? 'has-selection' : undefined}
        placeholder={selected ? describe(selected) : 'Search by company or role'}
        value={query}
        onFocus={() => {
          setActive(0);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {selected && !query && (
        <button type="button" className="app-picker-clear" onClick={() => onChange('')} aria-label="Remove the link">
          <IconClose size={14} />
        </button>
      )}

      {open && (
        <ul className="app-picker-list" id={listId} role="listbox" ref={listRef}>
          {matches.length ? (
            matches.map((app, i) => (
              <li
                key={app._id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={app._id === value}
                className={i === active ? 'is-active' : undefined}
                // mousedown fires before the input's blur, which would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(app);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="app-picker-name">{describe(app)}</span>
                <span className="app-picker-stage">{app.stage}</span>
              </li>
            ))
          ) : (
            <li className="app-picker-empty">
              {applications.length ? `No application matches “${query.trim()}”.` : 'No tracked applications yet.'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
