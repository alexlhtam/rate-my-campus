import {getDatabase} from '../db';
import {after} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {requireModerator,consumeRateLimit} from '../community-server';
import {assertSameOrigin,readLimitedBody,record,HttpError,privateInformationReason,safeId} from '../community-validation';
import {moderateContent,runtimeEnv,locatePlace} from '../integrations';
import {places} from '../data';
import {actOnScan,ScanError} from './pipeline';
import {dashboard} from './store';
import {publishFreebie,publicFreebie} from './publication';
import {resolveVenue} from './venues';
import {workFreebies} from './worker';
import {addDays,londonDate,londonMidnight} from './ucl';
import type {ProviderConfig} from './providers';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
function config(env:Record<string,unknown>):ProviderConfig {
 const value=(key:string,fallback='')=>typeof env[key]==='string'?String(env[key]).trim()||fallback:fallback;
 const threshold=Number(value('JEV_THRESHOLD','0.5'));
 return {jevKey:'',claudeKey:value('ANTHROPIC_API_KEY'),jevModel:value('JEV_MODEL','jev-latest'),claudeModel:value('FREEBIE_CLAUDE_MODEL','claude-haiku-5-5'),threshold:Number.isFinite(threshold)&&threshold>=0&&threshold<=1?threshold:0.5};
}
export function workerAuthorized(request:Request,env:Record<string,unknown>){
 const secret=String(env.CRON_SECRET||''),provided=request.headers.get('authorization')||'',expected='Bearer '+secret;
 return secret.length>=32&&Buffer.byteLength(provided)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(provided),Buffer.from(expected));
}
function workerUrl(env:Record<string,unknown>){
 try{const url=new URL(String(env.FREEBIE_WORKER_URL||''));if(url.username||url.password||url.search||url.hash||url.pathname!=='/api/freebies/worker')return null;if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))return null;return url.href;}catch{return null;}
}
async function continueWorker(env:Record<string,unknown>){
 const url=workerUrl(env);if(!url)return;
 // Trusted operator configuration only: never derive a credentialed callback
 // from Host/X-Forwarded-Host supplied on an incoming request.
 for(let attempt=0;attempt<3;attempt++){
  try{const response=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+String(env.CRON_SECRET)},signal:AbortSignal.timeout(5000)});if(response.ok)return;}catch{/* Retry delivery without logging credentials. */}
 }
 console.error('Freebie continuation delivery failed; saved progress can be recovered by the worker schedule or Import button.');
}
export async function freebiesRoute(request:Request,path:string[]) {
 try {
  const endpoint=path.join('/'),env=await runtimeEnv(),provider=config(env);
  const machine=['worker','daily'].includes(endpoint);
  if(machine&&!workerAuthorized(request,env))throw new HttpError(401,'Worker authorization required.');
  const db=getDatabase();
  if(!db)throw new HttpError(503,'The freebie service is not connected yet.');
  const publisher=(source:Parameters<typeof publishFreebie>[1],extraction:Parameters<typeof publishFreebie>[2],moderation?:Parameters<typeof publishFreebie>[4])=>publishFreebie(db,source,extraction,{places,privacy:privateInformationReason,moderate:text=>moderateContent(text,'pin'),resolve:venue=>resolveVenue(db,venue,places,env.GOOGLE_MAPS_API_KEY?locatePlace:undefined)},moderation);
  const connected=!!workerUrl(env)&&String(env.CRON_SECRET||'').length>=32;
  const enabled=env.UNION_IMPORT_ENABLED==='true';
  const launch=()=>after(async()=>{
   try{const result=await workFreebies(db,provider,publisher);if(result.more)await continueWorker(env);}catch{console.error('Freebie worker interrupted; checkpoints retained.');}
  });
  if(machine){
   if((endpoint==='worker'&&request.method!=='POST')||(endpoint==='daily'&&!['GET','POST'].includes(request.method)))throw new HttpError(405,'Unsupported worker method.');
   if(!enabled||!connected||!provider.claudeKey)throw new HttpError(503,'The import worker is not enabled and configured.');
   if(endpoint==='daily'){
    if(env.FREEBIE_DAILY_IMPORT_ENABLED!=='true')return json({skipped:true,reason:'Daily imports are switched off.'});
    const today=londonDate();
    const existing=await db.prepare('SELECT id FROM freebie_scans WHERE active_slot=1 OR start_date=? LIMIT 1').bind(today).first();
    if(!existing){await consumeRateLimit('union-radar','scan-start',1,3600);await actOnScan(db,provider,{action:'start',startDate:today},publisher);}
   }
   launch();return json({accepted:true},202);
  }
  if(request.method==='GET'&&endpoint==='feed'){
   const params=new URL(request.url).searchParams,type=params.get('type');
   if(type!==null&&!['event','freebie'].includes(type))throw new HttpError(400,'Choose event or freebie.');
   const offset=Math.floor(Math.min(10000,Math.max(0,Number(params.get('offset'))||0))),now=Date.now();
   const end=londonMidnight(addDays(londonDate(new Date(now)),14)).getTime();
   const result=await db.prepare("SELECT * FROM posts WHERE type IN ('event','freebie') AND (?::text IS NULL OR type = ?) AND source_event_key IS NOT NULL AND status = 'approved' AND expires_at > ? AND starts_at < ? ORDER BY starts_at ASC,id ASC LIMIT 51 OFFSET ?").bind(type,type,now,end,offset).all<Record<string,unknown>>();
   const last=await db.prepare('SELECT start_date,end_date,updated_at,status,exhausted FROM freebie_scans ORDER BY ordinal DESC LIMIT 1').first<{start_date:string;end_date:string;updated_at:string;status:string;exhausted:number}>();
   // Only operational state is public. Scan errors, provider configuration and
   // source checkpoints remain in the authenticated moderator dashboard.
   const importStatus=!enabled?'disabled':!connected||!provider.claudeKey?'setup_required':'ready';
   const lastScan=last?{...last,coverageComplete:last.status==='complete'&&last.exhausted===1}:null;
   return json({posts:result.results.slice(0,50).map(publicFreebie),nextOffset:result.results.length>50?offset+50:null,lastScan,importReady:importStatus==='ready',importStatus});
  }
  const profile=await requireModerator();
  if(request.method==='GET'&&endpoint==='dashboard'){
   const id=new URL(request.url).searchParams.get('runId')||undefined;
   if(id&&(!/^[a-zA-Z0-9-]{1,80}$/.test(id)))throw new HttpError(400,'Invalid scan reference.');
   const history=await db.prepare('SELECT id,start_date,end_date,status,created_at FROM freebie_scans ORDER BY ordinal DESC LIMIT 20').all();
   return json({...await dashboard(db,provider,id),enabled,workerConnected:connected,dailyEnabled:env.FREEBIE_DAILY_IMPORT_ENABLED==='true',history:history.results});
  }
  if(request.method!=='POST')throw new HttpError(404,'This freebie endpoint does not exist.');
  assertSameOrigin(request);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(415,'Send JSON data.');
  let body:Record<string,unknown>;try{body=record(JSON.parse(new TextDecoder().decode(await readLimitedBody(request,4096))));}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'Invalid JSON.');}
  if(endpoint==='location'){
   await consumeRateLimit(profile.userId,'freebie-location',60,3600);
   const id=safeId(body.postId),place=places.find(item=>item.id===body.placeId&&!item.demo&&Number.isFinite(item.lat)&&Number.isFinite(item.lng));
   if(!place||body.confirmed!==true)throw new HttpError(400,'Choose and confirm a located campus place.');
   const row=await db.prepare("UPDATE posts SET lat=?,lng=?,location=?,source_location_revision=source_location_revision+1,freebie_json=jsonb_set(jsonb_set(jsonb_set(freebie_json::jsonb,'{placeId}',to_jsonb(?::text)),'{locationConfirmed}','true'::jsonb),'{locationProvider}','\"campus\"'::jsonb)::text WHERE id=? AND source_event_key IS NOT NULL AND COALESCE(freebie_json::jsonb->>'attendance','') <> 'online' RETURNING id").bind(place.lat!,place.lng!,place.name,place.id,id).first();
   if(!row)throw new HttpError(404,'This source pin could not be found.');
   return json({ok:true,message:'The building position is confirmed. Event room details remain as stated by the source.'});
  }
  if(endpoint!=='scan')throw new HttpError(404,'This freebie endpoint does not exist.');
  if(body.action!=='start')throw new HttpError(400,'Use Import next 14 days. Progress and retries are automatic.');
  if(!enabled)throw new HttpError(503,'Union imports are disabled until the operator confirms source permission.');
  if(!provider.claudeKey||!connected)throw new HttpError(503,'Configure Claude, CRON_SECRET and FREEBIE_WORKER_URL before importing.');
  await consumeRateLimit(profile.userId,'freebie-scan',30,3600);
  const active=await db.prepare('SELECT id FROM freebie_scans WHERE active_slot=1').first<{id:string}>();
  const latest=active?null:await db.prepare('SELECT id,start_date,status FROM freebie_scans ORDER BY ordinal DESC LIMIT 1').first<{id:string;start_date:string;status:string}>();
  // The explicit Import button recovers today's exhausted retry chain. Starting
  // over would repeat successful fetches and paid extraction checkpoints.
  const recover=latest&&latest.start_date===londonDate()&&['failed','partial','paused'].includes(latest.status)?latest:null;
  let result;
  if(active){
   await db.prepare('UPDATE freebie_scans SET auto_retries=0 WHERE id=?').bind(active.id).run();
   result=await dashboard(db,provider,active.id);
  }else if(recover){
   result=await actOnScan(db,provider,{action:'retry',runId:recover.id},publisher);
   await db.prepare('UPDATE freebie_scans SET auto_retries=0 WHERE id=?').bind(recover.id).run();
  }else{
   await consumeRateLimit('union-radar','scan-start',1,3600);
   result=await actOnScan(db,provider,{action:'start',startDate:londonDate()},publisher);
  }
  launch();
  return json({...result,enabled,workerConnected:connected},202);
 }catch(error){
  if(error instanceof HttpError||error instanceof ScanError)return json({error:error.message},error.status);
  console.error('Freebie request failed:',error instanceof Error?error.name:'UnknownError');
  return json({error:'The freebie service could not complete this request. Saved scan progress is retained. Check service configuration and the freebie database migration.'},503);
 }
}
