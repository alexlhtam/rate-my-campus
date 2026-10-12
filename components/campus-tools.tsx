'use client';
/* eslint-disable @next/next/no-img-element -- QR images are generated data URLs on-device, with no image service. */

import { useEffect, useMemo, useState } from 'react';
import {
  campusShareUrl, collectionShareUrl, distanceMetres, importTimetable, matchTimetableLocation,
  parseCollectionLink, readCollections, reviewSummary, studyResources, validateCollection,
  type CampusMode, type SavedCollection, type ShareTarget, type TimetableImport,
  type ToolPlace, type ToolReview, type ToolSummary,
} from '../lib/campus-tools';
import './campus-tools.css';

const STORAGE = 'rmc-collections-v1';
const reference = { lat: 51.5246, lng: -0.134 }; // Labelled fixed reference; never a device location.
const criterionNames: Record<string, string> = { plugs: 'Plug sockets', wifi: 'Wi-Fi', noise: 'Quietness', comfort: 'Comfort', accessibility: 'Accessibility', value: 'Value', cleanliness: 'Cleanliness', social: 'Social life', staff: 'Staff', location: 'Location', landlord: 'Landlord response', deposit: 'Deposit experience', damp: 'Damp / mould experience' };
const uid = () => `c-${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint8Array(6)), value => value.toString(16).padStart(2, '0')).join('')}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'That action could not be completed.';
const safeLink = (value?: string) => { try { const url = new URL(value || ''); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; } };

function LinkActions({ url, label }: { url: string; label: string }) {
  const [message, setMessage] = useState(''); const [qr, setQr] = useState(''); const [busy, setBusy] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setMessage('Link copied.'); }
    catch { setMessage('Select and copy the address below.'); }
  }
  async function share() {
    try { if (navigator.share) await navigator.share({ title: label, url }); else await copy(); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setMessage('Use Copy link or the address below.'); }
  }
  async function generateQr() {
    if (url.length > 2200) { setMessage('This link is too long for a useful QR code. Copy it or export the collection.'); return; }
    setBusy(true);
    try { const qrcode = await import('qrcode'); setQr(await qrcode.toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#102924', light: '#ffffff' } })); }
    catch { setMessage('QR generation failed. The link below still works.'); }
    finally { setBusy(false); }
  }
  return <div className="ct-link-actions">
    <div className="ct-row"><button type="button" onClick={copy}>Copy link</button><button type="button" onClick={share}>Share</button><button type="button" onClick={generateQr} disabled={busy}>{busy ? 'Making QR…' : 'Show QR'}</button></div>
    <label className="ct-url">Share address<input aria-label={`Share address for ${label}`} value={url} readOnly onFocus={event => event.currentTarget.select()} /></label>
    {qr && <div className="ct-qr"><img src={qr} alt={`QR code for ${label}`} width="240" height="240" /><a href={qr} download="rate-my-campus-qr.png">Download QR image</a></div>}
    {message && <p role="status" className="ct-note">{message}</p>}
  </div>;
}

export function ShareCampusLink({ target, label }: { target: ShareTarget; label: string }) {
  const [base, setBase] = useState(''); const [show, setShow] = useState(false);
  let url = ''; try { if (base) url = campusShareUrl(base, target); } catch { /* Invalid targets have no share address. */ }
  return <div className="campus-tools ct-share"><button type="button" onClick={() => { setBase(window.location.href); setShow(value => !value); }} aria-expanded={show}>Share {target.kind === 'place' ? 'place' : 'alert'}</button>
    {show && <div className="ct-share-body"><p>{target.mode === 'demo' ? 'Demo link: the recipient must open sample mode. Personal sandbox alerts only exist on this device and may be unavailable elsewhere.' : 'Community link: alerts may have expired or been removed when someone opens it.'}</p>{url && <LinkActions key={url} url={url} label={label} />}</div>}
  </div>;
}

export interface CampusToolsProps {
  mode: CampusMode;
  places: ToolPlace[];
  reviews: ToolReview[];
  /** Current-mode alerts are accepted for integration; alerts are not stored in place collections. */
  pins?: Array<{ id: string; title: string }>;
  summaries?: Record<string, ToolSummary>;
  signedIn?: boolean;
  onSelect: (id: string) => void;
}

export default function CampusTools({ mode, places, reviews, summaries, signedIn = false, onSelect }: CampusToolsProps) {
  const [tab, setTab] = useState<'compare' | 'collections' | 'timetable' | 'study'>('compare');
  const [compare, setCompare] = useState<string[]>([]); const [query, setQuery] = useState('');
  const [collections, setCollections] = useState<SavedCollection[]>([]); const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(''); const [message, setMessage] = useState(''); const [name, setName] = useState('');
  const [active, setActive] = useState(''); const [collectionQuery, setCollectionQuery] = useState('');
  const [pendingImport, setPendingImport] = useState<SavedCollection[] | null>(null); const [sharedUrl, setSharedUrl] = useState('');
  const [accountPreview, setAccountPreview] = useState<SavedCollection[] | null>(null); const [accountBusy, setAccountBusy] = useState(false);
  const [calendar, setCalendar] = useState<TimetableImport | null>(null); const [calendarError, setCalendarError] = useState('');
  const [timeZone, setTimeZone] = useState('Europe/London'); const [manual, setManual] = useState<Record<string, string>>({});
  const [draftMatches, setDraftMatches] = useState<Record<string, string>>({}); const [clock, setClock] = useState(() => Date.now());
  const [previousMode, setPreviousMode] = useState(mode);
  if (previousMode !== mode) { setPreviousMode(mode); setCompare([]); setActive(''); setSharedUrl(''); setAccountPreview(null); setMessage(''); }
  const currentPlaces = useMemo(() => places.filter(place => mode === 'demo' || !place.demo), [places, mode]);
  const placeById = useMemo(() => new Map(currentPlaces.map(place => [place.id, place])), [currentPlaces]);
  useEffect(() => {
    // Browser storage cannot be read during server rendering; hydrate this external store after mounting.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const stored = localStorage.getItem(STORAGE); if (stored) setCollections(readCollections(stored)); }
    catch { setStorageError('Saved collections could not be read. The stored copy has been left untouched. Export new collections before closing this page.'); }
    const shared = parseCollectionLink(window.location.href);
    if (shared) { setPendingImport([shared]); setTab('collections'); }
    setLoaded(true);
  }, []);
  // A failed write to external browser storage must be reported to prevent a false saved-state claim.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!loaded || storageError) return; try { localStorage.setItem(STORAGE, JSON.stringify(collections)); } catch { setStorageError('This browser could not save collections. Export a file before closing the page.'); } }, [collections, loaded, storageError]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const currentCollections = collections.filter(collection => collection.mode === mode);
  const selectedCollection = currentCollections.find(collection => collection.id === active) || currentCollections[0];
  const chosen = compare.map(id => placeById.get(id)).filter((place): place is ToolPlace => !!place);
  const compared = chosen.map(place => ({ place, summary: reviewSummary(place.id, reviews, mode, summaries?.[place.id]) }));
  const criteria = [...new Set(compared.flatMap(row => Object.keys(row.summary.criteria)))];
  const candidates = currentPlaces.filter(place => `${place.name} ${(place.aliases ?? []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30);
  const collectionCandidates = currentPlaces.filter(place => `${place.name} ${(place.aliases ?? []).join(' ')}`.toLowerCase().includes(collectionQuery.trim().toLowerCase())).slice(0, 20);
  function updateCollection(updated: SavedCollection) { setCollections(rows => rows.map(row => row.id === updated.id && row.mode === updated.mode ? validateCollection(updated) : row)); setSharedUrl(''); }
  function addCollection() {
    try {
      if (collections.length >= 20) throw new Error('You can keep up to 20 collections.');
      const row = validateCollection({ version: 1, id: uid(), name, mode, placeIds: [] });
      setCollections(rows => [...rows, row]); setActive(row.id); setName(''); setMessage('Collection created on this device.');
    } catch (error) { setMessage(errorText(error)); }
  }
  function mergeCollections(incoming: SavedCollection[]) {
    try {
      const next = [...collections];
      for (const imported of incoming) {
        const row = validateCollection(imported);
        const exact = next.some(existing => existing.mode === row.mode && existing.name === row.name && JSON.stringify(existing.placeIds) === JSON.stringify(row.placeIds));
        if (exact) continue;
        if (next.length >= 20) throw new Error('This import would exceed 20 collections. Remove a collection first.');
        next.push({ ...row, id: next.some(existing => existing.id === row.id) || row.id === 'shared' ? uid() : row.id });
      }
      setCollections(next); setPendingImport(null); setMessage('Collections added. Existing collections were preserved.');
    } catch (error) { setMessage(errorText(error)); }
  }
  async function importCollections(file?: File) {
    if (!file) return;
    try { if (file.size > 65536) throw new Error('Choose a collection file smaller than 64 KB.'); setPendingImport(readCollections(await file.text())); setMessage('Review the collections below before adding them.'); }
    catch (error) { setMessage(errorText(error)); }
  }
  function exportCollections() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(currentCollections, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `campus-collections-${mode}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function account(action: 'load' | 'prepare' | 'save') {
    if (mode !== 'live' || !signedIn) return;
    setAccountBusy(true); setMessage('');
    try {
      const response = await fetch('/api/community/preferences', action === 'save' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collections: (accountPreview || []).map(({ id, name, placeIds }) => ({ id, name, placeIds })) }) } : undefined);
      const body = await response.json() as { error?: string; collections?: Array<{ id: string; name: string; placeIds: string[] }> };
      if (!response.ok || !Array.isArray(body.collections)) throw new Error(body.error || 'Could not access your account collections.');
      const remote = body.collections.map(row => validateCollection({ ...row, version: 1, mode: 'live' }));
      if (action === 'load') { setPendingImport(remote); setMessage('Review your account collections before adding them to this device.'); }
      if (action === 'prepare') {
        const merged = new Map(remote.map(row => [row.id, row]));
        for (const row of currentCollections) merged.set(row.id, { ...row, placeIds: row.placeIds.filter(id => placeById.has(id) && !placeById.get(id)?.demo) });
        if (merged.size > 20) throw new Error('The combined account and device collections exceed 20.');
        setAccountPreview([...merged.values()]);
      }
      if (action === 'save') { setAccountPreview(null); setMessage('Saved to your account. Future device changes stay local until you save again.'); }
    } catch (error) { setMessage(errorText(error)); }
    finally { setAccountBusy(false); }
  }
  async function importCalendar(file?: File) {
    if (!file) return;
    setCalendarError('');
    try { if (file.size > 524288) throw new Error('Choose an .ics file smaller than 512 KB.'); const result = importTimetable(await file.text(), { timeZone }); setCalendar(result); setManual({}); setDraftMatches({}); setClock(Date.now()); }
    catch (error) { setCalendarError(errorText(error)); }
  }
  const upcoming = calendar?.events.filter(event => Date.parse(event.end) >= clock).slice(0, 80) || [];
  return <section className="campus-tools" aria-label="Campus tools">
    <header className="ct-heading"><h2>Your campus toolkit</h2><p>Compare places, organise favourites and find the right building for your next lecture.</p></header>
    <nav className="ct-tabs" aria-label="Campus tools"><button type="button" aria-pressed={tab === 'compare'} onClick={() => setTab('compare')}>Compare</button><button type="button" aria-pressed={tab === 'collections'} onClick={() => setTab('collections')}>Collections</button><button type="button" aria-pressed={tab === 'timetable'} onClick={() => setTab('timetable')}>Timetable</button><button type="button" aria-pressed={tab === 'study'} onClick={() => setTab('study')}>Study resources</button></nav>
    <p className="ct-mode">{mode === 'demo' ? 'Sample mode · ratings are fictional examples' : 'Community mode · published student contributions'}</p>
    {tab === 'compare' && <div className="ct-panel">
      <h3>Compare up to three places</h3><p>Review averages are student opinions. Distances below are straight lines from UCL’s main campus, not walking routes.</p>
      <label>Find a place<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Library, lecture room or halls…" /></label>
      <div className="ct-picker">{candidates.map(place => <label key={place.id}><input type="checkbox" checked={compare.includes(place.id)} disabled={compare.length >= 3 && !compare.includes(place.id)} onChange={() => setCompare(ids => ids.includes(place.id) ? ids.filter(id => id !== place.id) : [...ids, place.id].slice(0, 3))} />{place.name}{place.demo && <small>Sample place</small>}</label>)}</div>
      {chosen.length < 2 ? <p className="ct-empty">Choose two or three places to compare them.</p> : <div className="ct-table-scroll"><table><caption>{mode === 'demo' ? 'Sample reviews only' : summaries ? 'Published review totals' : 'Published reviews supplied to this view'}</caption><thead><tr><th scope="col">What matters</th>{chosen.map(place => <th scope="col" key={place.id}><button type="button" onClick={() => onSelect(place.id)}>{place.name}</button><button type="button" className="ct-remove" aria-label={`Remove ${place.name} from comparison`} onClick={() => setCompare(ids => ids.filter(id => id !== place.id))}>Remove</button></th>)}</tr></thead><tbody>
        <tr><th scope="row">Overall score</th>{compared.map(({ place, summary }) => <td key={place.id}>{summary.count && summary.rating !== null ? <><strong>{summary.rating.toFixed(1)} / 5</strong><small>{summary.count} {mode === 'demo' ? 'sample ' : ''}review{summary.count === 1 ? '' : 's'}</small></> : 'No reviews yet'}</td>)}</tr>
        <tr><th scope="row">Would recommend</th>{compared.map(({ place, summary }) => <td key={place.id}>{summary.recommend === null ? 'Not rated' : `${Math.round(summary.recommend)}%`}</td>)}</tr>
        {criteria.map(key => <tr key={key}><th scope="row">{criterionNames[key] || key}</th>{compared.map(({ place, summary }) => <td key={place.id}>{typeof summary.criteria[key] === 'number' ? <>{summary.criteria[key].toFixed(1)} / 5<small>{summary.criteriaCounts?.[key] !== undefined ? `${summary.criteriaCounts[key]} scored this` : 'Criterion response count unavailable'}</small></> : 'Not rated'}</td>)}</tr>)}
        <tr><th scope="row">Distance from main campus</th>{chosen.map(place => { const distance = distanceMetres(reference, place); return <td key={place.id}>{distance === null ? 'Location not verified' : distance < 1000 ? `${Math.round(distance / 10) * 10} m` : `${(distance / 1000).toFixed(1)} km`}<small>Straight-line distance</small></td>; })}</tr>
        <tr><th scope="row">Address</th>{chosen.map(place => <td key={place.id}>{place.address || 'Not supplied'}</td>)}</tr>
        <tr><th scope="row">Known relationship / source</th>{chosen.map(place => <td key={place.id}>{place.membershipNote || 'See the place’s source for current details.'}{safeLink(place.sourceUrl) && <a href={safeLink(place.sourceUrl)} target="_blank" rel="noreferrer">View source ↗</a>}</td>)}</tr>
      </tbody></table></div>}
    </div>}
    {tab === 'collections' && <div className="ct-panel">
      <h3>Named collections</h3><p>Saved on this browser. Exports and shared links include collection names and place references. Calendar events, account details and your device location are excluded. Use names you are happy to share.</p>
      {storageError && <p role="alert">{storageError}</p>}
      <div className="ct-row"><label>Collection name<input maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="Quiet revision spots" /></label><button type="button" onClick={addCollection} disabled={!name.trim() || !loaded}>Create collection</button></div>
      <div className="ct-row"><button type="button" onClick={exportCollections} disabled={!currentCollections.length}>Export {mode} collections</button><label className="ct-file">Import collections<input type="file" accept="application/json,.json" onChange={event => { void importCollections(event.target.files?.[0]); event.target.value = ''; }} /></label></div>
      {pendingImport && <div className="ct-preview"><h4>Review import</h4><ul>{pendingImport.map((row, index) => <li key={`${row.id}-${index}`}>{row.name} · {row.placeIds.length} places · {row.mode === 'demo' ? 'Sample mode' : 'Community mode'}{row.mode !== mode && ' (view this collection after switching modes)'}</li>)}</ul><p>Existing collections are preserved. References to unavailable places remain visible as unavailable.</p><div className="ct-row"><button type="button" onClick={() => mergeCollections(pendingImport)}>Add collections to this device</button><button type="button" onClick={() => setPendingImport(null)}>Cancel import</button></div></div>}
      {mode === 'live' && <div className="ct-account"><h4>Account copy</h4>{signedIn ? <><p>Load adds account collections to this device. Save previews a merge with your account; collections with the same reference use this device’s edits.</p><div className="ct-row"><button type="button" disabled={accountBusy} onClick={() => account('load')}>Load from account</button><button type="button" disabled={accountBusy || !currentCollections.length} onClick={() => account('prepare')}>Save to account…</button></div></> : <p>Sign in to load or save an account copy. Local collections work without an account.</p>}
        {accountPreview && <div className="ct-preview"><h4>Confirm account save</h4><p>{accountPreview.length} collections will be saved. Existing account collections with a matching reference will use your device’s edits. Unavailable or sample places are excluded from device collections.</p><ul>{accountPreview.map(row => <li key={row.id}>{row.name} · {row.placeIds.length} places</li>)}</ul><div className="ct-row"><button type="button" disabled={accountBusy} onClick={() => account('save')}>Confirm save to account</button><button type="button" onClick={() => setAccountPreview(null)}>Cancel</button></div></div>}
      </div>}
      {!currentCollections.length && <p className="ct-empty">Create your first collection in {mode === 'demo' ? 'sample' : 'community'} mode.</p>}
      {!!currentCollections.length && <label>Collection<select value={selectedCollection?.id || ''} onChange={event => { setActive(event.target.value); setSharedUrl(''); }}>{currentCollections.map(row => <option value={row.id} key={row.id}>{row.name} ({row.placeIds.length})</option>)}</select></label>}
      {selectedCollection && <div className="ct-collection"><h4>{selectedCollection.name}</h4><div className="ct-row"><button type="button" onClick={() => { try { setSharedUrl(collectionShareUrl(window.location.href, selectedCollection)); } catch (error) { setMessage(errorText(error)); } }}>Create share link</button><button type="button" onClick={() => { setCollections(rows => rows.filter(row => row.id !== selectedCollection.id || row.mode !== mode)); setSharedUrl(''); }}>Delete local collection</button></div>
        {sharedUrl && <LinkActions key={sharedUrl} url={sharedUrl} label={selectedCollection.name} />}
        <ul className="ct-saved">{selectedCollection.placeIds.map(id => <li key={id}>{placeById.has(id) ? <button type="button" onClick={() => onSelect(id)}>{placeById.get(id)!.name}</button> : <span>Unavailable place ({id})</span>}<button type="button" aria-label={`Remove ${placeById.get(id)?.name || id} from collection`} onClick={() => updateCollection({ ...selectedCollection, placeIds: selectedCollection.placeIds.filter(value => value !== id) })}>Remove</button></li>)}</ul>
        <label>Add places<input value={collectionQuery} onChange={event => setCollectionQuery(event.target.value)} placeholder="Search known places" /></label><div className="ct-picker">{collectionCandidates.map(place => <label key={place.id}><input type="checkbox" checked={selectedCollection.placeIds.includes(place.id)} disabled={selectedCollection.placeIds.length >= 120 && !selectedCollection.placeIds.includes(place.id)} onChange={() => updateCollection({ ...selectedCollection, placeIds: selectedCollection.placeIds.includes(place.id) ? selectedCollection.placeIds.filter(id => id !== place.id) : [...selectedCollection.placeIds, place.id] })} />{place.name}</label>)}</div>
      </div>}
      {message && <p role="status" className="ct-note">{message}</p>}
    </div>}
    {tab === 'timetable' && <div className="ct-panel">
      <h3>Your next lectures</h3><p>Import an .ics timetable from your calendar. The file is read on this device, never uploaded or saved by this tool. Events disappear when this page closes. We show the next 90 days, up to 1,000 occurrences.</p>
      <label>Timezone for dates with no timezone<input value={timeZone} onChange={event => setTimeZone(event.target.value)} placeholder="Europe/London" /></label><p className="ct-note">Times with a calendar timezone keep that timezone. Dates without one use the setting above. Displayed lecture times use London time.</p>
      <div className="ct-row"><label className="ct-file">Import timetable (.ics, up to 512 KB)<input type="file" accept="text/calendar,.ics" onChange={event => { void importCalendar(event.target.files?.[0]); event.target.value = ''; }} /></label>{calendar && <button type="button" onClick={() => { setCalendar(null); setManual({}); setDraftMatches({}); }}>Clear timetable</button>}</div>
      {calendarError && <p role="alert">{calendarError}</p>}
      {calendar && <><p>{calendar.events.length} occurrences loaded from {calendar.sourceEvents} calendar events. Matches point to a known place or building, never a confirmed room entrance. Check your timetable for the exact room.</p>{!!calendar.warnings.length && <details className="ct-warnings"><summary>{calendar.warnings.length} import warnings — some events were skipped</summary><ul>{calendar.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        {!upcoming.length && <p className="ct-empty">No upcoming events in this date range. Check the import warnings or export another date range.</p>}
        <ol className="ct-events">{upcoming.map(event => {
          const matches = matchTimetableLocation(event.location, currentPlaces); const matched = manual[event.id] ? placeById.get(manual[event.id]) : matches.length === 1 ? matches[0] : undefined;
          return <li key={event.id}><time dateTime={event.start}>{event.allDay ? `${event.date} · All day` : new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.start))}</time><h4>{event.title}</h4><p>{event.location || 'No location in this event'}</p>
            {matched ? <div className="ct-row"><button type="button" onClick={() => onSelect(matched.id)}>Open {matched.name}</button><span className="ct-note">{manual[event.id] ? 'You confirmed this match' : 'Exact place / alias match'}{distanceMetres(reference, matched) === null ? ' · location not mapped' : ''}</span></div> : <p className="ct-note">{matches.length > 1 ? 'Several places match this name. Confirm the right one.' : 'No exact known place match. Choose a known building only if you can confirm it.'}</p>}
            <details><summary>{matched ? 'Change place match' : 'Match a place'}</summary><label>Known place<select value={draftMatches[event.id] || ''} onChange={e => setDraftMatches(values => ({ ...values, [event.id]: e.target.value }))}><option value="">Select the known place…</option>{currentPlaces.filter(place => !place.demo).map(place => <option value={place.id} key={place.id}>{place.name}</option>)}</select></label><button type="button" disabled={!draftMatches[event.id]} onClick={() => setManual(values => ({ ...values, [event.id]: draftMatches[event.id] }))}>Confirm this place</button><p className="ct-note">Your match stays in this page only. It does not add a room or change the map.</p></details>
          </li>;
        })}</ol>{calendar.events.filter(event => Date.parse(event.end) >= clock).length > 80 && <p>Showing the next 80 events. Reimport a shorter date range to focus your timetable.</p>}</>}
      <details className="ct-warnings"><summary>Supported calendar formats</summary><p>UTC, named IANA timezones, all-day events, daily and weekly repeats, added dates and excluded dates. Complex repeats, custom unknown timezones and edited recurrence series are skipped with a warning. No calendar attendees, descriptions or organisers are retained.</p></details>
    </div>}
    {tab === 'study' && <div className="ct-panel"><h3>Official study resources</h3><p>Live availability and bookings are supplied by UCL. This app does not estimate empty seats or promise a booking.</p><div className="ct-resources">{studyResources.map(resource => <a href={resource.url} key={resource.url} target="_blank" rel="noreferrer"><strong>{resource.name} ↗</strong><span>{resource.detail}</span><small>ucl.ac.uk</small></a>)}</div></div>}
  </section>;
}
