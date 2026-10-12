import {readFoodDetails} from './food';
/** Browser persistence is untrusted and may be unavailable, full or from an older build. */
type Row = Record<string, unknown>;
export type DemoState = { reviews: Row[]; posts: Row[]; threads: Row[]; replies: Row[]; reports: Row[]; votes: Record<string, string>; foodFeedback: Record<string,{kind:string;at:number}> };
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown, limit = 20) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, limit).map(item => item.slice(0, 100)) : [];
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
const empty = (): DemoState => ({ reviews: [], posts: [], threads: [], replies: [], reports: [], votes: {}, foodFeedback: {} });
function parse(raw: string | null, max: number): unknown { if (!raw || raw.length > max) return null; try { return JSON.parse(raw); } catch { return null; } }
function base(row: Row): Row {
  return { id: row.id, demo: true, own: true,
    status: typeof row.status === 'string' && ['approved', 'pending', 'hidden', 'gone'].includes(row.status) ? row.status : 'approved',
    ...(typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt)) ? { createdAt: row.createdAt } : {}),
  };
}
export function parseDemoState(raw: string | null): DemoState {
  const value = parse(raw, 8 * 1024 * 1024); const result = empty();
  if (!object(value)) return result;
  const rows = (key: string) => Array.isArray(value[key]) ? value[key].filter((row): row is Row => object(row) && id(row.id)).slice(0, 1000) : [];
  result.reviews = rows('reviews').filter(row => id(row.placeId) && typeof row.rating === 'number' && Number.isFinite(row.rating) && row.rating >= 1 && row.rating <= 5).map(row => ({ ...base(row), placeId: row.placeId, rating: row.rating,
    text: text(row.text, 4000), tags: strings(row.tags), term: text(row.term, 80),
    ...(typeof row.recommend === 'boolean' ? { recommend: row.recommend } : {}),
    ...(typeof row.year === 'number' && Number.isInteger(row.year) && row.year >= 1970 && row.year <= 2100 ? { year: row.year } : {}),
    criteria: Object.fromEntries(Object.entries(object(row.criteria) ? row.criteria : {}).filter(([key, score]) => /^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(key) && typeof score === 'number' && Number.isFinite(score) && score >= 1 && score <= 5)),
  }));
  result.posts = rows('posts').filter(row => ['food', 'deal', 'freebie'].includes(String(row.type)) && typeof row.title === 'string' && typeof row.expiresAt === 'string' && Number.isFinite(Date.parse(row.expiresAt)) && typeof row.lat === 'number' && Number.isFinite(row.lat) && Math.abs(row.lat) <= 90 && typeof row.lng === 'number' && Number.isFinite(row.lng) && Math.abs(row.lng) <= 180).map(row => ({ ...base(row), type: row.type, title: text(row.title, 160), description: text(row.description, 3000), location: text(row.location, 300), lat: row.lat, lng: row.lng, expiresAt: row.expiresAt, dietary: strings(row.dietary),
    ...(typeof row.startsAt === 'string' && Number.isFinite(Date.parse(row.startsAt)) ? { startsAt: row.startsAt } : {}),
    ...(typeof row.image === 'string' && /^data:image\/(?:png|jpe?g|webp|gif);base64,/.test(row.image) && row.image.length <= 7 * 1024 * 1024 ? { image: row.image } : {}),
    ...(typeof row.price === 'number' && Number.isFinite(row.price) && row.price >= 0 ? { price: row.price } : {}),
    ...(typeof row.originalPrice === 'number' && Number.isFinite(row.originalPrice) && row.originalPrice >= 0 ? { originalPrice: row.originalPrice } : {}),
    collectionInstructions: text(row.collectionInstructions, 500),
    ...(row.type === 'food' ? {foodDetails:readFoodDetails(row.foodDetails),revision:typeof row.revision==='number'&&Number.isInteger(row.revision)&&row.revision>=0?row.revision:0,
      availabilityUpdatedAt:typeof row.availabilityUpdatedAt==='string'&&Number.isFinite(Date.parse(row.availabilityUpdatedAt))?row.availabilityUpdatedAt:row.createdAt,
      closureReason:['collected','ended','withdrawn','community-gone'].includes(String(row.closureReason))?row.closureReason:null,closedAt:typeof row.closedAt==='string'&&Number.isFinite(Date.parse(row.closedAt))?row.closedAt:null}:{}),
    ...(typeof row.portionsRemaining === 'number' && Number.isInteger(row.portionsRemaining) && row.portionsRemaining >= 0 && row.portionsRemaining <= 10000 ? { portionsRemaining: row.portionsRemaining } : {}),
  }));
  result.threads = rows('threads').filter(row => id(row.placeId)).map(row => ({ ...base(row), placeId: row.placeId, title: text(row.title, 160), text: text(row.text, 3000) }));
  result.replies = rows('replies').filter(row => id(row.threadId)).map(row => ({ ...base(row), threadId: row.threadId, text: text(row.text, 1500) }));
  result.reports = rows('reports').filter(row => id(row.targetId)).map(row => ({ ...base(row), targetId: row.targetId, reason: text(row.reason, 2000) }));
  result.votes = Object.fromEntries(Object.entries(object(value.votes) ? value.votes : {}).filter(([key, vote]) => id(key) && typeof vote === 'string' && ['helpful', 'unhelpful', 'still', 'gone'].includes(vote)).slice(0, 3000)) as Record<string, string>;
  result.foodFeedback=Object.fromEntries(Object.entries(object(value.foodFeedback)?value.foodFeedback:{}).filter(([key,row])=>id(key)&&object(row)&&['still','gone'].includes(String(row.kind))&&typeof row.at==='number'&&Number.isFinite(row.at)).slice(0,1000)) as DemoState['foodFeedback'];
  return result;
}
export function readSavedIDs(raw: string | null): string[] {
  const value = parse(raw, 131072);
  return Array.isArray(value) ? [...new Set(value.filter(id))].slice(0, 1000) : [];
}
export function safeStorageRead(key: string, storage?: Pick<Storage, 'getItem'>): string | null {
  try { return (storage ?? window.localStorage).getItem(key); } catch { return null; }
}
/** Omitting storage also guards browsers whose localStorage getter itself throws. */
export function safeStorageWrite(key: string, value: string, storage?: Pick<Storage, 'setItem'>): boolean {
  try { (storage ?? window.localStorage).setItem(key, value); return true; } catch { return false; }
}
