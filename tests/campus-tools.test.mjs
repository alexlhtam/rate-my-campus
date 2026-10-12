import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/campus-tools.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { campusShareUrl, parseCampusLink, validateCollection, readCollections, collectionShareUrl, parseCollectionLink, reviewSummary, distanceMetres, matchTimetableLocation, importTimetable } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const wrap = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.map(event => `BEGIN:VEVENT\r\n${event}\r\nEND:VEVENT`), 'END:VCALENDAR'].join('\r\n');
const utc = value => Date.parse(value);
const opts = { now: utc('2026-10-12T00:00:00Z'), days: 90 };

test('share links carry an explicit data mode and omit unrelated URL state', () => {
  const url = campusShareUrl('https://example.org/campus?email=private%40ucl.ac.uk&pin=old#private', { kind: 'place', id: 'garden-halls', mode: 'live' });
  assert.equal(url, 'https://example.org/campus?place=garden-halls&mode=live');
  assert.deepEqual(parseCampusLink(url), { kind: 'place', id: 'garden-halls', mode: 'live' });
  assert.deepEqual(parseCampusLink(campusShareUrl('http://192.168.1.2:3000', { kind: 'pin', id: 'demo-food-1', mode: 'demo' })), { kind: 'pin', id: 'demo-food-1', mode: 'demo' });
  for (const bad of ['?place=x', '?place=x&mode=other', '?place=x&pin=y&mode=demo', '?place=x&mode=demo&mode=live', '?pin=x&pin=y&mode=live', '?place=../../secret&mode=live']) assert.equal(parseCampusLink(`https://example.org/${bad}`), null, bad);
  assert.equal(parseCampusLink('javascript:alert(1)?place=x&mode=demo'), null);
  assert.throws(() => campusShareUrl('javascript:alert(1)', { kind: 'pin', id: 'x', mode: 'demo' }));
});

test('collections round-trip Unicode names, isolate demo mode, strip unrelated/private fields and bound imports', () => {
  const input = { version: 1, id: 'device-123', name: 'Révision 📚', mode: 'demo', placeIds: ['ucl-a', 'ucl-b', 'ucl-a'], email: 'private@ucl.ac.uk', calendar: 'PRIVATE' };
  const normalized = validateCollection(input);
  assert.deepEqual(normalized.placeIds, ['ucl-a', 'ucl-b']);
  assert.equal('email' in normalized, false);
  const shared = collectionShareUrl('https://example.org/?secret=yes', input);
  assert.ok(!shared.includes('secret'));
  assert.deepEqual(parseCollectionLink(shared), { ...normalized, id: 'shared' });
  const payload = Buffer.from(new URL(shared).searchParams.get('collection'), 'base64url').toString('utf8');
  assert.ok(!payload.includes('device-123')); assert.ok(!payload.includes('private')); assert.ok(!payload.includes('PRIVATE'));
  assert.deepEqual(readCollections(JSON.stringify([input])), [normalized]);
  assert.throws(() => readCollections(JSON.stringify([input, input])), /Duplicate/);
  assert.throws(() => readCollections(' '.repeat(65537)), /64 KB/);
  assert.throws(() => validateCollection({ ...input, placeIds: ['../private'] }));
  assert.equal(parseCollectionLink(`${shared}&collection=extra`), null);
  assert.equal(parseCollectionLink('https://example.org/?collection=___'), null);
  assert.throws(() => collectionShareUrl('https://example.org/', { ...input, placeIds: Array.from({ length: 120 }, (_, i) => `place-${i}-${'a'.repeat(100)}`) }), /too large/);
});

test('comparison excludes wrong mode, pending and invalid scores; criterion samples are independent', () => {
  const reviews = [
    { placeId: 'a', rating: 5, recommend: true, criteria: { wifi: 5 }, demo: true },
    { placeId: 'a', rating: 1, recommend: false, criteria: { wifi: 1 }, status: 'approved' },
    { placeId: 'a', rating: 3, recommend: true, criteria: { comfort: 4, wifi: 9 }, status: 'approved' },
    { placeId: 'a', rating: 5, status: 'pending' }, { placeId: 'a', rating: NaN }, { placeId: 'b', rating: 5 },
  ];
  assert.deepEqual(reviewSummary('a', reviews, 'live'), { count: 2, rating: 2, recommend: 50, criteria: { wifi: 1, comfort: 4 }, criteriaCounts: { wifi: 1, comfort: 1 } });
  assert.equal(reviewSummary('a', reviews, 'demo').count, 1);
  assert.equal(reviewSummary('none', reviews, 'live').rating, null);
  const full = { count: 876, rating: 4.1, recommend: 81, criteria: { wifi: 4.2 } };
  assert.deepEqual(reviewSummary('a', reviews, 'live', full), full, 'Authoritative totals beat the truncated public review list');
  assert.equal(reviewSummary('a', reviews, 'demo', full).count, 1, 'Live totals never contaminate sample mode');
});

test('location matching uses exact names/aliases, leaves ambiguous rooms unresolved and never uses demo places', () => {
  const places = [{ id: 'garden', name: 'Garden Halls', aliases: ['Garden Hall'] }, { id: 'room', name: 'LT1', aliases: [] }, { id: 'room2', name: 'LT1' }, { id: 'fake', name: 'My lecture theatre', demo: true }];
  assert.equal(matchTimetableLocation('  Garden HALL ', places)[0].id, 'garden');
  assert.equal(matchTimetableLocation('Garden Halls, Room 42', places).length, 0);
  assert.equal(matchTimetableLocation('LT1', places).length, 2);
  assert.equal(matchTimetableLocation('My lecture theatre', places).length, 0);
  assert.equal(matchTimetableLocation('', places).length, 0);
  assert.equal(distanceMetres({ lat: 51.5, lng: 0 }, { lat: 51.5, lng: 0 }), 0);
  assert.equal(distanceMetres({ lat: 51.5, lng: 0 }, {}), null);
  assert.equal(distanceMetres({ lat: 51.5, lng: 0 }, { lat: NaN, lng: 0 }), null);
});

test('calendar unfolds and unescapes text, keeps UTC and London times correct, discards sensitive fields', () => {
  const result = importTimetable(wrap('UID:class-1\r\nDTSTART;TZID="Europe/London":20261012T090000\r\nDTEND;TZID=Europe/London:20261012T100000\r\nSUMMARY:Very long lecture\r\n  name\\, week 1\r\nLOCATION:Garden Halls\r\nATTENDEE:mailto:private@ucl.ac.uk\r\nDESCRIPTION:PRIVATE NOTE\r\nBEGIN:VALARM\r\nDTSTART:20000101T000000Z\r\nEND:VALARM'), opts);
  assert.equal(result.events.length, 1); assert.equal(result.events[0].start, '2026-10-12T08:00:00.000Z');
  assert.equal(result.events[0].title, 'Very long lecture name, week 1');
  assert.ok(!JSON.stringify(result).includes('private@')); assert.ok(!JSON.stringify(result).includes('PRIVATE NOTE'));
  const utcEvent = importTimetable(wrap('DTSTART:20261012T090000Z\r\nSUMMARY:UTC'), opts).events[0];
  assert.equal(utcEvent.start, '2026-10-12T09:00:00.000Z');
});

test('weekly lectures maintain local time across DST and apply EXDATE/RDATE without duplicates', () => {
  const result = importTimetable(wrap('UID:repeat\r\nDTSTART;TZID=Europe/London:20261019T090000\r\nDTEND;TZID=Europe/London:20261019T100000\r\nRRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO\r\nEXDATE;TZID=Europe/London:20261102T090000\r\nRDATE;TZID=Europe/London:20261026T090000,20261103T090000\r\nSUMMARY:Methods'), opts);
  assert.deepEqual(result.events.map(event => event.start), ['2026-10-19T08:00:00.000Z', '2026-10-26T09:00:00.000Z', '2026-11-03T09:00:00.000Z', '2026-11-09T09:00:00.000Z']);
  assert.ok(result.events.every(event => utc(event.end) - utc(event.start) === 3600000));
  assert.deepEqual(result.warnings, []);
});

test('weekly intervals honour week start and COUNT counts occurrences before the visible window', () => {
  const ics = wrap('DTSTART;TZID=Europe/London:20260928T090000\r\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6\r\nSUMMARY:Fortnightly');
  const result = importTimetable(ics, opts);
  assert.deepEqual(result.events.map(event => event.date), ['2026-10-12', '2026-10-14', '2026-10-26', '2026-10-28']);
  const past = importTimetable(wrap('DTSTART:20260901T090000Z\r\nRRULE:FREQ=DAILY;COUNT=2'), opts);
  assert.equal(past.events.length, 0);
});

test('all-day events keep calendar dates and exclusive end across the DST boundary', () => {
  const result = importTimetable(wrap('DTSTART;VALUE=DATE:20261025\r\nDTEND;VALUE=DATE:20261026\r\nSUMMARY:Reading day'), opts);
  assert.equal(result.events[0].date, '2026-10-25'); assert.equal(result.events[0].allDay, true);
  assert.equal(result.events[0].start, '2026-10-24T23:00:00.000Z'); assert.equal(result.events[0].end, '2026-10-26T00:00:00.000Z');
  const floating = importTimetable(wrap('DTSTART:20261012T090000\r\nSUMMARY:Floating'), { ...opts, timeZone: 'America/New_York' });
  assert.equal(floating.events[0].start, '2026-10-12T13:00:00.000Z');
});

test('unsupported recurrence/timezones and edited series are flagged instead of invented', () => {
  const result = importTimetable(wrap('UID:monthly\r\nDTSTART:20261012T090000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=1MO', 'UID:custom\r\nDTSTART;TZID=MadeUp/Zone:20261012T090000', 'UID:edited\r\nDTSTART:20261012T090000Z\r\nRRULE:FREQ=WEEKLY;COUNT=4', 'UID:edited\r\nRECURRENCE-ID:20261019T090000Z\r\nDTSTART:20261019T100000Z'), opts);
  assert.equal(result.events.length, 0); assert.ok(result.warnings.some(warning => warning.includes('daily and weekly'))); assert.ok(result.warnings.some(warning => warning.includes('Edited recurrence')));
  assert.ok(result.warnings.some(warning => /zone/i.test(warning)));
  const invalid = importTimetable(wrap('DTSTART:20260230T090000Z', 'DTSTART;TZID=Europe/London:20260329T013000'), { now: utc('2026-02-01T00:00:00Z') });
  assert.equal(invalid.events.length, 0); assert.equal(invalid.warnings.length, 2);
  const fallBack = importTimetable(wrap('DTSTART;TZID=Europe/London:20261025T013000'), opts);
  assert.equal(fallBack.events[0].start, '2026-10-25T00:30:00.000Z', 'Repeated wall times choose their first occurrence');
});

test('duration retains ongoing events, respects nominal days, and cancelled/duplicate events are withheld', () => {
  const result = importTimetable(wrap('DTSTART;TZID=Europe/London:20261012T090000\r\nDURATION:PT2H\r\nRRULE:FREQ=DAILY;COUNT=3'), { now: utc('2026-10-13T09:00:00Z') });
  assert.equal(result.events.length, 2); assert.equal(result.events[0].end, '2026-10-13T10:00:00.000Z');
  const day = importTimetable(wrap('DTSTART;TZID=Europe/London:20261024T090000\r\nDURATION:P1D'), opts).events[0];
  assert.equal(utc(day.end) - utc(day.start), 25 * 3600000);
  const rejected = importTimetable(wrap('UID:duplicate\r\nDTSTART:20261012T090000Z', 'UID:duplicate\r\nDTSTART:20261012T100000Z', 'DTSTART:20261012T090000Z\r\nSTATUS:CANCELLED'), opts);
  assert.equal(rejected.events.length, 0); assert.ok(rejected.warnings.some(warning => warning.includes('Duplicate')));
});

test('calendar input and recurrence output are bounded; malicious event URLs are never retained', () => {
  assert.throws(() => importTimetable('x'.repeat(524289)), /512 KB/);
  assert.throws(() => importTimetable('BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261012T090000Z\nEND:VCALENDAR'), /Invalid|Incomplete/);
  assert.throws(() => importTimetable(wrap(...Array.from({ length: 501 }, () => 'DTSTART:20261012T090000Z'))), /500/);
  const result = importTimetable(wrap('DTSTART:20261012T090000Z\r\nRRULE:FREQ=DAILY\r\nURL:https://tracking.example.org\r\nATTACH:https://tracking.example.org/image'), opts);
  assert.ok(result.events.length <= 90); assert.ok(!JSON.stringify(result).includes('tracking'));
});
