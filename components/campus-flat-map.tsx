'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Plus, Minus, LocateFixed, Star, Gift, Utensils, Tag, Navigation } from 'lucide-react';
import CampusBuildings from './campus-buildings';

export type MapPosition = { lat: number; lng: number };
export type MapProvider = 'google' | 'openstreetmap' | 'unavailable';
export type MapItem = MapPosition & { id: string; name?: string; title?: string; type?: string; score?: string };
type Props = {
  items: MapItem[]; onSelect: (id: string) => void; selected?: string; confirm?: boolean;
  initialPosition?: MapPosition; requireGoogle?: boolean;
  focusView?: {position: MapPosition; zoom: number};
  directoryOverlay?: boolean;
  onRecenter?: () => void;
  onPosition?: (position: MapPosition) => void;
  onProviderChange?: (provider: MapProvider) => void;
};
type Coverage = { north: number; south: number; east: number; west: number; zoom: number; copyright: string };
type Drag = { pointerId: number; x: number; y: number; cx: number; cy: number; start: MapPosition; last: MapPosition; moved: boolean };
const campus = { lat: 51.5244, lng: -0.1324 };
const icons: Record<string, typeof Star> = { rated: Star, food: Utensils, freebie: Gift, deal: Tag };
const project = (lat: number, lng: number, z: number) => {
  const n = 256 * 2 ** z, s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
  return { x: (lng + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
};
const unproject = (x: number, y: number, z: number): MapPosition => {
  const n = 256 * 2 ** z;
  return { lng: Math.max(-179.9, Math.min(179.9, x / n * 360 - 180)), lat: Math.max(-85, Math.min(85, 180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))))) };
};
const validPosition = (position?: MapPosition) => position && Number.isFinite(position.lat) && Number.isFinite(position.lng) && Math.abs(position.lat) <= 85 && Math.abs(position.lng) <= 179.9 ? position : campus;
async function readJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Map service unavailable');
  return await response.json() as T;
}

export default function CampusFlatMap({ items, onSelect, selected, confirm, initialPosition, requireGoogle = false, onPosition, onProviderChange, focusView, directoryOverlay = false, onRecenter }: Props) {
  const container = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [center, setCenter] = useState<MapPosition>(() => validPosition(initialPosition));
  const [zoom, setZoom] = useState(confirm ? 16 : 17);
  const [connection, setConnection] = useState<'checking' | 'google' | 'openstreetmap'>('checking');
  const [session, setSession] = useState('');
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [notice, setNotice] = useState('');
  const providerCallback = useRef(onProviderChange);
  providerCallback.current = onProviderChange;

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!initialPosition) return;
    const next = validPosition(initialPosition);
    setCenter(previous => Math.abs(previous.lat - next.lat) < 0.0000001 && Math.abs(previous.lng - next.lng) < 0.0000001 ? previous : next);
  }, [initialPosition?.lat, initialPosition?.lng]);
  useEffect(() => {
    if (!focusView) return;
    setCenter(validPosition(focusView.position));
    setZoom(Math.max(10, Math.min(19, Math.round(focusView.zoom))));
  }, [focusView]);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    (async () => {
      try {
        const provider = await readJSON<{ provider?: string }>('/api/map/provider', controller.signal);
        if (provider.provider !== 'google') {
          if (current) { setConnection('openstreetmap'); setNotice('OpenStreetMap · Google Maps not connected'); }
          return;
        }
        const token = await readJSON<{ session?: string }>('/api/map/session', controller.signal);
        if (!token.session) throw new Error('No map session');
        if (current) { setSession(token.session); setConnection('google'); }
      } catch {
        if (current) { setConnection('openstreetmap'); setNotice('OpenStreetMap · Google Maps unavailable'); }
      }
    })();
    return () => { current = false; controller.abort(); };
  }, []);

  const point = project(center.lat, center.lng, zoom), left = point.x - size.w / 2, top = point.y - size.h / 2;
  const northwest = unproject(left, top, zoom), southeast = unproject(left + size.w, top + size.h, zoom);
  const covered = Boolean(coverage && coverage.zoom === zoom && northwest.lat <= coverage.north && southeast.lat >= coverage.south && northwest.lng >= coverage.west && southeast.lng <= coverage.east);

  // Fetch attribution for surrounding space so dragging remains smooth. Never
  // display Google imagery outside the area covered by its displayed attribution.
  useEffect(() => {
    if (connection !== 'google' || !session || !size.w || !size.h || covered) return;
    const controller = new AbortController();
    let current = true;
    const nw = unproject(point.x - size.w * 1.5, point.y - size.h * 1.5, zoom);
    const se = unproject(point.x + size.w * 1.5, point.y + size.h * 1.5, zoom);
    const next = { north: nw.lat, south: se.lat, west: nw.lng, east: se.lng, zoom };
    const query = new URLSearchParams({ session, zoom: String(zoom), north: String(next.north), south: String(next.south), east: String(next.east), west: String(next.west) });
    const timer = setTimeout(async () => {
      try {
        const metadata = await readJSON<{ copyright?: string }>(`/api/map/viewport?${query}`, controller.signal);
        if (!metadata.copyright?.trim()) throw new Error('Map attribution missing');
        if (current) { setCoverage({ ...next, copyright: metadata.copyright }); setNotice(''); }
      } catch {
        if (current) { setCoverage(null); setConnection('openstreetmap'); setNotice('OpenStreetMap · Google Maps unavailable'); }
      }
    }, 100);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [connection, session, center.lat, center.lng, zoom, size.w, size.h, covered]);

  const activeProvider: MapProvider = connection === 'google' && covered ? 'google'
    : connection !== 'google' && !requireGoogle ? 'openstreetmap' : 'unavailable';
  const waiting = connection === 'checking' || connection === 'google' && !covered;
  useEffect(() => { providerCallback.current?.(activeProvider); }, [activeProvider]);

  const tiles: { x: number; y: number }[] = [];
  if (size.w && size.h && activeProvider !== 'unavailable') {
    for (let x = Math.floor(left / 256); x <= Math.floor((left + size.w) / 256); x++) {
      for (let y = Math.floor(top / 256); y <= Math.floor((top + size.h) / 256); y++) {
        if (x >= 0 && y >= 0 && x < 2 ** zoom && y < 2 ** zoom) tiles.push({ x, y });
      }
    }
  }
  function finishDrag(commit: boolean, element: HTMLDivElement) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (element.hasPointerCapture(current.pointerId)) element.releasePointerCapture(current.pointerId);
    if (!commit) { setCenter(current.start); return; }
    if (confirm && current.moved) onPosition?.(current.last);
  }
  function recenter() {
    if (!confirm && onRecenter) { onRecenter(); return; }
    setCenter(campus); setZoom(confirm ? 16 : 17);
    if (confirm && activeProvider !== 'unavailable') onPosition?.(campus);
  }
  const attribution = activeProvider === 'google' ? coverage!.copyright : '© OpenStreetMap contributors';

  return <div className={'campus-map ' + (confirm ? 'confirm-map' : '')} ref={container} tabIndex={0} role="region"
    aria-label={confirm ? 'Confirm pin location. Drag the map or use arrow keys.' : 'Campus map. Use arrow keys to pan.'} style={{ touchAction: 'none' }}
    onPointerDown={event => {
      if (event.button !== 0 || activeProvider === 'unavailable' || (event.target as HTMLElement).closest('button,a,input')) return;
      const start = project(center.lat, center.lng, zoom);
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cx: start.x, cy: start.y, start: center, last: center, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4) return;
      current.moved = true;
      current.last = unproject(current.cx - event.clientX + current.x, current.cy - event.clientY + current.y, zoom);
      setCenter(current.last);
    }}
    onPointerUp={event => finishDrag(true, event.currentTarget)}
    onPointerCancel={event => finishDrag(false, event.currentTarget)}
    onLostPointerCapture={event => { if (drag.current) finishDrag(false, event.currentTarget); }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || activeProvider === 'unavailable') return;
      const offsets: Record<string, [number, number]> = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] };
      const offset = offsets[event.key];
      if (!offset) return;
      event.preventDefault();
      const next = unproject(point.x + offset[0], point.y + offset[1], zoom);
      setCenter(next);
      if (confirm) onPosition?.(next);
    }}
  >
    <div className={'map-tiles ' + activeProvider}>{tiles.map(tile => <img key={`${activeProvider}-${zoom}-${tile.x}-${tile.y}`} draggable={false} alt="" width="256" height="256"
      style={{ left: tile.x * 256 - left, top: tile.y * 256 - top }}
      src={activeProvider === 'google' ? `/api/map/tile/${zoom}/${tile.x}/${tile.y}?session=${encodeURIComponent(session)}` : `https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`}
      onError={activeProvider === 'google' ? () => { setCoverage(null); setConnection('openstreetmap'); setNotice('OpenStreetMap · Google Maps unavailable'); } : undefined}
    />)}</div>
    {activeProvider === 'openstreetmap' && <div className="map-shade" />}
    {!confirm && zoom >= 15 && activeProvider !== 'unavailable' && <CampusBuildings zoom={zoom} left={left} top={top} width={size.w} height={size.h} />}
    {activeProvider === 'unavailable' && <div role="status" className="map-provider-message" style={{ position: 'absolute', top: '45%', left: '12%', right: '12%', zIndex: 4, padding: 16, borderRadius: 14, background: '#fffdf8', textAlign: 'center', fontSize: 13 }}>
      {waiting ? 'Loading the map…' : 'Google Maps is unavailable. This matched location needs a Google map. Try again later, or reset to a manual campus location.'}
    </div>}
    {!confirm && activeProvider !== 'unavailable' && items.filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng)).map(item => {
      const position = project(item.lat, item.lng, zoom), Icon = icons[item.type || 'rated'] || Star;
      return <button type="button" key={item.id} className={`map-pin ${item.type || 'rated'} ${selected === item.id ? 'selected' : ''}`} style={{ left: position.x - left, top: position.y - top }}
        onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSelect(item.id); }}
        aria-pressed={selected === item.id} aria-label={`View ${item.name || item.title}`}>
        <Icon size={14} fill={item.type ? 'none' : 'currentColor'} />{!item.type && <b>{item.score || '—'}</b>}<span className="pin-tooltip">{item.name || item.title}</span>
      </button>;
    })}
    {confirm ? activeProvider !== 'unavailable' && <div className="confirm-cross" aria-hidden="true"><MapPin fill="#e96548" size={42} /></div> : !directoryOverlay && <>
      <div className="map-location"><span className="location-symbol"><MapPin size={17} /></span><span>Bloomsbury, London<small>Your UCL neighbourhood</small></span><span className="location-dot" /></div>
      <div className="map-status"><i /> Explore the neighbourhood</div>
      <div className="campus-label" style={{ left: project(51.5246, -0.134, zoom).x - left, top: project(51.5246, -0.134, zoom).y - top }}>UCL<span>YOU&apos;RE IN GOOD COMPANY</span></div>
    </>}
    <div className="map-controls">
      <button type="button" title="Zoom in" aria-label="Zoom in" disabled={zoom >= 19} onClick={() => setZoom(value => Math.min(value + 1, 19))}><Plus size={20} /></button>
      <button type="button" title="Zoom out" aria-label="Zoom out" disabled={zoom <= 10} onClick={() => setZoom(value => Math.max(value - 1, 10))}><Minus size={20} /></button>
      <button type="button" title="Back to UCL" aria-label="Back to UCL" onClick={recenter}><LocateFixed size={20} /></button>
    </div>
    {!confirm && !directoryOverlay && <div className="map-note"><Navigation size={17} /><span>A little local knowledge goes a long way.</span><span className="note-star">✳</span></div>}
    {activeProvider !== 'unavailable' && <div className="map-attribution">
      {activeProvider === 'google' ? <b aria-label="Google Maps">Google Maps · </b> : <span title={notice}>OpenStreetMap · </span>}
      <a href={activeProvider === 'google' ? 'https://maps.google.com' : 'https://www.openstreetmap.org/copyright'} target="_blank" rel="noreferrer">{attribution}</a>
      {!confirm && zoom >= 15 && <span className="building-attribution"> · Flat campus footprints · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></span>}
    </div>}
  </div>;
}
