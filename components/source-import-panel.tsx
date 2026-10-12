'use client';

import { useEffect, useState } from 'react';
import { Check, ExternalLink, Gift, LoaderCircle, MapPin, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import CampusMap, { type MapPosition, type MapProvider } from './campus-map';
import { places } from '@/lib/data';

type ImportStatus = { anthropic: boolean; google: boolean; unionImport: boolean; signedIn: boolean; verified: boolean; moderator: boolean };
type Draft = {
  title: string; description: string; location: string | null; startsAt: string | null; expiresAt: string | null;
  dietary: string[]; warnings: string[]; confidence: string;
};
type ImportResult = { pin: Draft; sourceUrl: string; sourceName: string; importedAt: string; evidence: string };
type PlaceMatch = MapPosition & { id: string; name: string; address: string; attributions?: { provider?: string; providerUri?: string }[] };
type Props = { onSubmitted?: (post: Record<string, unknown>) => void; onRequireAccount?: () => void };
const campus = { lat: 51.5246, lng: -0.134 };

export function londonDateTime(value: string | number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function londonDateTimeToISO(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a complete event date and time.');
  const nominal = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(nominal)) throw new Error('Enter a valid event date and time.');
  let actual = nominal;
  for (let iteration = 0; iteration < 2; iteration++) {
    const represented = Date.parse(`${londonDateTime(actual)}:00Z`);
    actual += nominal - represented;
  }
  if (londonDateTime(actual) !== value) throw new Error('This London time does not exist because the clocks change. Check the event time.');
  return new Date(actual).toISOString();
}

async function requestJSON<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || 'This request could not be completed. Please try again.');
  return result;
}

export default function SourceImportPanel({ onSubmitted, onRequireAccount }: Props) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [start, setStart] = useState(''), [expiry, setExpiry] = useState('');
  const [position, setPosition] = useState<MapPosition>(campus);
  const [locationSource, setLocationSource] = useState<'manual' | 'google'>('manual');
  const [mapProvider, setMapProvider] = useState<MapProvider>('unavailable');
  const [matches, setMatches] = useState<PlaceMatch[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');

  async function loadStatus() {
    try { setStatus(await requestJSON<ImportStatus>('/api/assist')); }
    catch { setError('Could not check the source import service. Try refreshing its status.'); }
  }
  useEffect(() => { void loadStatus(); }, []);
  const canImport = Boolean(status?.unionImport && status.anthropic && status.verified && status.moderator);
  const unavailable = !status ? 'Checking the import service…'
    : !status.unionImport ? 'Imports are paused until the operator confirms permission to reuse Union event listings and enables the source.'
    : !status.anthropic ? 'Connect Claude in the server settings to extract event details.'
    : !status.signedIn || !status.verified ? 'Sign in with your UCL email to continue.'
    : !status.moderator ? 'Only approved community moderators can import source listings.' : '';

  async function importEvent(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setBusy('import');
    try {
      const imported = await requestJSON<ImportResult>('/api/assist', { action: 'import-event', sourceUrl: sourceUrl.trim() });
      setResult(imported); setDraft(imported.pin); setStart(imported.pin.startsAt ? londonDateTime(imported.pin.startsAt) : '');
      setExpiry(imported.pin.expiresAt ? londonDateTime(imported.pin.expiresAt) : '');
      setPosition(campus); setLocationSource('manual'); setConfirmed(false); setMatches([]);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(''); }
  }
  async function findLocation() {
    if (!draft?.location?.trim()) return;
    setError(''); setBusy('location'); setConfirmed(false);
    try {
      const response = await requestJSON<{ places: PlaceMatch[] }>('/api/assist', { action: 'locate', text: draft.location });
      setMatches(response.places);
      if (!response.places.length) setError('No matching location was found. Choose a campus place or move the map manually.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(''); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (!draft || !result || !confirmed || !canImport) return;
    if (locationSource === 'google' && mapProvider !== 'google') { setError('Wait for the Google map, or reset to a manual campus location.'); return; }
    setBusy('submit');
    try {
      const ends = londonDateTimeToISO(expiry), begins = start ? londonDateTimeToISO(start) : null;
      if (Date.parse(ends) <= Date.now() || Date.parse(ends) > Date.now() + 7 * 86400000) throw new Error('Choose an expiry in the next seven days. Import later if the event is further away.');
      if (begins && Date.parse(begins) >= Date.parse(ends)) throw new Error('The event must start before this pin expires.');
      const response = await requestJSON<{ post: Record<string, unknown>; message?: string }>('/api/community/action', {
        action: 'post', type: 'freebie', title: draft.title, description: draft.description, location: draft.location,
        ...position, startsAt: begins, expiresAt: ends, dietary: draft.dietary, sourceUrl: result.sourceUrl,
        price: null, originalPrice: null,
      });
      setMessage(response.message || 'Your source pin has been submitted for moderation.');
      setDraft(null); setResult(null); setSourceUrl(''); setConfirmed(false); onSubmitted?.(response.post);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(''); }
  }

  return <section className="source-import-panel" style={{ borderTop: '1px solid #e8e3da', paddingTop: 22, marginTop: 26 }} aria-label="Society event imports">
    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><Gift size={19} />Society event imports</h3>
    <p className="fineprint">Import one public Students’ Union UCL listing, then check its offer, location and times. A free ticket alone does not count as free food or merchandise. The source is credited on every imported pin.</p>
    {!canImport && <p className="setup-note" role="status">{unavailable}</p>}
    <div className="button-row" style={{ marginBottom: 14 }}>
      <button type="button" className="text-link" onClick={loadStatus}><RefreshCw size={13} />Refresh status</button>
      {status && (!status.signedIn || !status.verified) && onRequireAccount && <button type="button" className="text-link" onClick={onRequireAccount}><ShieldCheck size={14} />Verify your account</button>}
    </div>
    {!draft && <form onSubmit={importEvent}>
      <label>Public Union event URL<input type="url" required maxLength={500} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://studentsunionucl.org/whats-on/…" disabled={!canImport || Boolean(busy)} /></label>
      <button type="submit" className="button coral full" disabled={!canImport || Boolean(busy) || !sourceUrl.trim()}>{busy === 'import' ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}Import a draft</button>
      <p className="fineprint">One source import per hour across the site. Nothing is published until you confirm the draft. This flow never creates demo activity.</p>
    </form>}
    {draft && result && <form onSubmit={submit}>
      <p className="source-link"><a href={result.sourceUrl} target="_blank" rel="noreferrer">Check original listing at {result.sourceName} <ExternalLink size={13} /></a></p>
      <p className="setup-note"><b>Offer found:</b> {result.evidence}</p>
      {draft.warnings?.length > 0 && <ul className="fineprint">{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      <label>Pin title<input required minLength={3} maxLength={100} value={draft.title} onChange={event => { setDraft({ ...draft, title: event.target.value }); setConfirmed(false); }} /></label>
      <label>Offer and event details<textarea rows={3} maxLength={1500} value={draft.description} onChange={event => { setDraft({ ...draft, description: event.target.value }); setConfirmed(false); }} /></label>
      <div className="form-columns">
        <label>Starts at (London time)<input type="datetime-local" value={start} onChange={event => { setStart(event.target.value); setConfirmed(false); }} /></label>
        <label>Pin expires (London time)<input type="datetime-local" required min={londonDateTime(Date.now())} max={londonDateTime(Date.now() + 7 * 86400000)} value={expiry} onChange={event => { setExpiry(event.target.value); setConfirmed(false); }} /></label>
      </div>
      <p className="fineprint">Unknown times stay blank. Confirm the advertised event end time; the pin expires within seven days.</p>
      <label>Meeting location<div className="input-with-button"><input required minLength={3} maxLength={150} value={draft.location || ''} onChange={event => { setDraft({ ...draft, location: event.target.value }); setConfirmed(false); setMatches([]); }} />
        <button type="button" onClick={findLocation} disabled={!status?.google || Boolean(busy) || !draft.location?.trim()}><MapPin size={14} />{busy === 'location' ? 'Finding…' : 'Find'}</button></div></label>
      {matches.length > 0 && <div className="source-location-results" style={{ padding: 10, background: '#f5f3ed', borderRadius: 10, marginBottom: 12 }}>
        <p className="fineprint">Location suggestions from Google Maps. Choose the correct public building.</p>
        {matches.map(match => <div key={match.id} style={{ marginBottom: 8 }}><button type="button" className="text-link" onClick={() => { setPosition({ lat: match.lat, lng: match.lng }); setLocationSource('google'); setConfirmed(false); }}><MapPin size={13} />{match.name}</button><small style={{ display: 'block' }}>{match.address}</small>
          {match.attributions?.map((attribution, index) => <small key={index} style={{ display: 'block' }}>{attribution.provider || ''}</small>)}</div>)}
      </div>}
      <label>Or choose a campus place<select defaultValue="" onChange={event => {
        const place = places.find(value => value.id === event.target.value);
        if (!place) return;
        setPosition({ lat: place.lat, lng: place.lng }); setLocationSource('manual'); setConfirmed(false); setMatches([]);
        setDraft({ ...draft, location: place.name });
      }}><option value="" disabled>Select a public campus location</option>{places.filter(place => !place.demo && ['study', 'lecture'].includes(place.category)).map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label>
      <div className="location-confirm">
        <CampusMap items={[]} onSelect={() => {}} confirm initialPosition={position} requireGoogle={locationSource === 'google'} onProviderChange={setMapProvider} onPosition={next => { setPosition(next); setConfirmed(false); }} />
        <span>Move the map to confirm the entrance · {position.lat.toFixed(5)}, {position.lng.toFixed(5)}</span>
      </div>
      {locationSource === 'google' && <button type="button" className="text-link" onClick={() => { setPosition(campus); setLocationSource('manual'); setMatches([]); setConfirmed(false); }}>Reset to a manual campus location</button>}
      <label>Dietary claims in the listing</label>
      <div className="tag-picker">{['vegetarian', 'vegan', 'halal', 'gluten-free'].map(tag => <button type="button" key={tag} className={draft.dietary.includes(tag) ? 'selected' : ''} onClick={() => { setDraft({ ...draft, dietary: draft.dietary.includes(tag) ? draft.dietary.filter(value => value !== tag) : [...draft.dietary, tag] }); setConfirmed(false); }}>{tag}</button>)}</div>
      <p className="fineprint">Use only claims explicitly stated by the source. Ingredients, availability and safety are not verified by this app.</p>
      <label className="checkbox-label" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '16px 0' }}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} style={{ width: 16, marginTop: 2 }} />I checked the original listing, free food or merchandise offer, times and map position.</label>
      <div className="button-row"><button type="button" className="button light" disabled={Boolean(busy)} onClick={() => { setDraft(null); setResult(null); setConfirmed(false); }}>Discard draft</button>
        <button type="submit" className="button coral" disabled={!canImport || !confirmed || Boolean(busy) || !expiry || locationSource === 'google' && mapProvider !== 'google'}>{busy === 'submit' ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Submit source pin</button></div>
    </form>}
    {error && <p role="alert" className="form-error" style={{ color: '#ac3d30', fontSize: 13, marginTop: 12 }}>{error}</p>}
    {message && <p role="status" className="setup-note">{message}</p>}
  </section>;
}
