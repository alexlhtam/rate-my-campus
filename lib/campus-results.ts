type Result = { id: string; name?: string; title?: string; startsAt?: string; expiresAt?: string };

/** Distance applies across places and alerts; unknown locations stay at the end. */
export function orderCampusResults<T extends Result>(places: T[], pins: T[], sort: string, distance: (row: T) => number): T[] {
  const byName = (a: T, b: T) => (a.name || a.title || '').localeCompare(b.name || b.title || '') || a.id.localeCompare(b.id);
  if (sort === 'distance') return [...places, ...pins].sort((a, b) => distance(a) - distance(b) || byName(a, b));
  const when = (row: T) => Date.parse(row.startsAt || row.expiresAt || '') || Infinity;
  return [...places, ...pins.toSorted((a, b) => when(a) - when(b) || byName(a, b))];
}

/** Nested buttons handle their own keys; only activate a card when it has focus. */
export function activateCardWithKey(event: { key: string; target: unknown; currentTarget: unknown; preventDefault: () => void }, open: () => void) {
  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); }
}
