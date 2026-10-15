/** Share URLs carry only the public target reference and explicit data mode. */
export type CampusMode = 'demo' | 'live';
export type ShareTarget = { kind: 'place' | 'pin'; id: string; mode: CampusMode };
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(id);
const validMode = (mode: unknown): mode is CampusMode => mode === 'demo' || mode === 'live';

/** The unselected map still has a mode; a refresh must not silently switch datasets. */
export function parseCampusMode(input: string): CampusMode | null {
  try {
    const url = new URL(input), mode = url.searchParams.get('mode');
    return ['http:', 'https:'].includes(url.protocol) && url.searchParams.getAll('mode').length === 1 && validMode(mode) ? mode : null;
  } catch { return null; }
}

export function campusShareUrl(base: string, target: ShareTarget): string {
  if (!validId(target.id) || !validMode(target.mode) || !['place', 'pin'].includes(target.kind)) throw new Error('Invalid shared place or alert.');
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('A web address is required.');
  url.search = ''; url.hash = ''; url.username = ''; url.password = '';
  url.searchParams.set(target.kind, target.id); url.searchParams.set('mode', target.mode);
  return url.toString();
}
/** A mode is mandatory: callers must never silently open a demo target in live data. */
export function parseCampusLink(input: string): ShareTarget | null {
  try {
    const url = new URL(input); const p = url.searchParams;
    const kind = p.has('place') ? 'place' : 'pin'; const id = p.get(kind); const mode = p.get('mode');
    if (!['http:', 'https:'].includes(url.protocol) || (p.has('place') && p.has('pin')) || p.has('collection') || p.getAll(kind).length !== 1 || p.getAll('mode').length !== 1 || !validId(id) || !validMode(mode)) return null;
    return { kind, id, mode };
  } catch { return null; }
}
