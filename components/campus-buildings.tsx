'use client';

import { useEffect, useMemo, useState } from 'react';

type Coordinate = [number, number];
type Ring = Coordinate[];
type FootprintFeature = {
  id?: string | number;
  properties?: { name?: string; affiliationVerified?: boolean; [key: string]: unknown };
  geometry?: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
};
export type CampusFootprints = { type: 'FeatureCollection'; features: FootprintFeature[] };
export type CampusViewport = { zoom: number; left: number; top: number; width: number; height: number };
type Point = { x: number; y: number };
type FlatFootprint = { id: string; name: string; path: string };

const project = ([lng, lat]: Coordinate, zoom: number): Point => {
  const scale = 256 * 2 ** zoom;
  const sine = Math.sin(lat * Math.PI / 180);
  return { x: (lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale };
};
const signedArea = (ring: Point[]) => ring.reduce((area, point, index) => {
  const next = ring[(index + 1) % ring.length];
  return area + point.x * next.y - next.x * point.y;
}, 0) / 2;
const validRing = (ring: Ring) => Array.isArray(ring) && ring.length >= 4
  && ring.every(coordinate => Array.isArray(coordinate) && coordinate.length >= 2
    && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1])
    && Math.abs(coordinate[0]) <= 180 && Math.abs(coordinate[1]) <= 85)
  && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
const pathFor = (rings: Point[][]) => rings.map(ring => ring.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ') + ' Z').join(' ');

/** The non-WebGL fallback uses true ground footprints, with no height or
 * perspective offsets. Campus membership comes from verified source evidence,
 * not a clipping rectangle; every valid interior ring remains a courtyard. */
export function buildCampusScene(data: CampusFootprints, viewport: CampusViewport): FlatFootprint[] {
  const { zoom, left, top, width, height } = viewport;
  if (![zoom, left, top, width, height].every(Number.isFinite) || zoom < 15 || zoom > 22 || width <= 0 || height <= 0 || !Array.isArray(data?.features)) return [];
  const footprints: FlatFootprint[] = [];
  for (const [featureIndex, feature] of data.features.entries()) {
    if (feature?.properties?.affiliationVerified !== true || !feature.geometry) continue;
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
    if (!Array.isArray(polygons)) continue;
    for (const [polygonIndex, polygon] of polygons.entries()) {
      // Reject invalid polygons as a whole rather than filling a missing hole.
      if (!Array.isArray(polygon) || !polygon.length || !polygon.every(validRing)) continue;
      const rings = polygon.map(ring => ring.slice(0, -1).map(coordinate => {
        const point = project(coordinate, zoom);
        return { x: point.x - left, y: point.y - top };
      }));
      if (rings.some(ring => Math.abs(signedArea(ring)) < 0.01)) continue;
      const exterior = rings[0];
      const minX = Math.min(...exterior.map(point => point.x));
      const maxX = Math.max(...exterior.map(point => point.x));
      const minY = Math.min(...exterior.map(point => point.y));
      const maxY = Math.max(...exterior.map(point => point.y));
      if (maxX < 0 || maxY < 0 || minX > width || minY > height) continue;
      footprints.push({ id: `${feature.id ?? featureIndex}-${polygonIndex}`, name: feature.properties.name || 'Campus building', path: pathFor(rings) });
    }
  }
  return footprints;
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
  useEffect(() => {
    let mounted = true;
    loadFootprints().then(data => { if (mounted) setFootprints(data); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  const buildings = useMemo(() => footprints ? buildCampusScene(footprints, viewport) : [], [footprints, viewport.zoom, viewport.left, viewport.top, viewport.width, viewport.height]);
  if (!buildings.length) return null;
  return <svg className="campus-buildings" width={viewport.width} height={viewport.height} viewBox={`0 0 ${viewport.width} ${viewport.height}`} aria-hidden="true"
    style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1, overflow: 'hidden' }}>
    {buildings.map(building => <path key={building.id} data-building={building.name} d={building.path}
      fill="#c6b5de" fillRule="evenodd" stroke="#a88ec2" strokeWidth="0.9" strokeLinejoin="round" />)}
  </svg>;
}
