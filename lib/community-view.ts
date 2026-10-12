/** Public aggregates only: pending and hidden contributions never affect a score. */
export type ReviewRow = { id: string; placeId: string; rating: number; recommend?: boolean; criteria?: Record<string, number>; tags?: string[]; status?: string; demo?: boolean; term?: string; year?: number; createdAt?: string };
export function summarizePlace(reviews: ReviewRow[], placeId: string) {
  const rows = reviews.filter(row => row.placeId === placeId && (row.status === 'approved' || row.demo && !row.status));
  const values: Record<string, number[]> = {}, tags = new Map<string, { tag: string; count: number }>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.criteria || {})) if (Number.isFinite(value) && value >= 1 && value <= 5) (values[key] ||= []).push(value);
    for (const tag of new Set((row.tags || []).map(tag => tag.trim().toLowerCase()).filter(Boolean))) {
      const current = tags.get(tag); tags.set(tag, { tag: current?.tag || row.tags!.find(value => value.trim().toLowerCase() === tag)!.trim(), count: (current?.count || 0) + 1 });
    }
  }
  return { placeId, count: rows.length, rating: rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : null,
    recommend: rows.length ? Math.round(rows.filter(row => row.recommend).length / rows.length * 100) : null,
    criteria: Object.fromEntries(Object.entries(values).map(([key, scores]) => [key, scores.reduce((a, b) => a + b, 0) / scores.length])),
    tags: [...tags.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 8),
  };
}
export const criterionLabels: Record<string, string> = { comfort: 'Comfort', plugs: 'Plug sockets', wifi: 'Wi-Fi', noise: 'Quietness', accessibility: 'Accessibility', value: 'Value', cleanliness: 'Cleanliness', social: 'Social life', staff: 'Staff', location: 'Location', landlord: 'Responsiveness', deposit: 'Deposit return', damp: 'Damp-free' };
export function criteriaFor(category: string) {
  return category === 'building' ? ['comfort', 'wifi', 'accessibility'] : category === 'halls' ? ['value', 'cleanliness', 'social', 'staff', 'location'] : category === 'rental' ? ['landlord', 'deposit', 'damp', 'value', 'noise'] : ['comfort', 'plugs', 'wifi', 'noise', 'accessibility'];
}
export function reviewYear(row: { term?: string; year?: number }) { return row.year || Number(row.term?.match(/\b(20\d{2})\b/)?.[1]) || null; }
export function mergeRows<T extends Record<string, any>>(...sets: T[][]): T[] { return [...new Map(sets.flat().map(row => [row.id, row])).values()]; }
