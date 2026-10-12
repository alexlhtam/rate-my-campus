export const searchTags = ['quiet', 'plugs', 'wifi', 'late', 'accessible'] as const;
export type SearchTag = typeof searchTags[number];

/** Canonical capabilities, shared by model output and the evidence matcher. */
export function canonicalSearchTag(value: string): SearchTag | null {
  const tag = value.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(quiet|quiet areas?|quiet study|silent|silent study|low noise)$/.test(tag)) return 'quiet';
  if (/^(plugs?|plug sockets?|sockets?|power (outlets?|points?)|charging)$/.test(tag)) return 'plugs';
  if (/^(wi ?fi|good wi ?fi|great wi ?fi|reliable wi ?fi)$/.test(tag)) return 'wifi';
  if (/^(late|open late|late night)$/.test(tag)) return 'late';
  if (/^(accessible|wheelchair accessible|step free|step free access)$/.test(tag)) return 'accessible';
  return null;
}

/** Match positive recorded evidence, never infer a facility from its absence. */
export function matchesSearchTags(wanted: string[], evidence: string[], openLate: boolean): boolean {
  const positive = evidence.filter(tag => !/\b(no|not|without|poor|bad|unreliable|few|limited|inaccessible)\b/i.test(tag));
  return wanted.every(value => {
    const tag = canonicalSearchTag(value);
    if (tag === 'late') return openLate;
    if (!tag) return false;
    return positive.some(item => {
      if (canonicalSearchTag(item) === tag) return true;
      if (tag === 'quiet') return /\b(quiet|silent)\b/i.test(item);
      if (tag === 'plugs') return /\b(plugs?|sockets?|power (outlets?|points?))\b/i.test(item);
      if (tag === 'wifi') return /\bwi[ -]?fi\b/i.test(item);
      return /\b(wheelchair accessible|step[- ]free|accessible)\b/i.test(item);
    });
  });
}

/** A clarification leaves the map intact; failures retain their actionable reason. */
export async function readSearchResponse(response: Response) {
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Search returned an unreadable response. Please try again.'); }
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Search is unavailable. Please try again.');
  const filters = data?.filters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters) || typeof filters.query !== 'string' || !Array.isArray(filters.tags)) {
    throw new Error('Search returned incomplete filters. Please try again.');
  }
  if (typeof filters.clarification === 'string' && filters.clarification.trim()) {
    return { filters: null, message: filters.clarification.trim() };
  }
  const labels: Record<string, string> = { study: 'study spaces', lecture: 'lecture halls', halls: 'student halls', rental: 'rentals', building: 'campus buildings', food: 'leftover food', freebie: 'society freebies', deal: 'student deals' };
  const details = [filters.query, labels[filters.category] || labels[filters.layer] || 'campus places', ...filters.tags, ...(filters.dietary || []), filters.openNow ? 'open now' : '', filters.near ? `near ${filters.near}` : '', filters.radiusKm ? `within ${filters.radiusKm} km` : ''].filter(Boolean);
  return { filters, message: `Looking for ${details.join(' · ')}. Only recorded information is matched; missing details can limit results.` };
}

/** Conservative offline interpretation. It selects filters, never invents results. */
export function localSearchFilters(input: string) {
  let query = input.trim();
  // Remove the origin before inferring categories: "food near Ramsay Hall" is
  // a food search, and "near Science Library" does not mean a library search.
  const nearPattern = /\bnear(?: to)?\s+(.+?)(?=\s+(?:within|under|with|open\s+(?:now|late)|happening\s+now|late[- ]night)\b|$)/i;
  const near = query.match(nearPattern)?.[1]?.trim();
  if (near) query = query.replace(nearPattern, ' ');
  const lower = query.toLowerCase();
  const tags = [ /\bquiet\b/.test(lower) ? 'quiet' : '', /\b(plugs?|sockets?)\b/.test(lower) ? 'plugs' : '', /\bwi[ -]?fi\b/.test(lower) ? 'wifi' : '', /\b(open\s+late|late[- ]night)\b/.test(lower) ? 'late' : '' ].filter(Boolean);
  const openNow = /\b(open now|happening now)\b/.test(lower);
  // Singular "Hall" is often part of a venue name (for example Logan Hall).
  // Leave it as a name token rather than misclassifying that venue as a residence.
  let category = /\b(study|library|libraries)\b/.test(lower) ? 'study' : /\b(lectures?|theatres?)\b/.test(lower) ? 'lecture' : /\b(halls|accommodation)\b/.test(lower) ? 'halls' : null;
  const layer = /\b(leftovers?|free food)\b/.test(lower) ? 'food' : /\b(deal|discount)s?\b/.test(lower) ? 'deal' : /\b(?:freebies?|merch)\b/.test(lower) ? 'freebie' : category ? 'rated' : null;
  if (layer && layer !== 'rated') category = null;
  const dietary = ['vegan', 'vegetarian', 'halal', 'gluten-free'].filter(tag => new RegExp(`\\b${tag === 'gluten-free' ? 'gluten[ -]free' : tag}\\b`).test(lower));
  const radius = lower.match(/\b(?:within|under)\s+(\d+(?:\.\d+)?)\s*(km|kilometres?|m|metres?)\b/);
  const radiusKm = radius ? Number(radius[1]) / (/^k/.test(radius[2]) ? 1 : 1000) : undefined;
  const validRadius = radiusKm !== undefined && radiusKm >= .05 && radiusKm <= 50;
  if (validRadius) query = query.replace(/\b(?:within|under)\s+\d+(?:\.\d+)?\s*(km|kilometres?|m|metres?)\b/gi, ' ');
  if (tags.length || openNow || category || layer || dietary.length) query = query.replace(/\b(open now|happening now|open late|late[- ]night|quiet|plugs?|sockets?|wi[ -]?fi|study|spots?|spaces?|lectures?|theatres?|libraries|library|halls|accommodation|leftovers?|free food|deals?|discounts?|freebies?|merch|vegan|vegetarian|halal|gluten[ -]free|with|and|a|an|the|find|me|please)\b/gi, ' ');
  return { query: query.replace(/\s+/g, ' ').trim(), category, layer, tags, dietary, openNow, ...(near ? { near } : {}), ...(validRadius ? { radiusKm } : {}) };
}
