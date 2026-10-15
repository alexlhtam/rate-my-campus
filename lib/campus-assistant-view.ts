import type { CampusAssistantResult, AssistantSuggestion } from './campus-assistant-types';
import type { Place } from './data';
import type { MapItem } from '../components/campus-map';

export const assistantMapId = (id: string) => `assistant:${id}`;
export function assistantHasLocation(item: AssistantSuggestion) {
  return typeof item.lat === 'number' && typeof item.lng === 'number' && Number.isFinite(item.lat) && Number.isFinite(item.lng);
}

/** These are private search overlays, never posts or synthetic review targets. */
export function withAssistantPins(items: MapItem[], suggestions: AssistantSuggestion[]): MapItem[] {
  const located = suggestions.filter(assistantHasLocation);
  const replaced = new Set(located.flatMap(item => item.placeId ? [item.placeId] : []));
  return [
    ...items.filter(item => !replaced.has(item.id)),
    ...located.map(item => ({id: assistantMapId(item.id), name: item.name, type: 'assistant', lat: item.lat!, lng: item.lng!, locationProvider: item.locationProvider})),
  ];
}

/** An exact catalogue name is already grounded and needs no paid lookup. */
export function directoryAnswer(place: Place): CampusAssistantResult {
  const urls = [...new Set([place.sourceUrl, ...(place.visitGuide || []).map(guide => guide.sourceUrl)].filter((url): url is string => !!url && url.startsWith('https://')))];
  const sources = urls.map((url, i) => ({id: `s${i + 1}`, url, title: i ? `${place.name}: visiting information` : `${place.name}: official information`}));
  const description = [place.description, ...(place.visitGuide || []).map(guide => guide.text)].join(' ');
  const sourceIds = sources.map(source => source.id);
  return {
    answer: `${place.name} is at ${place.address}.${place.lat !== undefined && place.lng !== undefined ? ' Its building is marked on the map.' : ' A precise map location is not recorded yet.'}${sources[0] ? ` [${sources[0].id}]` : ''}`,
    sources,
    suggestions: [{id: `campus:${place.id}`, placeId: place.id, name: place.name, description, address: place.address, lat: place.lat, lng: place.lng, locationProvider: 'campus', sourceIds}],
  };
}
