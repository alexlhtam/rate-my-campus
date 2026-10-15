import {getDatabase} from '../db';
import {consumeRateLimit,moderation,photoModeration,requireActiveWrite,requireVerified,retentionSweep,scheduleModeration} from '../community-server';
import {HttpError,assertSameOrigin,readLimitedBody,record,safeId,textField} from '../community-validation';
import {pageOffset} from '../community-features';
import {currentUser} from '../supabase';
import {incidentInput,incidentVoteKind} from './validation';
import {publicIncident} from './publication';
import {INCIDENT_CLEAR_QUORUM,categoryInfo,severityInfo} from './model';

type Row=Record<string,unknown>;
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const RECENTLY_RESOLVED_MS=3*3600000;
/** Non-owner responses only: a reporter cannot corroborate or clear their own heads-up. */
const counted="(SELECT count(*) FROM votes v WHERE v.target_id = i.id AND v.kind = 'confirm' AND v.user_id <> i.user_id) AS confirm_count, (SELECT count(*) FROM votes v WHERE v.target_id = i.id AND v.kind = 'clear' AND v.user_id <> i.user_id) AS clear_count";
const live="i.status = 'approved' AND i.expires_at > ? AND i.resolved_at IS NULL";

function database(){const db=getDatabase();if(!db)throw new HttpError(503,'Incident reporting is not connected yet. The demo still works.');return db;}

async function jsonBody(request:Request):Promise<Row>{
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new HttpError(415,'Send JSON data.');
 const bytes=await readLimitedBody(request,16*1024);
 try{return record(JSON.parse(new TextDecoder().decode(bytes)));}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'The request was not valid JSON.');}
}

async function feed(request:Request):Promise<Response>{
 const db=database(),now=Date.now(),userId=(await currentUser())?.userId||'';
 const offset=pageOffset(new URL(request.url).searchParams.get('offset'));
 const [active,total,own,resolved,votes]=await db.batch<Row>([
  db.prepare(`SELECT i.*, ${counted} FROM incidents i WHERE ${live} ORDER BY CASE i.severity WHEN 'urgent' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, i.created_at DESC, i.id DESC LIMIT 60 OFFSET ?`).bind(now,offset),
  db.prepare(`SELECT count(*) AS total FROM incidents i WHERE ${live}`).bind(now),
  // The reporter always sees their own pending or hidden heads-up with its moderation note.
  db.prepare(`SELECT i.*, ${counted} FROM incidents i WHERE i.user_id = ? AND i.user_id <> '' AND NOT (${live}) AND i.expires_at > ? ORDER BY i.created_at DESC LIMIT 20`).bind(userId,now,now),
  db.prepare(`SELECT i.*, ${counted} FROM incidents i WHERE i.status = 'approved' AND i.resolved_at IS NOT NULL AND i.resolved_at > ? ORDER BY i.resolved_at DESC LIMIT 20`).bind(now-RECENTLY_RESOLVED_MS),
  db.prepare("SELECT target_id, kind FROM votes WHERE user_id = ? AND user_id <> '' AND kind IN ('confirm','clear') AND target_id IN (SELECT id FROM incidents WHERE expires_at > ?) LIMIT 500").bind(userId,now),
 ]);
 const count=Number(total.results[0]?.total||0);
 return json({
  incidents:active.results.map(row=>publicIncident(row,row.user_id===userId)),
  own:own.results.map(row=>publicIncident(row,true)),
  resolved:resolved.results.map(row=>publicIncident(row,row.user_id===userId)),
  myVotes:votes.results.map(row=>({targetId:row.target_id,kind:row.kind})),
  total:count,nextOffset:offset+active.results.length<count?offset+active.results.length:null,
 });
}

async function item(request:Request):Promise<Response>{
 const id=safeId(new URL(request.url).searchParams.get('id'),'Incident');
 const userId=(await currentUser())?.userId||'';
 const row=await database().prepare(`SELECT i.*, ${counted} FROM incidents i WHERE i.id = ? AND (i.status = 'approved' OR (i.user_id = ? AND i.user_id <> ''))`).bind(id,userId).first<Row>();
 if(!row)throw new HttpError(404,'This incident report is not available.');
 const expired=Number(row.expires_at)<=Date.now();
 return json({incident:{...publicIncident(row,row.user_id===userId),...(expired&&!row.resolved_at?{photoKey:null,photoUrl:null,image:undefined}:{})}});
}

async function create(body:Row):Promise<Response>{
 const profile=await requireVerified(),db=database(),now=Date.now();
 const data=incidentInput(body,now);
 await consumeRateLimit(profile.userId,'incident',5,3600);
 await retentionSweep();
 if(data.photoKey){
  const photo=await db.prepare('SELECT key FROM photos WHERE key = ? AND user_id = ? AND created_at > ?').bind(data.photoKey,profile.userId,now-6*86400000).first();
  if(!photo)throw new HttpError(400,'Upload your own recent photo before reporting. Unused uploads expire after six days.');
 }
 // Roughly 130 m. One live heads-up per hazard: others corroborate it instead of stacking duplicates.
 const duplicate=await db.prepare(`SELECT i.id FROM incidents i WHERE i.category = ? AND ${live} AND abs(i.lat - ?) < 0.0012 AND abs(i.lng - ?) < 0.0019 ORDER BY i.created_at DESC LIMIT 1`).bind(data.category,now,data.lat,data.lng).first<{id:string}>();
 if(duplicate)return json({error:`A live ${categoryInfo(data.category).label.toLowerCase()} report already exists within about 130 m. Open it and tap “I can see this too” instead.`,existingId:duplicate.id},409);
 const text=`Incident (${categoryInfo(data.category).label}, ${severityInfo(data.severity).label}): ${data.title}\n${data.description}\nLocation: ${data.location}`;
 let verdict=await moderation(text,'incident');
 if(data.photoKey&&verdict.status==='approved')verdict=await photoModeration(data.photoKey,text);
 await requireActiveWrite(profile.userId);
 if(data.expiresAt<=Date.now())throw new HttpError(400,'The report window ended while it was being checked. Choose a longer duration.');
 const id=crypto.randomUUID();
 const row=await db.prepare('INSERT INTO incidents (id, user_id, category, severity, title, description, location, lat, lng, photo_key, status, moderation_reason, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
  .bind(id,profile.userId,data.category,data.severity,data.title,data.description,data.location,data.lat,data.lng,data.photoKey,verdict.status,verdict.reason,now,data.expiresAt).first<Row>();
 await scheduleModeration(row!,'incident',verdict);
 return json({ok:true,incident:publicIncident({...row!,confirm_count:0,clear_count:0},true),message:verdict.status==='approved'?'Your heads-up is live. Others nearby can now corroborate it.':'Your report is awaiting moderation and is visible only to you.'},201);
}

async function vote(body:Row):Promise<Response>{
 const profile=await requireVerified(),db=database(),now=Date.now();
 const id=safeId(body.id,'Incident'),kind=incidentVoteKind(body.kind);
 await consumeRateLimit(profile.userId,'incident-vote',60,3600);
 const target=await db.prepare('SELECT * FROM incidents WHERE id = ?').bind(id).first<Row>();
 if(!target||target.status!=='approved')throw new HttpError(404,'This incident report is not available.');
 if(target.user_id===profile.userId)throw new HttpError(400,'Use “Mark as over” to end your own report.');
 if(target.resolved_at!=null||Number(target.expires_at)<=now)throw new HttpError(400,'This incident has already been cleared or has expired.');
 const [voted]=await db.batch([
  // Lock the incident row so concurrent responses and the clear quorum see one consistent state.
  db.prepare(`INSERT INTO votes (id, user_id, target_id, kind, created_at) SELECT ?, ?, i.id, ?, ? FROM incidents i WHERE i.id = ? AND ${live} AND i.user_id <> ? FOR UPDATE OF i ON CONFLICT(user_id, target_id) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at RETURNING id`)
   .bind(crypto.randomUUID(),profile.userId,kind,now,id,now,profile.userId),
  db.prepare(`UPDATE incidents i SET resolved_at = ?, resolution = 'community', moderation_revision = moderation_revision + 1 WHERE i.id = ? AND ${live} AND (SELECT count(*) FROM votes v WHERE v.target_id = i.id AND v.kind = 'clear' AND v.user_id <> i.user_id) >= ? AND (SELECT count(*) FROM votes v WHERE v.target_id = i.id AND v.kind = 'clear' AND v.user_id <> i.user_id) > (SELECT count(*) FROM votes v WHERE v.target_id = i.id AND v.kind = 'confirm' AND v.user_id <> i.user_id)`)
   .bind(now,id,now,INCIDENT_CLEAR_QUORUM),
 ]);
 if(!voted.results.length)throw new HttpError(409,'This incident changed while you responded. Refresh and try again.');
 const updated=await db.prepare(`SELECT i.*, ${counted} FROM incidents i WHERE i.id = ?`).bind(id).first<Row>();
 return json({ok:true,incident:publicIncident(updated!,false),message:updated!.resolved_at?'Thanks. Enough students say this is over, so the alert has been cleared.':kind==='confirm'?'Thanks for corroborating. Stay safe.':'Thanks. If enough people agree it’s over, the alert will clear.'});
}

async function resolve(body:Row):Promise<Response>{
 const profile=await requireVerified(),db=database();
 const id=safeId(body.id,'Incident');
 await consumeRateLimit(profile.userId,'incident-manage',30,3600);
 const [updated]=await db.batch<Row>([
  db.prepare(`UPDATE incidents SET resolved_at = COALESCE(resolved_at, ?), resolution = COALESCE(resolution, 'reporter'), moderation_revision = moderation_revision + 1 WHERE id = ? AND user_id = ? RETURNING *`).bind(Date.now(),id,profile.userId),
  db.prepare('DELETE FROM moderation_retries WHERE target_id = ?').bind(id),
 ]);
 const row=updated.results[0];
 if(!row)throw new HttpError(404,'Your incident report could not be found.');
 return json({ok:true,incident:publicIncident(row,true),message:'Marked as over. Thanks for closing the loop.'});
}

async function flag(body:Row):Promise<Response>{
 const profile=await requireVerified(),db=database(),now=Date.now();
 const id=safeId(body.id,'Incident'),reason=textField(body.reason,'Reason',4,500);
 await consumeRateLimit(profile.userId,'report',10,3600);
 const target=await db.prepare("SELECT id FROM incidents WHERE id = ? AND (status = 'approved' OR user_id = ?)").bind(id,profile.userId).first();
 if(!target)throw new HttpError(404,'This incident report is not available.');
 await db.batch([
  db.prepare('INSERT INTO reports (id, user_id, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, target_id) DO UPDATE SET reason = excluded.reason').bind(crypto.randomUUID(),profile.userId,id,reason,now),
  db.prepare("UPDATE incidents SET status = 'hidden', moderation_reason = 'Hidden while community reports are reviewed.', moderation_revision = moderation_revision + 1 WHERE id = ? AND status = 'approved' AND (SELECT count(*) FROM reports WHERE target_id = ?) >= 3").bind(id,id),
 ]);
 return json({ok:true,message:'Report received. Repeated independent reports hide an incident pending moderator review.'});
}

async function remove(body:Row):Promise<Response>{
 const profile=await requireVerified(),db=database();
 const id=safeId(body.id,'Incident');
 await consumeRateLimit(profile.userId,'incident-manage',30,3600);
 const own=await db.prepare('SELECT id FROM incidents WHERE id = ? AND user_id = ?').bind(id,profile.userId).first();
 if(!own)throw new HttpError(404,'Your incident report could not be found.');
 await db.batch([
  db.prepare('DELETE FROM votes WHERE target_id = ?').bind(id),db.prepare('DELETE FROM reports WHERE target_id = ?').bind(id),db.prepare('DELETE FROM moderation_retries WHERE target_id = ?').bind(id),
  db.prepare('DELETE FROM incidents WHERE id = ? AND user_id = ?').bind(id,profile.userId),
 ]);
 return json({ok:true,message:'Your incident report has been deleted.'});
}

export async function incidentsRoute(request:Request,path:string[]):Promise<Response>{
 try{
  const endpoint=path.join('/');
  if(request.method==='GET'){
   if(endpoint==='feed')return await feed(request);
   if(endpoint==='item')return await item(request);
  }
  if(request.method==='POST'){
   assertSameOrigin(request);
   const body=await jsonBody(request);
   if(endpoint==='create')return await create(body);
   if(endpoint==='vote')return await vote(body);
   if(endpoint==='resolve')return await resolve(body);
   if(endpoint==='flag')return await flag(body);
   if(endpoint==='delete')return await remove(body);
  }
  throw new HttpError(404,'This incident endpoint does not exist.');
 }catch(error){
  if(error instanceof HttpError)return json({error:error.message},error.status);
  console.error('Incident request failed:',error instanceof Error?error.name:'UnknownError');
  return json({error:'Incident reporting is temporarily unavailable. In an emergency call 999 or UCL Security.'},500);
 }
}
