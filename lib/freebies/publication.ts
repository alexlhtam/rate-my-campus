import type { Database } from '../db';
import type { Extraction, SourceEvent } from './types';
import type {VenueMatch} from './venues';

export type LocatedPlace = { id: string; name: string; aliases?: string[]; lat?: number; lng?: number; demo?: boolean; parentPlaceId?: string };
export type FreebieDetails = Extraction & { sourceEventId: string; eventStart: string; eventEnd: string | null; placeId: string | null; locationConfirmed: boolean; sourceVenue?:string|null; locationProvider?:'campus'|'google'; locationValidUntil?:number };
const normalise = (value: string) => value.normalize('NFKC').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function matchCampusVenue(value: string | null, places: LocatedPlace[]): LocatedPlace | null {
  if (!value) return null;
  const query=normalise(value);
  if (/\b(online|virtual|zoom|teams|tbc|tba)\b/i.test(value)) return null;
  const located=places.filter(place=>!place.demo&&Number.isFinite(place.lat)&&Number.isFinite(place.lng));
  const named=located.filter(place=>normalise(place.name)===query);
  const exact=named.length?named:located.filter(place=>[place.name,...(place.aliases||[])].some(name=>normalise(name)===query));
  const candidates=exact.length?exact:located.filter(place=>[place.name,...(place.aliases||[])].some(name=>normalise(name).length>=8&&(' '+query+' ').includes(' '+normalise(name)+' ')));
  if(candidates.length===1)return candidates[0];
  // Shared building aliases inherited by room pages can resolve to that same
  // building point. Distinct coordinates remain ambiguous.
  const building=candidates.filter(place=>!place.parentPlaceId);
  return building.length===1&&candidates.every(place=>place.lat===building[0].lat&&place.lng===building[0].lng)?building[0]:null;
}
async function postId(key: string) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  return 'freebie-'+Array.from(new Uint8Array(bytes)).map(value=>value.toString(16).padStart(2,'0')).join('').slice(0,32);
}
export type PublishDependencies = { places: LocatedPlace[]; moderate: (text: string)=>Promise<{approved:boolean;reasons:string[]}>; privacy: (text:string)=>string|null; resolve?:(venue:string|null)=>Promise<VenueMatch|null>; now?:()=>number };
/** All generated text is checked before publication. Failed providers never approve a pin. */
export async function publishFreebie(db: Database, source: SourceEvent, extraction: Extraction | null, deps: PublishDependencies) {
  // End-time edits update the occurrence, while separate recurrence start times
  // retain their own pins. Calendar ticket variants share the same occurrence.
  const key=source.id.split(':').slice(0,2).join(':');
  source={...source,id:key};
  const id=await postId(key), now=deps.now?.()??Date.now();
  if(!extraction?.hasFreebies){
    await db.prepare("UPDATE posts SET status = 'hidden', moderation_reason = 'The source no longer supports this offer.', source_checked_at = ?, moderation_revision = moderation_revision + 1 WHERE source_event_key = ? AND status = 'approved'").bind(now,source.id).run();
    return {id:null,state:'no_freebies'};
  }
  const existing=await db.prepare('SELECT id, status, moderation_revision, source_location_revision, freebie_json, location, lat, lng FROM posts WHERE source_event_key = ?').bind(source.id).first<Record<string,unknown>>();
  // A community closure or moderator decision always wins over another scan.
  if(existing&&(existing.status==='hidden'||existing.status==='gone'||Number(existing.moderation_revision)>0))return {id:String(existing.id),state:'held_by_moderator'};
  const manual=await db.prepare('SELECT id FROM posts WHERE source_url = ? AND source_event_key IS NULL').bind(source.url).first<{id:string}>();
  if(manual)return {id:manual.id,state:'already_imported'};
  const starts=Date.parse(source.start), sourceEnd=Date.parse(source.end||source.start), expires=Math.min(sourceEnd,now+14*86400000);
  if(!Number.isFinite(starts)||!Number.isFinite(expires)||expires<=now)return {id:existing?String(existing.id):null,state:'expired'};
  let previous: Partial<FreebieDetails>={};try{previous=JSON.parse(String(existing?.freebie_json||'{}'));}catch{/* Ignore incompatible older metadata. */}
  const online=extraction.attendance==='online';
  const venue=extraction.venue||source.sourceLocation;
  const place=online?null:matchCampusVenue(venue,deps.places);
  const resolved=online?null:deps.resolve?await deps.resolve(venue):place?{lat:place.lat!,lng:place.lng!,placeId:place.id,provider:'campus' as const}:null;
  const preserve=!online&&previous.locationConfirmed&&previous.sourceVenue===venue&&Number.isFinite(existing?.lat)&&Number.isFinite(existing?.lng);
  const details: FreebieDetails={...extraction,sourceEventId:source.id,eventStart:source.start,eventEnd:source.end,sourceVenue:venue,placeId:preserve?previous.placeId||null:resolved?.placeId||null,locationConfirmed:!!preserve,locationProvider:preserve?'campus':resolved?.provider,locationValidUntil:preserve?undefined:resolved?.validUntil};
  const title=source.title.slice(0,160), location=preserve?String(existing!.location):(extraction.venue||extraction.address||source.sourceLocation||'Location not stated — check the source').slice(0,300);
  const text=[title,location,JSON.stringify(details)].join('\n');
  const privacy=deps.privacy(text);
  // The moderation endpoint checks 8,000 characters. Hold oversized text instead
  // of silently displaying fields that were omitted from its check.
  let reason=privacy||(text.length>8000?'The event details need a moderator check.':null);
  let approved=false;
  if(!reason){const verdict=await deps.moderate(text);approved=verdict.approved;reason=verdict.approved?null:verdict.reasons.join('; ').slice(0,500)||'Held for a moderator check.';}
  if(!extraction.freebies.some(item=>item.certainty==='confirmed')){approved=false;reason='The listing offers items, but their cost is unclear. Check the original event.';}
  const status=approved?'approved':'pending';
  const row=await db.prepare(`INSERT INTO posts (id,user_id,type,title,description,location,lat,lng,starts_at,expires_at,source_url,source_name,dietary,status,moderation_reason,created_at,source_event_key,freebie_json,source_checked_at)
    VALUES (?,'system:union','freebie',?,?,?,?,?,?,?,?,'Students’ Union UCL',?,?,?,?,?,?,?)
    ON CONFLICT(source_event_key) DO UPDATE SET title=excluded.title,description=excluded.description,location=excluded.location,lat=excluded.lat,lng=excluded.lng,starts_at=excluded.starts_at,expires_at=excluded.expires_at,source_url=excluded.source_url,dietary=excluded.dietary,status=excluded.status,moderation_reason=excluded.moderation_reason,freebie_json=excluded.freebie_json,source_checked_at=excluded.source_checked_at
    WHERE posts.moderation_revision = 0 AND posts.source_location_revision = ? AND posts.status IN ('approved','pending') RETURNING id,status`)
    .bind(id,title,extraction.summary,location,preserve?existing!.lat:resolved?.lat??null,preserve?existing!.lng:resolved?.lng??null,starts,expires,source.url,JSON.stringify((extraction.dietary||[]).map(item=>item.tag)),status,reason,now,source.id,JSON.stringify(details),now,Number(existing?.source_location_revision||0)).first<{id:string;status:string}>();
  return {id:row?.id||String(existing?.id||id),state:row?.status==='approved'?'published':row?'needs_review':'held_by_moderator'};
}

export function publicFreebie(row: Record<string,unknown>) {
  let details: FreebieDetails|null=null;try{details=JSON.parse(String(row.freebie_json||'null'));}catch{/* Missing metadata stays absent. */}
  const expiredLocation=details?.locationProvider==='google'&&Number(details.locationValidUntil||0)<=Date.now();
  return {createdAt:new Date(Number(row.created_at)).toISOString(),id:String(row.id),type:'freebie',title:String(row.title),description:String(row.description),location:String(row.location),lat:expiredLocation?null:row.lat,lng:expiredLocation?null:row.lng,startsAt:row.starts_at==null?null:new Date(Number(row.starts_at)).toISOString(),expiresAt:new Date(Number(row.expires_at)).toISOString(),sourceUrl:row.source_url,sourceName:row.source_name,status:row.status,freebie:details,dietary:details?.dietary?.map(item=>item.tag)||[],sourceCheckedAt:row.source_checked_at?new Date(Number(row.source_checked_at)).toISOString():null};
}
