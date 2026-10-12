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
