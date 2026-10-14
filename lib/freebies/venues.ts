import type {Database} from '../db';
import {matchCampusVenue,type LocatedPlace} from './publication';

export type VenueMatch = {lat:number;lng:number;placeId:string|null;provider:'campus'|'google';googlePlaceId?:string;validUntil?:number};
type GoogleResult={id:string;name:string;lat:number;lng:number;attributions?:unknown[]};
export type VenueLookup=(query:string)=>Promise<GoogleResult[]>;
const normalize=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/^ucl /,'').trim();
const inflight=new Map<string,Promise<VenueMatch|null>>();

export function campusVenue(value:string,places:LocatedPlace[]) {
  // Building-level position, never a fabricated room entrance.
  // https://www.ucl.ac.uk/staff-common-room/how-find-us
  const query=normalize(value);
  if(['wilkins north cloisters','north cloisters','housman room'].includes(query)){
    const building=places.find(place=>!place.parentPlaceId&&normalize(place.name)==='wilkins building');
    if(building&&Number.isFinite(building.lat)&&Number.isFinite(building.lng))return building;
  }
  return matchCampusVenue(value,places);
}
export async function resolveVenue(db:Database,value:string|null,places:LocatedPlace[],lookup?:VenueLookup,now=Date.now()):Promise<VenueMatch|null>{
  if(!value||/\b(online|virtual|zoom|teams|tbc|tba|to be confirmed|to be announced)\b/i.test(value))return null;
  const local=campusVenue(value,places);
  if(local)return {lat:local.lat!,lng:local.lng!,placeId:local.id,provider:'campus'};
  if(!lookup)return null;
  const key=normalize(value).slice(0,300);
  if(inflight.has(key))return inflight.get(key)!;
  const work=(async()=>{
    const row=await db.prepare('SELECT * FROM freebie_venues WHERE query=?').bind(key).first<{place_id:string|null;lat:number|null;lng:number|null;expires_at:number}>();
    if(row&&row.expires_at>now)return row.place_id&&row.lat!=null&&row.lng!=null?{lat:row.lat,lng:row.lng,placeId:null,provider:'google' as const,googlePlaceId:row.place_id,validUntil:row.expires_at}:null;
    const claim=await db.prepare('INSERT INTO freebie_venues(query,expires_at,lock_until) VALUES (?,0,?) ON CONFLICT(query) DO UPDATE SET lock_until=excluded.lock_until WHERE freebie_venues.lock_until < ? RETURNING query').bind(key,now+30000,now).first();
    if(!claim)throw new Error('This venue lookup is already running. It will be retried automatically.');
    try{
      const found=await lookup(value+' London');
      const candidates=found.filter(place=>normalize(place.name)===key&&place.lat>=51.35&&place.lat<=51.68&&place.lng>=-.35&&place.lng<=.1&&!place.attributions?.length);
      const match=candidates.length===1?candidates[0]:null;
      // Store only permitted Google ID/coordinate fields. Never cache its names,
      // addresses, photos or reviews. Short negative cache avoids repeated charges.
      const expiry=now+(match?30:1)*86400000;
      await db.prepare('UPDATE freebie_venues SET place_id=?,lat=?,lng=?,expires_at=?,lock_until=0 WHERE query=?').bind(match?.id??null,match?.lat??null,match?.lng??null,expiry,key).run();
      return match?{lat:match.lat,lng:match.lng,placeId:null,provider:'google' as const,googlePlaceId:match.id,validUntil:expiry}:null;
    }catch(error){await db.prepare('UPDATE freebie_venues SET lock_until=0 WHERE query=?').bind(key).run();throw error;}
  })();
  inflight.set(key,work);
  try{return await work;}finally{inflight.delete(key);}
}
