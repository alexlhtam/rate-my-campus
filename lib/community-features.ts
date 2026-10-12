import type { Database } from "./db";

export type PlaceSummary = { placeId: string; count: number; rating: number; recommend: number; criteria: Record<string, number>; tags: { tag: string; count: number }[] };

/** Aggregation happens in Postgres over every approved review, never a truncated feed. */
export async function placeSummaries(db: Database): Promise<PlaceSummary[]> {
  const result = await db.batch([
    db.prepare("SELECT place_id, count(*) AS count, avg(rating) AS rating, avg(recommend) * 100 AS recommend FROM reviews WHERE status = 'approved' GROUP BY place_id"),
    db.prepare("SELECT place_id, criterion.key, avg(criterion.value::double precision) AS score FROM reviews CROSS JOIN LATERAL jsonb_each_text(criteria::jsonb) AS criterion WHERE status = 'approved' GROUP BY place_id, criterion.key"),
    db.prepare("SELECT place_id, min(tag) AS tag, count(DISTINCT reviews.id) AS count FROM reviews CROSS JOIN LATERAL jsonb_array_elements_text(tags::jsonb) AS tag WHERE status = 'approved' GROUP BY place_id, lower(tag) ORDER BY count(DISTINCT reviews.id) DESC, min(tag) ASC"),
  ]);
  return result[0].results.map((row) => ({ placeId: String(row.place_id), count: Number(row.count), rating: Number(row.rating), recommend: Math.round(Number(row.recommend)),
    criteria: Object.fromEntries(result[1].results.filter((item) => item.place_id === row.place_id).map((item) => [String(item.key), Number(item.score)])),
    tags: result[2].results.filter((item) => item.place_id === row.place_id).slice(0, 8).map((item) => ({ tag: String(item.tag), count: Number(item.count) })),
  }));
}

/** Only retry transient provider errors. A moderation verdict is never an error or retried. */
export async function retryModeration<T>(work: () => Promise<T>, wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> {
  try { return await work(); }
  catch (error) {
    const status = typeof error === "object" && error !== null ? (error as { status?: number }).status : undefined;
    if (![429, 502, 504].includes(status || 0)) throw error;
    await wait(500);
    return work();
  }
}

export function pageOffset(value: string | null): number {
  return value && /^\d{1,7}$/.test(value) ? Math.min(Number(value), 1_000_000) : 0;
}
