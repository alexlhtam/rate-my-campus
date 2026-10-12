/** Local-only tools. No calendar text, device location or account details enter share URLs. */
export type CampusMode = 'demo' | 'live';
export type ShareTarget = { kind: 'place' | 'pin'; id: string; mode: CampusMode };
export interface ToolPlace {
  id: string; name: string; aliases?: string[]; category?: string; address?: string;
  lat?: number; lng?: number; demo?: boolean; sourceUrl?: string; membershipNote?: string;
}
export interface ToolReview {
  placeId: string; rating: number; recommend?: boolean; criteria?: Record<string, number>;
  demo?: boolean; status?: string; year?: number; term?: string;
}
export interface ToolSummary {
  count: number; rating: number | null; recommend: number | null;
  criteria: Record<string, number>; criteriaCounts?: Record<string, number>; tags?: unknown[];
}
export interface SavedCollection { version: 1; id: string; name: string; mode: CampusMode; placeIds: string[] }
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(id);
const validMode = (mode: unknown): mode is CampusMode => mode === 'demo' || mode === 'live';

function shareBase(base: string) {
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('A web address is required.');
  url.search = ''; url.hash = ''; url.username = ''; url.password = '';
  return url;
}
export function campusShareUrl(base: string, target: ShareTarget): string {
  if (!validId(target.id) || !validMode(target.mode) || !['place', 'pin'].includes(target.kind)) throw new Error('Invalid shared place or alert.');
  const url = shareBase(base);
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
export function validateCollection(value: unknown): SavedCollection {
  if (!value || typeof value !== 'object') throw new Error('This is not a collection.');
  const row = value as Partial<SavedCollection>;
  if (row.version !== 1 || !validId(row.id) || !validMode(row.mode) || typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > 60 || /[\u0000-\u001f]/.test(row.name) || !Array.isArray(row.placeIds) || row.placeIds.length > 120 || !row.placeIds.every(validId)) throw new Error('Invalid collection: use a name up to 60 characters and at most 120 places.');
  return { version: 1, id: row.id, name: row.name.trim(), mode: row.mode, placeIds: [...new Set(row.placeIds)] };
}
export function readCollections(input: string): SavedCollection[] {
  if (new TextEncoder().encode(input).length > 65536) throw new Error('Collection files must be smaller than 64 KB.');
  const rows: unknown = JSON.parse(input);
  if (!Array.isArray(rows) || rows.length > 20) throw new Error('Import up to 20 collections at a time.');
  const result = rows.map(validateCollection);
  if (new Set(result.map(row => `${row.mode}:${row.id}`)).size !== result.length) throw new Error('Duplicate collection references.');
  return result;
}
export function collectionShareUrl(base: string, collection: SavedCollection): string {
  const row = validateCollection(collection);
  // Only name, mode and public place references are shared, never local/account IDs.
  const data = JSON.stringify([1, row.name, row.mode, row.placeIds]);
  const bytes = new TextEncoder().encode(data);
  const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (encoded.length > 5000) throw new Error('This collection is too large for a link. Export a file instead.');
  const url = shareBase(base); url.searchParams.set('collection', encoded);
  return url.toString();
}
export function parseCollectionLink(input: string): SavedCollection | null {
  try {
    const url = new URL(input); const raw = url.searchParams.get('collection');
    if (!['http:', 'https:'].includes(url.protocol) || !raw || raw.length > 5000 || !/^[a-zA-Z0-9_-]+$/.test(raw) || url.searchParams.getAll('collection').length !== 1 || url.searchParams.has('place') || url.searchParams.has('pin')) return null;
    const bytes = Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(data) || data.length !== 4) return null;
    return validateCollection({ version: data[0], id: 'shared', name: data[1], mode: data[2], placeIds: data[3] });
  } catch { return null; }
}
export function reviewSummary(placeId: string, reviews: ToolReview[], mode: CampusMode, authoritative?: ToolSummary): ToolSummary {
  if (mode === 'live' && authoritative) return authoritative;
  const rows = reviews.filter(row => row.placeId === placeId && (mode === 'demo' ? row.demo === true : row.demo !== true) && (!row.status || row.status === 'approved') && Number.isFinite(row.rating) && row.rating >= 1 && row.rating <= 5);
  const criteria: Record<string, number> = {}; const criteriaCounts: Record<string, number> = {}; const recommendations = rows.filter(row => typeof row.recommend === 'boolean');
  for (const row of rows) for (const [key, score] of Object.entries(row.criteria ?? {})) {
    if (!Number.isFinite(score) || score < 1 || score > 5 || !/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(key)) continue;
    criteria[key] = (Object.hasOwn(criteria, key) ? criteria[key] : 0) + score; criteriaCounts[key] = (Object.hasOwn(criteriaCounts, key) ? criteriaCounts[key] : 0) + 1;
  }
  for (const key of Object.keys(criteria)) criteria[key] /= criteriaCounts[key];
  return { count: rows.length, rating: rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : null, recommend: recommendations.length ? Math.round(100 * recommendations.filter(row => row.recommend).length / recommendations.length) : null, criteria, criteriaCounts };
}
export function distanceMetres(a: { lat: number; lng: number }, b: { lat?: number; lng?: number }): number | null {
  if (![a.lat, a.lng, b.lat, b.lng].every(value => typeof value === 'number' && Number.isFinite(value)) || Math.abs(a.lat) > 90 || Math.abs(b.lat!) > 90 || Math.abs(a.lng) > 180 || Math.abs(b.lng!) > 180) return null;
  const rad = Math.PI / 180; const latitude = (b.lat! - a.lat) * rad; const longitude = (b.lng! - a.lng) * rad;
  const h = Math.sin(latitude / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat! * rad) * Math.sin(longitude / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const normalizedLocation = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function matchTimetableLocation(location: string, places: ToolPlace[]): ToolPlace[] {
  const value = normalizedLocation(location);
  if (!value) return [];
  return places.filter(place => !place.demo && [place.name, ...(place.aliases ?? [])].some(name => normalizedLocation(name) === value));
}
export const studyResources = [
  { name: 'Current study seat availability', url: 'https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/available-study-spaces', detail: 'View UCL’s own occupancy information.' },
  { name: 'Book a study space', url: 'https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/bookable-study-spaces-help', detail: 'Official booking guidance and booking links.' },
  { name: 'Library opening hours and facilities', url: 'https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces', detail: 'Check the library’s current information before travelling.' },
] as const;

type Wall = [number, number, number, number, number, number];
type CalendarDate = { wall: Wall; zone: string; allDay: boolean; epoch: number };
type Property = { name: string; params: Record<string, string>; value: string };
export interface TimetableEvent { id: string; title: string; location: string; start: string; end: string; allDay: boolean; date: string; timeZone: string }
export interface TimetableImport { events: TimetableEvent[]; warnings: string[]; sourceEvents: number; until: string }
const DAY = 86400000;
const wallUtc = (wall: Wall) => Date.UTC(wall[0], wall[1] - 1, wall[2], wall[3], wall[4], wall[5]);
const utcWall = (epoch: number): Wall => { const d = new Date(epoch); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]; };
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function wallAt(epoch: number, zone: string): Wall {
  let fmt = formatterCache.get(zone);
  if (!fmt) { fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); formatterCache.set(zone, fmt); }
  const p = Object.fromEntries(fmt.formatToParts(epoch).map(part => [part.type, part.value]));
  return [Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)];
}
function toEpoch(wall: Wall, zone: string): number {
  const nominal = wallUtc(wall);
  if (utcWall(nominal).some((value, i) => value !== wall[i])) throw new Error('Invalid calendar date.');
  if (zone === 'UTC') return nominal;
  // Try both sides of a DST transition. RFC 5545 selects the first repeated time.
  const offsets = new Set([-2, -1, 0, 1, 2].map(day => wallUtc(wallAt(nominal + day * DAY, zone)) - (nominal + day * DAY)));
  const candidates = [...offsets].map(offset => nominal - offset).filter(epoch => wallAt(epoch, zone).every((value, i) => value === wall[i]));
  if (!candidates.length) throw new Error('A local time falls in a daylight-saving clock change; this event was skipped.');
  return Math.min(...candidates);
}
function splitOutsideQuotes(text: string, separator: string): string[] {
  const result: string[] = []; let start = 0; let quoted = false;
  for (let i = 0; i < text.length; i++) { if (text[i] === '"') quoted = !quoted; if (!quoted && text[i] === separator) { result.push(text.slice(start, i)); start = i + 1; } }
  result.push(text.slice(start)); return result;
}
function property(line: string): Property {
  const parts = splitOutsideQuotes(line, ':');
  if (parts.length < 2) throw new Error('Invalid calendar property.');
  const fields = splitOutsideQuotes(parts.shift()!, ';'); const name = fields.shift()!.toUpperCase();
  const params: Record<string, string> = {};
  for (const field of fields) { const equal = field.indexOf('='); if (equal < 1) throw new Error('Invalid calendar parameter.'); params[field.slice(0, equal).toUpperCase()] = field.slice(equal + 1).replace(/^"|"$/g, ''); }
  return { name, params, value: parts.join(':') };
}
const unescapeText = (text: string) => text.replace(/\\([nN,;\\])/g, (_, char: string) => /n/i.test(char) ? '\n' : char);
function calendarDate(p: Property, floatingZone: string): CalendarDate {
  const allDay = p.params.VALUE === 'DATE';
  const match = (allDay ? /^(\d{4})(\d{2})(\d{2})$/ : /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/).exec(p.value);
  if (!match) throw new Error('Unsupported or invalid date format.');
  if (p.params.VALUE && !['DATE', 'DATE-TIME'].includes(p.params.VALUE)) throw new Error('Unsupported calendar date type.');
  if (match[7] && p.params.TZID) throw new Error('UTC dates cannot also specify a timezone.');
  const zone = match[7] ? 'UTC' : p.params.TZID || floatingZone;
  const wall: Wall = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)];
  if (wall[0] < 1970 || wall[0] > 2100) throw new Error('Calendar years must be between 1970 and 2100.');
  return { wall, zone, allDay, epoch: toEpoch(wall, zone) };
}
/** RFC 5545 subset: UTC/IANA/floating dates, daily/weekly RRULE, RDATE and EXDATE.
 * Unsupported rules and edited recurrence series are skipped visibly, never guessed.
 * Input is bounded; output contains no attendees, descriptions, URLs or organisers.
 */
export function importTimetable(text: string, options: { now?: number; days?: number; timeZone?: string } = {}): TimetableImport {
  if (new TextEncoder().encode(text).length > 524288) throw new Error('Choose an .ics file smaller than 512 KB.');
  const now = options.now ?? Date.now(); const days = Math.min(120, Math.max(1, options.days ?? 90)); const zone = options.timeZone ?? 'Europe/London';
  if (!Number.isFinite(now) || !Number.isFinite(days)) throw new Error('Invalid calendar date range.');
  wallAt(now, zone);
  const horizon = now + days * DAY; const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  if (lines.length > 20000 || !lines.includes('BEGIN:VCALENDAR') || !lines.includes('END:VCALENDAR')) throw new Error('This file is not a complete iCalendar (.ics) calendar.');
  const records: Property[][] = []; let current: Property[] | null = null; let nested = 0;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, ''); if (!line) continue;
    if (line === 'BEGIN:VEVENT') { if (current) throw new Error('Invalid nested calendar event.'); current = []; nested = 0; continue; }
    if (line === 'END:VEVENT') { if (!current || nested) throw new Error('Invalid calendar event ending.'); records.push(current); current = null; if (records.length > 500) throw new Error('Import at most 500 source events.'); continue; }
    if (!current) continue;
    if (line.startsWith('BEGIN:')) { nested++; continue; }
    if (line.startsWith('END:')) { nested--; if (nested < 0) throw new Error('Invalid calendar component.'); continue; }
    if (!nested) current.push(property(line));
  }
  if (current) throw new Error('Incomplete calendar event.');
  const events: TimetableEvent[] = []; const warnings = new Set<string>(); let recurrenceWork = 0;
  const uid = (record: Property[]) => record.find(p => p.name === 'UID')?.value;
  const edited = new Set(records.filter(record => record.some(p => p.name === 'RECURRENCE-ID')).map(uid));
  const uidCounts = new Map<string, number>();
  for (const record of records) { const id = uid(record); if (id) uidCounts.set(id, (uidCounts.get(id) || 0) + 1); }
  for (const [index, record] of records.entries()) {
    const get = (name: string) => record.find(p => p.name === name); const title = unescapeText(get('SUMMARY')?.value || 'Untitled event').slice(0, 160);
    try {
      if (get('STATUS')?.value === 'CANCELLED') continue;
      if (edited.has(uid(record)) && uid(record)) throw new Error('Edited recurrence series are not supported; use a calendar export with separate occurrences.');
      if (uid(record) && (uidCounts.get(uid(record)!) || 0) > 1) throw new Error('Duplicate event UID; this series was skipped to avoid outdated event details.');
      const startProp = get('DTSTART'); if (!startProp) throw new Error('Missing start date.');
      if (record.filter(p => ['DTSTART', 'DTEND', 'DURATION', 'RRULE'].includes(p.name)).some((p, i, rows) => rows.findIndex(other => other.name === p.name) !== i)) throw new Error('Repeated date or recurrence properties.');
      const start = calendarDate(startProp, zone); const end = get('DTEND') ? calendarDate(get('DTEND')!, zone) : null;
      if (end && end.allDay !== start.allDay) throw new Error('Start and end must use the same date type.');
      if (end && get('DURATION')) throw new Error('An event cannot have both end and duration.');
      const duration = end ? end.epoch - start.epoch : start.allDay ? DAY : 0;
      if (duration < 0 || duration > 31 * DAY) throw new Error('Invalid or unusually long event duration.');
      let durationDays = 0; let durationSeconds = 0;
      if (get('DURATION')) {
        const match = /^P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(get('DURATION')!.value);
        if (!match || !match.slice(1).some(Boolean)) throw new Error('Unsupported event duration.');
        durationDays = Number(match[1] || 0) * 7 + Number(match[2] || 0); durationSeconds = Number(match[3] || 0) * 3600 + Number(match[4] || 0) * 60 + Number(match[5] || 0);
        if (durationDays * DAY + durationSeconds * 1000 > 31 * DAY || (start.allDay && durationSeconds)) throw new Error('Invalid event duration.');
      }
      const occurrences = new Map<number, CalendarDate>([[start.epoch, start]]);
      const rrule = get('RRULE');
      if (rrule) {
        const pairs = rrule.value.split(';').map(piece => piece.split('='));
        if (pairs.some(pair => pair.length !== 2) || new Set(pairs.map(pair => pair[0])).size !== pairs.length) throw new Error('Invalid recurrence rule.');
        const rule: Record<string, string> = Object.fromEntries(pairs); const allowed = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'];
        if (Object.keys(rule).some(key => !allowed.includes(key)) || !['DAILY', 'WEEKLY'].includes(rule.FREQ)) throw new Error('Only daily and weekly recurrence rules are supported.');
        if (rule.COUNT && rule.UNTIL) throw new Error('A recurrence cannot have both COUNT and UNTIL.');
        const interval = Number(rule.INTERVAL || 1); const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
        if (!Number.isInteger(interval) || interval < 1 || interval > 52 || (count !== Infinity && (!Number.isInteger(count) || count < 1 || count > 10000))) throw new Error('Recurrence interval or count exceeds the supported range.');
        const dayCodes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; const weekday = new Date(wallUtc(start.wall)).getUTCDay();
        const weekdays = rule.BYDAY ? rule.BYDAY.split(',').map(value => dayCodes.indexOf(value)) : [weekday];
        const weekStart = dayCodes.indexOf(rule.WKST || 'MO');
        if (weekdays.includes(-1) || weekStart < 0 || (rule.BYDAY && !weekdays.includes(weekday))) throw new Error('Unsupported weekday rule or start outside its recurrence pattern.');
        const until = rule.UNTIL ? calendarDate({ name: 'UNTIL', params: { ...startProp.params, ...(rule.UNTIL.endsWith('Z') ? { TZID: '' } : {}) }, value: rule.UNTIL }, zone).epoch : horizon;
        if (until < start.epoch) throw new Error('Recurrence ends before its start.');
        const limit = Math.min(horizon + 2 * DAY, until + 2 * DAY); const span = Math.ceil((limit - wallUtc(start.wall)) / DAY);
        if (span > 3660) throw new Error('Recurrence starts more than ten years ago; export a recent date range.');
        let generated = 1;
        for (let day = 1; day <= Math.max(0, span) && generated < count; day++) {
          if (++recurrenceWork > 100000) throw new Error('Calendar recurrence processing limit reached. Export a shorter date range.');
          const wall = utcWall(wallUtc(start.wall) + day * DAY); const dow = new Date(wallUtc(wall)).getUTCDay();
          const week = Math.floor((day + (weekday - weekStart + 7) % 7) / 7);
          if (rule.FREQ === 'DAILY' ? day % interval !== 0 || (rule.BYDAY && !weekdays.includes(dow)) : week % interval !== 0 || !weekdays.includes(dow)) continue;
          let epoch: number;
          try { epoch = toEpoch(wall, start.zone); } catch { warnings.add(`${title}: an invalid clock-change occurrence was skipped.`); continue; }
          if (epoch > until || epoch >= horizon) break;
          generated++; if (epoch + 31 * DAY >= now) occurrences.set(epoch, { ...start, epoch, wall });
          if (occurrences.size > 1000) throw new Error('Too many recurrences in this date range.');
        }
      }
      for (const p of record.filter(p => p.name === 'RDATE')) for (const value of p.value.split(',')) {
        const date = calendarDate({ ...p, value }, zone); if (date.allDay !== start.allDay) throw new Error('Recurrence dates use a different date type.'); occurrences.set(date.epoch, date);
      }
      for (const p of record.filter(p => p.name === 'EXDATE')) for (const value of p.value.split(',')) occurrences.delete(calendarDate({ ...p, value }, zone).epoch);
      for (const occurrence of occurrences.values()) {
        let endEpoch = occurrence.epoch + duration;
        if (get('DURATION')) endEpoch = toEpoch(utcWall(wallUtc(occurrence.wall) + durationDays * DAY), occurrence.zone) + durationSeconds * 1000;
        else if (start.allDay) endEpoch = toEpoch(utcWall(wallUtc(occurrence.wall) + (end ? Math.round((wallUtc(end.wall) - wallUtc(start.wall)) / DAY) : 1) * DAY), occurrence.zone);
        if (endEpoch < now || occurrence.epoch >= horizon) continue;
        events.push({ id: `event-${index}-${occurrence.epoch}`, title, location: unescapeText(get('LOCATION')?.value || '').slice(0, 300), start: new Date(occurrence.epoch).toISOString(), end: new Date(endEpoch).toISOString(), allDay: start.allDay, date: occurrence.wall.slice(0, 3).map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-'), timeZone: occurrence.zone });
        if (events.length > 1000) throw new Error('The calendar has too many occurrences; export a shorter date range.');
      }
    } catch (error) { warnings.add(`${title}: ${error instanceof Error ? error.message : 'Unsupported event.'}`); }
    if (recurrenceWork > 100000) throw new Error('Calendar recurrence processing limit reached. Export a shorter date range.');
    if (events.length > 1000) throw new Error('Import at most 1,000 occurrences. Export a shorter date range.');
  }
  return { events: events.sort((a, b) => a.start.localeCompare(b.start)), warnings: [...warnings].slice(0, 100), sourceEvents: records.length, until: new Date(horizon).toISOString() };
}
