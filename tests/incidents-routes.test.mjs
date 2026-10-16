import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
import {loadFreebie,compileFreebie} from './freebies/load.mjs';
const {createDatabase}=await loadFreebie('lib/db.ts');
const {HttpError}=await loadFreebie('lib/community-validation.ts');
const pg=new PGlite();
for(const name of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8').split('-- Private bucket')[0]);
const runner=on=>async(sql,args)=>(await on.query(sql,args)).rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?Number(value):value])));
const db=createDatabase(runner(pg),work=>pg.transaction(tx=>work(runner(tx))));
let user=null,verdict={status:'approved',reason:null},rates=[],scheduled=[];
globalThis.__incidentRoute={
 db,currentUser:async()=>user,
 requireVerified:async()=>{if(!user)throw new HttpError(403,'Sign in first.');return {...user,verified:true}},
 requireActiveWrite:async()=>{},consumeRateLimit:async(...args)=>rates.push(args),retentionSweep:async()=>{},
 moderation:async()=>verdict,photoModeration:async()=>verdict,scheduleModeration:async(row,kind,result)=>scheduled.push({id:row.id,kind,retryable:!!result.retryable}),
};
let code=ts.transpileModule(readFileSync(new URL('../lib/incidents/server.ts',import.meta.url),'utf8'),{fileName:'server.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
code=code.replace(/import \{\s*getDatabase\s*\} from ['"]\.\.\/db['"];/,'const getDatabase=()=>globalThis.__incidentRoute.db;')
 .replace(/import \{([^}]+)\} from ['"]\.\.\/community-server['"];/,'const {$1}=globalThis.__incidentRoute;')
 .replace(/import \{\s*currentUser\s*\} from ['"]\.\.\/supabase['"];/,'const currentUser=()=>globalThis.__incidentRoute.currentUser();')
 .replace(/from (['"])(\.\.?\/[^'"]+)\1/g,(_,q,relative)=>'from '+q+compileFreebie(new URL('../lib/incidents/'+relative+'.ts',import.meta.url))+q);
const temp=new URL('.incidents-routes-'+process.pid+'.mjs',import.meta.url);writeFileSync(temp,code);
const {incidentsRoute}=await import(temp.href);unlinkSync(temp);
after(async()=>{await pg.close();delete globalThis.__incidentRoute});
test.beforeEach(async()=>{user=null;verdict={status:'approved',reason:null};rates=[];scheduled=[];await pg.exec('TRUNCATE incidents,votes,reports,photos,moderation_retries,rate_limits')});

const origin='https://campus.example';
const call=(path,body,headers={})=>incidentsRoute(new Request(origin+'/api/incidents/'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}),[path.split('?')[0]]);
const as=(id)=>{user={userId:id,email:id+'@ucl.ac.uk'}};
const report=(overrides={})=>({category:'hazard',severity:'warning',title:'Chemical smell on the first floor',description:'Strong solvent smell along the corridor. Security has been told.',location:'Christopher Ingold Building',lat:51.5253,lng:-0.1323,expiresAt:Date.now()+2*3600000,locationConfirmed:true,safetyAcknowledged:true,...overrides});
async function create(overrides={}){const response=await call('create',report(overrides));const body=await response.json();return {response,body}}
const feed=async()=>(await call('feed')).json();

test('anonymous visitors can read the feed but cannot report, respond or flag',async()=>{
 assert.deepEqual(await feed(),{incidents:[],own:[],resolved:[],myVotes:[],total:0,nextOffset:null});
 for(const [path,body] of [['create',report()],['vote',{id:'x',kind:'confirm'}],['resolve',{id:'x'}],['flag',{id:'x',reason:'spam'}],['delete',{id:'x'}]])assert.equal((await call(path,body)).status,403,path);
 as('alice');
 assert.equal((await call('create',report(),{origin:'https://evil.example'})).status,403);
 assert.equal((await call('create',report(),{'content-type':'text/plain'})).status,415);
 assert.equal(rates.length,0);
});

test('an approved report goes live, is owned by its reporter and reaches the public feed',async()=>{
 as('alice');
 const {response,body}=await create();
 assert.equal(response.status,201);assert.equal(body.incident.status,'approved');assert.equal(body.incident.own,true);assert.equal(body.incident.type,'incident');
 assert.match(body.message,/live/);assert.deepEqual(scheduled,[{id:body.incident.id,kind:'incident',retryable:false}]);
 assert.deepEqual(rates[0].slice(1),['incident',5,3600]);
 const mine=await feed();assert.equal(mine.incidents.length,1);assert.equal(mine.incidents[0].own,true);assert.equal(mine.total,1);
 as('bob');const theirs=await feed();assert.equal(theirs.incidents[0].own,false);assert.equal(theirs.incidents[0].confirmCount,0);
 assert.equal(Object.keys(theirs.incidents[0]).includes('user_id'),false);
 user=null;const item=await (await call('item?id='+body.incident.id)).json();assert.equal(item.incident.title,'Chemical smell on the first floor');
});

test('publishing an urgent incident stores an app report without an outbound dispatch request',async()=>{
 as('alice');
 const originalFetch=globalThis.fetch;let externalRequests=0;
 // Auth and content moderation are mocked above; any additional transport is
 // unexpected. Never make a live request while checking emergency behaviour.
 globalThis.fetch=async()=>{externalRequests++;throw new Error('Unexpected outbound dispatch')};
 try{
  const {response,body}=await create({severity:'urgent',category:'fire',title:'Fictional test fire alarm',description:'Fictional test only: alarm sounding in a public corridor.'});
  assert.equal(response.status,201);assert.equal(body.incident.severity,'urgent');
  assert.equal(externalRequests,0);
  assert.equal((await feed()).incidents[0].id,body.incident.id);
  assert.deepEqual(scheduled,[{id:body.incident.id,kind:'incident',retryable:false}]);
 }finally{globalThis.fetch=originalFetch}
});

test('validation rejects long windows, missing confirmations, contact details and bad coordinates',async()=>{
 as('alice');
 for(const [overrides,pattern] of [
  [{expiresAt:Date.now()+25*3600000},/24 hours/],[{expiresAt:Date.now()-1},/24 hours/],
  [{safetyAcknowledged:false},/emergency services/],[{locationConfirmed:undefined},/Confirm the incident location/],
  [{description:'Call me on 07700 900123 for details'},/contact details/],[{category:'zombies'},/incident type/],[{severity:'panic'},/heads-up/],
  [{lat:52.9},/Latitude/],[{title:'Hi'},/Headline/],
 ]){const {response,body}=await create(overrides);assert.equal(response.status,400,JSON.stringify(overrides));assert.match(body.error,pattern)}
 assert.equal((await feed()).total,0);
});

test('one live report per hazard: a nearby duplicate is refused and points at the existing alert',async()=>{
 as('alice');const first=(await create()).body.incident;
 as('bob');
 const duplicate=await create({lat:51.5257,lng:-0.1330,title:'Smell of chemicals near the labs'});
 assert.equal(duplicate.response.status,409);assert.equal(duplicate.body.existingId,first.id);assert.match(duplicate.body.error,/I can see this too/);
 assert.equal((await create({category:'protest',severity:'notice',title:'Crowd gathering outside'})).response.status,201);
 assert.equal((await create({lat:51.5300,lng:-0.1323,title:'Another smell much further away'})).response.status,201);
 assert.equal((await feed()).total,3);
});

test('responses are one per student, never from the reporter, and a clear quorum ends the alert',async()=>{
 as('alice');const incident=(await create()).body.incident;
 assert.equal((await call('vote',{id:incident.id,kind:'confirm'})).status,400);
 as('bob');
 let result=await (await call('vote',{id:incident.id,kind:'confirm'})).json();
 assert.equal(result.incident.confirmCount,1);assert.equal(result.incident.clearCount,0);
 result=await (await call('vote',{id:incident.id,kind:'clear'})).json();
 assert.equal(result.incident.confirmCount,0);assert.equal(result.incident.clearCount,1,'switching sides replaces the earlier response');
 assert.deepEqual((await feed()).myVotes,[{targetId:incident.id,kind:'clear'}]);
 assert.equal((await call('vote',{id:incident.id,kind:'maybe'})).status,400);
 as('carol');await call('vote',{id:incident.id,kind:'clear'});
 assert.equal((await feed()).incidents[0].resolvedAt,null,'two clears are not enough');
 for(const who of ['dave','erin','frank']){as(who);await call('vote',{id:incident.id,kind:'confirm'})}
 as('gina');result=await (await call('vote',{id:incident.id,kind:'clear'})).json();
 assert.equal(result.incident.clearCount,3);assert.equal(result.incident.resolvedAt,null,'three clears must outnumber three confirmations');
 as('henry');result=await (await call('vote',{id:incident.id,kind:'clear'})).json();
 assert.equal(result.incident.resolution,'community');assert.ok(result.incident.resolvedAt);assert.match(result.message,/cleared/);
 const after=await feed();assert.equal(after.incidents.length,0);assert.equal(after.resolved.length,1);assert.equal(after.resolved[0].clearCount,4);assert.equal(after.resolved[0].confirmCount,3);
 as('ian');assert.equal((await call('vote',{id:incident.id,kind:'confirm'})).status,400);
});

test('pending moderation keeps a report private to its reporter until approved',async()=>{
 verdict={status:'pending',reason:'Awaiting moderation.',retryable:true};
 as('alice');const {body}=await create();
 assert.equal(body.incident.status,'pending');assert.match(body.message,/awaiting moderation/);assert.deepEqual(scheduled,[{id:body.incident.id,kind:'incident',retryable:true}]);
 const mine=await feed();assert.equal(mine.incidents.length,0);assert.equal(mine.own.length,1);assert.equal(mine.own[0].moderationReason,'Awaiting moderation.');
 as('bob');assert.equal((await feed()).own.length,0);assert.equal((await call('item?id='+body.incident.id)).status,404);
 assert.equal((await call('vote',{id:body.incident.id,kind:'confirm'})).status,404);
 await db.prepare("UPDATE incidents SET status = 'approved' WHERE id = ?").bind(body.incident.id).run();
 assert.equal((await feed()).incidents.length,1);
});

test('three independent flags hide an alert pending review while the reporter still sees why',async()=>{
 as('alice');const incident=(await create()).body.incident;
 for(const who of ['bob','carol']){as(who);assert.equal((await call('flag',{id:incident.id,reason:'This is not happening.'})).status,200)}
 as('carol');await call('flag',{id:incident.id,reason:'Still not happening.'});
 assert.equal((await feed()).incidents.length,1,'repeat flags from one account do not count twice');
 as('dave');await call('flag',{id:incident.id,reason:'Nothing here.'});
 const hidden=await feed();assert.equal(hidden.incidents.length,0);
 assert.equal((await call('flag',{id:incident.id,reason:'Late flag'})).status,404);
 as('alice');const mine=await feed();assert.equal(mine.own[0].status,'hidden');assert.match(mine.own[0].moderationReason,/community reports/);
 assert.equal((await call('flag',{id:'missing',reason:'Not real'})).status,404);
});

test('reporters can mark their own alert over or delete it, nobody else can',async()=>{
 as('alice');const incident=(await create()).body.incident;
 as('bob');
 assert.equal((await call('resolve',{id:incident.id})).status,404);assert.equal((await call('delete',{id:incident.id})).status,404);
 await call('vote',{id:incident.id,kind:'confirm'});
 as('alice');
 const resolved=await (await call('resolve',{id:incident.id})).json();assert.equal(resolved.incident.resolution,'reporter');
 const again=await (await call('resolve',{id:incident.id})).json();assert.equal(again.incident.resolvedAt,resolved.incident.resolvedAt,'resolving is idempotent');
 const state=await feed();assert.equal(state.incidents.length,0);assert.equal(state.resolved.length,1);assert.equal(state.resolved[0].confirmCount,1);
 assert.equal((await call('delete',{id:incident.id})).status,200);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM votes').first()).n,0);
 assert.deepEqual(await feed(),{incidents:[],own:[],resolved:[],myVotes:[],total:0,nextOffset:null});
});

test('photos must be the reporter’s own recent upload and are referenced through the private photo route',async()=>{
 as('alice');
 assert.equal((await create({photoKey:'photos/00000000-0000-0000-0000-000000000000.jpg'})).response.status,400);
 assert.equal((await create({photoKey:'../etc/passwd'})).response.status,400);
 await db.prepare("INSERT INTO photos (key,user_id,mime,bytes,created_at) VALUES ('photos/11111111-1111-1111-1111-111111111111.jpg','bob','image/jpeg',10,?)").bind(Date.now()).run();
 assert.equal((await create({photoKey:'photos/11111111-1111-1111-1111-111111111111.jpg'})).response.status,400,'another account’s upload cannot be attached');
 await db.prepare("INSERT INTO photos (key,user_id,mime,bytes,created_at) VALUES ('photos/22222222-2222-2222-2222-222222222222.jpg','alice','image/jpeg',10,?)").bind(Date.now()).run();
 const {response,body}=await create({photoKey:'photos/22222222-2222-2222-2222-222222222222.jpg'});
 assert.equal(response.status,201);assert.equal(body.incident.photoUrl,'/api/community/photo?key=photos%2F22222222-2222-2222-2222-222222222222.jpg');
});

test('the migration lets incidents join the durable moderation retry queue',async()=>{
 await db.prepare("INSERT INTO moderation_retries (target_id,kind,revision,next_attempt_at) VALUES ('i1','incident',0,1)").run();
 await assert.rejects(db.prepare("INSERT INTO moderation_retries (target_id,kind,revision,next_attempt_at) VALUES ('i2','bogus',0,1)").run());
 await assert.rejects(db.prepare("INSERT INTO incidents (id,user_id,category,severity,title,description,location,lat,lng,created_at,expires_at) VALUES ('bad','u','meteor','urgent','t','d','l',51.5,-0.13,1,2)").run());
});
