'use client';

import { useEffect, useId, useMemo, useState } from 'react';

type Coordinate = [number, number];
type Ring = Coordinate[];
type FootprintFeature = {
  id?: string | number;
  properties?: { name?: string; heightMeters?: number; height_m?: number; height?: number; source?: string };
  geometry?: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
};
export type CampusFootprints = { type: 'FeatureCollection'; features: FootprintFeature[] };
export type CampusViewport = { zoom: number; left: number; top: number; width: number; height: number };
type Point = { x: number; y: number };
type Wall = { points: string; fill: string };
type Building = { id: string; name: string; roof: string; base: string; walls: Wall[]; depth: number; shadowX: number; shadowY: number };

// The checked-in OSM extract is intentionally limited to these campus buildings.
// This additional bound prevents a wider replacement dataset raising Bloomsbury.
const bounds = { west: -0.1363, east: -0.1305, south: 51.5222, north: 51.5265 };
const groundResolution = (latitude: number, zoom: number) => 156543.033928 * Math.cos(latitude * Math.PI / 180) / 2 ** zoom;
const project = ([lng, lat]: Coordinate, zoom: number): Point => {
  const scale = 256 * 2 ** zoom;
  const sine = Math.sin(lat * Math.PI / 180);
  return { x: (lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale };
};
const signedArea = (ring: Point[]) => ring.reduce((area, point, index) => {
  const next = ring[(index + 1) % ring.length];
  return area + point.x * next.y - next.x * point.y;
}, 0) / 2;
const pathFor = (rings: Point[][], dx = 0, dy = 0) => rings.map(ring => ring.map((point, index) => `${index ? 'L' : 'M'}${(point.x + dx).toFixed(2)},${(point.y + dy).toFixed(2)}`).join(' ') + ' Z').join(' ');

/** Pure projection shared by rendering and geometry checks. Ground footprints
 * remain exactly on the flat map; only their roofs rise toward the upper left. */
export function buildCampusScene(data: CampusFootprints, viewport: CampusViewport): Building[] {
  const { zoom, left, top, width, height } = viewport;
  if (zoom < 15 || width <= 0 || height <= 0 || !Array.isArray(data?.features)) return [];
  const buildings: Building[] = [];
  for (const [featureIndex, feature] of data.features.entries()) {
    if (!feature.geometry) continue;
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
    for (const [polygonIndex, polygon] of polygons.entries()) {
      if (!Array.isArray(polygon) || !polygon[0]?.length) continue;
      const geographicRings = polygon.filter(ring => Array.isArray(ring) && ring.length >= 4);
      if (!geographicRings.length) continue;
      if (geographicRings.some(ring => ring.some(coordinate => !Array.isArray(coordinate) || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]) || coordinate[0] < bounds.west || coordinate[0] > bounds.east || coordinate[1] < bounds.south || coordinate[1] > bounds.north))) continue;
      const rings = geographicRings.map(ring => {
        const points = ring.map(coordinate => { const point = project(coordinate, zoom); return { x: point.x - left, y: point.y - top }; });
        const first = points[0], last = points[points.length - 1];
        if (first.x === last.x && first.y === last.y) points.pop();
        return points;
      });
      const exterior = rings[0];
      if (exterior.length < 3 || Math.abs(signedArea(exterior)) < 3) continue;
      const latitude = geographicRings[0].reduce((sum, coordinate) => sum + coordinate[1], 0) / geographicRings[0].length;
      const rawHeight = Number(feature.properties?.heightMeters ?? feature.properties?.height_m ?? feature.properties?.height ?? 12);
      const metres = Number.isFinite(rawHeight) ? Math.max(3, Math.min(70, rawHeight)) : 12;
      const rise = Math.min(240, metres / groundResolution(latitude, zoom));
      const roofX = -rise * 0.42, roofY = -rise * 0.76;
      const minX = Math.min(...exterior.map(point => point.x)) + roofX;
      const maxX = Math.max(...exterior.map(point => point.x));
      const minY = Math.min(...exterior.map(point => point.y)) + roofY;
      const maxY = Math.max(...exterior.map(point => point.y));
      if (maxX < -30 || maxY < -30 || minX > width + 30 || minY > height + 30) continue;
      const walls: Wall[] = [];
      for (const [ringIndex, ring] of rings.entries()) {
        const orientation = Math.sign(signedArea(ring)) * (ringIndex === 0 ? 1 : -1);
        for (const [index, a] of ring.entries()) {
          const b = ring[(index + 1) % ring.length];
          const normalX = (b.y - a.y) * orientation, normalY = (a.x - b.x) * orientation;
          // Only the near-facing walls are visible in this fixed oblique view.
          if (normalX * -roofX + normalY * -roofY <= 0) continue;
          const points = [a, b, { x: b.x + roofX, y: b.y + roofY }, { x: a.x + roofX, y: a.y + roofY }];
          walls.push({ points: points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '), fill: Math.abs(normalX) > Math.abs(normalY) ? '#e3e8e4' : '#c7ceca' });
        }
      }
      buildings.push({
        id: `${feature.id ?? featureIndex}-${polygonIndex}`, name: feature.properties?.name || 'Campus building',
        roof: pathFor(rings, roofX, roofY), base: pathFor(rings), walls,
        depth: maxY + maxX * 0.22, shadowX: Math.max(2, rise * 0.13), shadowY: Math.max(3, rise * 0.19),
      });
    }
  }
  return buildings.sort((a, b) => a.depth - b.depth);
}

let footprintsRequest: Promise<CampusFootprints> | undefined;
function loadFootprints() {
  if (!footprintsRequest) footprintsRequest = fetch('/data/campus-buildings.geojson')
    .then(async response => {
      if (!response.ok) throw new Error('Campus footprints unavailable');
      const data = await response.json() as CampusFootprints;
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid campus footprints');
      return data;
    }).catch(error => { footprintsRequest = undefined; throw error; });
  return footprintsRequest;
}

export default function CampusBuildings(viewport: CampusViewport) {
  const [footprints, setFootprints] = useState<CampusFootprints | null>(null);
  const shadowId = useId().replace(/:/g, '');
  useEffect(() => {
    let mounted = true;
    loadFootprints().then(data => { if (mounted) setFootprints(data); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  const buildings = useMemo(() => footprints ? buildCampusScene(footprints, viewport) : [], [footprints, viewport.zoom, viewport.left, viewport.top, viewport.width, viewport.height]);
  if (!buildings.length) return null;
  return <svg className="campus-buildings" width={viewport.width} height={viewport.height} viewBox={`0 0 ${viewport.width} ${viewport.height}`} aria-hidden="true"
    style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1, overflow: 'hidden' }}>
    <defs><filter id={shadowId} x="-30%" y="-30%" width="170%" height="180%"><feGaussianBlur stdDeviation="2.4" /></filter></defs>
    <g fill="#48584a" opacity="0.14" filter={`url(#${shadowId})`}>
      {buildings.map(building => <path key={building.id} d={building.base} fillRule="evenodd" transform={`translate(${building.shadowX} ${building.shadowY})`} />)}
    </g>
    {buildings.map(building => <g key={building.id} data-building={building.name} strokeLinejoin="round">
      {building.walls.map((wall, index) => <polygon key={index} points={wall.points} fill={wall.fill} stroke="#bdc7c0" strokeWidth="0.65" />)}
      <path d={building.roof} fill="#fffffd" fillRule="evenodd" stroke="#bfc9c2" strokeWidth="0.8" />
      <path d={building.roof} fill="none" stroke="#ffffff" strokeWidth="0.4" opacity="0.85" transform="translate(-0.3 -0.3)" />
    </g>)}
  </svg>;
}
