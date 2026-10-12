import type { Place } from './data';

export type Coordinates = { lat: number; lng: number };
export function hasCoordinates<T extends {lat?: number; lng?: number}>(place: T): place is T & Coordinates {
  return typeof place.lat === 'number' && typeof place.lng === 'number' && Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 85 && Math.abs(place.lng) <= 180;
}

/** Straight-line distance, not an inferred walking route or travel time. */
export function distanceKm(from: Coordinates, to: {lat?: number; lng?: number}): number | null {
  if (!hasCoordinates(from) || !hasCoordinates(to)) return null;
  const rad = Math.PI / 180, dLat = (to.lat - from.lat) * rad, dLng = (to.lng - from.lng) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function normalizePlaceSearch(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\bwi[\s-]?fi\b/g, 'wifi').replace(/\b(?:sockets?|power points?)\b/g, 'plugs')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Official aliases/address and factual tags are shared by building and room search. */
export function matchesPlaceSearch(place: Place, query: string, reviewTags: string[] = []): boolean {
  const haystack = normalizePlaceSearch([place.name, place.address, place.description, place.campus, ...(place.aliases || []), ...place.tags, ...reviewTags].join(' '));
  return normalizePlaceSearch(query).split(' ').filter(Boolean).every(word => haystack.includes(word));
}
