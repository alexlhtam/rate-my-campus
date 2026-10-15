import type {EventFeedMetadata} from './view';

type Row=Record<string,unknown>;
const failure='Union events could not refresh. Please try again.';
const object=(value:unknown):value is Row=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string';
const timestamp=(value:unknown):value is string=>text(value)&&Number.isFinite(Date.parse(value));
const nullableText=(value:unknown)=>value==null||text(value);
const strings=(value:unknown)=>Array.isArray(value)&&value.every(text);
function date(value:unknown):value is string {
  return text(value)&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
function metadata(value:Row):EventFeedMetadata {
  const status=value.importStatus;
  if(!['ready','disabled','setup_required'].includes(String(status))||typeof value.importReady!=='boolean'||value.importReady!==(status==='ready'))throw new Error(failure);
  const scan=value.lastScan;
  if(scan!==null&&(!object(scan)||!date(scan.start_date)||!date(scan.end_date)||scan.end_date<=scan.start_date||!timestamp(scan.updated_at)||!['discovering','running','paused','complete','partial','failed'].includes(String(scan.status))||![0,1].includes(Number(scan.exhausted))||typeof scan.exhausted!=='number'||typeof scan.coverageComplete!=='boolean'||scan.coverageComplete&&(scan.status!=='complete'||scan.exhausted!==1)))throw new Error(failure);
  return {
    importReady:value.importReady,
    importStatus:status as EventFeedMetadata['importStatus'],
    lastScan:scan===null?null:{start_date:scan.start_date as string,end_date:scan.end_date as string,updated_at:scan.updated_at as string,status:scan.status as string,exhausted:scan.exhausted as number,coverageComplete:scan.coverageComplete as boolean},
  };
}
function validPost(value:unknown):value is Row {
  if(!object(value)||!text(value.id)||!value.id.trim()||!['event','freebie'].includes(String(value.type))||value.status!=='approved'||!text(value.title)||!value.title.trim()||!text(value.description)||!text(value.location)||!timestamp(value.expiresAt)||value.startsAt!=null&&!timestamp(value.startsAt)||!strings(value.dietary))return false;
  if(value.lat!=null&&(typeof value.lat!=='number'||!Number.isFinite(value.lat)||Math.abs(value.lat)>90)||value.lng!=null&&(typeof value.lng!=='number'||!Number.isFinite(value.lng)||Math.abs(value.lng)>180))return false;
  const details=value.freebie;
  if(details==null)return true;
  if(!object(details)||!strings(details.conditions)||!Array.isArray(details.freebies)||!details.freebies.every(item=>object(item)&&text(item.item)&&text(item.evidence)&&text(item.category)&&['confirmed','possible'].includes(String(item.certainty))))return false;
  if(details.society!=null&&(!object(details.society)||!text(details.society.name)||!text(details.society.evidence)))return false;
  if(details.dietary!=null&&(!Array.isArray(details.dietary)||!details.dietary.every(item=>object(item)&&text(item.tag)&&text(item.evidence))))return false;
  return ['free','paid','mixed','unknown'].includes(String(details.admission))&&nullableText(details.priceDetails)&&nullableText(details.eligibility)&&nullableText(details.bookingUrl)&&(details.eventEnd==null||timestamp(details.eventEnd));
}

/** A failed later page never replaces the caller's previously displayed feed. */
export async function loadEventFeed({signal,fetcher=fetch}:{signal?:AbortSignal;fetcher?:typeof fetch}={}):Promise<{posts:Row[];metadata:EventFeedMetadata}> {
  const posts=new Map<string,Row>();
  let offset:number|null=0,first:EventFeedMetadata|null=null;
  const checkCancelled=()=>{if(signal?.aborted)throw new DOMException('Event loading was cancelled.','AbortError')};
  try{
    while(offset!==null){
      checkCancelled();
      const response=await fetcher('/api/freebies/feed?offset='+offset,{signal,cache:'no-store'});
      if(!response.ok)throw new Error(failure);
      const body:unknown=await response.json();
      checkCancelled();
      if(!object(body)||!Array.isArray(body.posts)||body.posts.length>50||!body.posts.every(validPost))throw new Error(failure);
      const next=body.nextOffset;
      if(next!==null&&(typeof next!=='number'||!Number.isInteger(next)||next<=offset||next>10000||body.posts.length===0))throw new Error(failure);
      const pageMetadata=metadata(body);
      if(!first)first=pageMetadata;
      for(const post of body.posts)posts.set(post.id as string,post);
      offset=next as number|null;
    }
    return {posts:[...posts.values()],metadata:first!};
  }catch{
    checkCancelled();
    throw new Error(failure);
  }
}
