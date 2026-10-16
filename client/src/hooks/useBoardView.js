import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const DAY_MS = 24 * 60 * 60 * 1000;

export const SORT_OPTIONS = [
  { value: 'recent', label: 'Latest update' },
  { value: 'event', label: 'Upcoming event' },
  { value: 'company', label: 'Company A–Z' },
  { value: 'oldest', label: 'Oldest first' },
];

export const PERIOD_OPTIONS = [
  { value: 'all', label: 'Any time' },
  { value: 'new', label: 'New from last sync' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

export const SOURCE_OPTIONS = [
  { value: 'all', label: 'AI & manual' },
  { value: 'gmail', label: 'From Gmail (AI)' },
  { value: 'manual', label: 'Added manually' },
];

const DEFAULT_VIEW = { q: '', sort: 'recent', platform: 'all', source: 'all', period: 'all' };

const lastActivity = (app) => new Date(app.lastEmailAt ?? app.updatedAt).getTime();

export const isNewSince = (app, since) =>
  Boolean(since && app.aiUpdatedAt && new Date(app.aiUpdatedAt) >= new Date(since));

const COMPARE = {
  recent: (a, b) => lastActivity(b) - lastActivity(a),
  oldest: (a, b) => lastActivity(a) - lastActivity(b),
  company: (a, b) => a.company.localeCompare(b.company, 'en', { sensitivity: 'base' }),
  // Upcoming events soonest first, then everything else by latest update.
  event: (a, b) => {
    const today = new Date(new Date().toDateString()).getTime();
    const upcoming = (app) => (app.eventDate && new Date(app.eventDate).getTime() >= today ? new Date(app.eventDate).getTime() : null);
    const [ea, eb] = [upcoming(a), upcoming(b)];
    if (ea !== null && eb !== null) return ea - eb;
    if (ea !== null) return -1;
    if (eb !== null) return 1;
    return lastActivity(b) - lastActivity(a);
  },
};

export function applyView(applications, view, lastSyncAt) {
  const query = view.q.trim().toLowerCase();
  const days = { '7d': 7, '30d': 30 }[view.period];
  const since = days ? Date.now() - days * DAY_MS : null;

  return applications
    .filter((app) => {
      if (query && !app.company.toLowerCase().includes(query) && !(app.role ?? '').toLowerCase().includes(query)) return false;
      if (view.platform !== 'all' && app.platform !== view.platform) return false;
      if (view.source !== 'all' && app.source !== view.source) return false;
      if (view.period === 'new' && !isNewSince(app, lastSyncAt)) return false;
      if (since && lastActivity(app) < since) return false;
      return true;
    })
    .sort(COMPARE[view.sort] ?? COMPARE.recent);
}

/** Search, sort and filters live in the URL so they survive a refresh and can be bookmarked. */
export function useBoardView() {
  const [params, setParams] = useSearchParams();

  const view = useMemo(
    () => Object.fromEntries(Object.entries(DEFAULT_VIEW).map(([key, fallback]) => [key, params.get(key) ?? fallback])),
    [params]
  );

  const update = useCallback(
    (changes) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === DEFAULT_VIEW[key] || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  // Clears the filters but keeps the chosen sort.
  const reset = useCallback(() => update({ q: '', platform: 'all', source: 'all', period: 'all' }), [update]);

  const isFiltered = Object.entries(DEFAULT_VIEW).some(([key, fallback]) => key !== 'sort' && view[key] !== fallback);

  return { view, update, reset, isFiltered };
}
