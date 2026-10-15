import {INCIDENT_CATEGORIES,INCIDENT_SEVERITIES} from './model';

type Row=Record<string,unknown>;
export type IncidentFeed={incidents:Row[];own:Row[];resolved:Row[];myVotes:Record<string,string>;total:number};
const failure='Incident alerts could not refresh. Please try again.';
const object=(value:unknown):value is Row=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string';
const timestamp=(value:unknown):value is string=>text(value)&&Number.isFinite(Date.parse(value));
const coordinate=(value:unknown,limit:number)=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=limit;
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=0;

/** Rejects anything that is not an incident record so a bad response can never replace the displayed alerts. */
export function validIncident(value:unknown):value is Row {
  if(!object(value)||!text(value.id)||!/^[a-zA-Z0-9_-]{1,120}$/.test(value.id)||value.type!=='incident')return false;
  if(!INCIDENT_CATEGORIES.some(item=>item.id===value.category)||!INCIDENT_SEVERITIES.some(item=>item.id===value.severity))return false;
  if(!text(value.title)||!value.title.trim()||!text(value.description)||!text(value.location))return false;
  if(!coordinate(value.lat,90)||!coordinate(value.lng,180)||!timestamp(value.createdAt)||!timestamp(value.expiresAt))return false;
  if(!['approved','pending','hidden'].includes(String(value.status)))return false;
  if(value.resolvedAt!=null&&!timestamp(value.resolvedAt))return false;
  if(value.resolution!=null&&!['reporter','community','moderator'].includes(String(value.resolution)))return false;
  if(value.photoUrl!=null&&(!text(value.photoUrl)||!value.photoUrl.startsWith('/api/community/photo?key=')))return false;
  return count(value.confirmCount)&&count(value.clearCount)&&typeof value.own==='boolean';
}

export async function loadIncidentFeed({signal,fetcher=fetch}:{signal?:AbortSignal;fetcher?:typeof fetch}={}):Promise<IncidentFeed> {
  const checkCancelled=()=>{if(signal?.aborted)throw new DOMException('Incident loading was cancelled.','AbortError')};
  try{
    checkCancelled();
    const response=await fetcher('/api/incidents/feed',{signal,cache:'no-store'});
    if(!response.ok)throw new Error(failure);
    const body:unknown=await response.json();
    checkCancelled();
    if(!object(body)||!Array.isArray(body.incidents)||!Array.isArray(body.own)||!Array.isArray(body.resolved)||!Array.isArray(body.myVotes)||!count(body.total))throw new Error(failure);
    if(![...body.incidents,...body.own,...body.resolved].every(validIncident))throw new Error(failure);
    const myVotes:Record<string,string>={};
    for(const vote of body.myVotes){if(!object(vote)||!text(vote.targetId)||!['confirm','clear'].includes(String(vote.kind)))throw new Error(failure);myVotes[vote.targetId]=String(vote.kind);}
    return {incidents:body.incidents,own:body.own,resolved:body.resolved,myVotes,total:body.total};
  }catch{
    checkCancelled();
    throw new Error(failure);
  }
}
