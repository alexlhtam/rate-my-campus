import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
import {loadFreebie,compileFreebie} from './freebies/load.mjs';
const {createDatabase}=await loadFreebie('lib/db.ts');
const {publishFreebie}=await loadFreebie('lib/freebies/publication.ts');
const {loadEventFeed}=await loadFreebie('lib/freebies/feed-client.ts');
const {eventLocated}=await loadFreebie('lib/freebies/view.ts');
const validation=await loadFreebie('lib/community-validation.ts');
const pg=new PGlite();
for(const name of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8').split('-- Private bucket')[0]);
const runner=on=>async(sql,args)=>(await on.query(sql,args)).rows;
const db=createDatabase(runner(pg),work=>pg.transaction(tx=>work(runner(tx))));
const secret='fixture-only-authorization-secret-at-least-32-characters';
let env,admin=false,jobs=[],rates=[];
globalThis.__freebieRoute={db,validation,after:job=>jobs.push(job),places:[{id:'wilkins',name:'Wilkins Building',lat:51.5246,lng:-.1338}],runtimeEnv:async()=>env,requireModerator:async()=>{if(!admin)throw new validation.HttpError(403,'Moderator required');return {userId:'moderator'}},consumeRateLimit:async(...args)=>rates.push(args),moderateContent:async()=>({approved:true,reasons:[]}),locatePlace:async()=>{throw Error('No live lookup allowed')}};
let code=ts.transpileModule(readFileSync(new URL('../lib/freebies/server.ts',import.meta.url),'utf8'),{fileName:'server.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
code=code.replace(/import \{ getDatabase \} from ['"]\.\.\/db['"];/,'const getDatabase=()=>globalThis.__freebieRoute.db;')
 .replace(/import \{ after \} from ['"]next\/server['"];/,'const {after}=globalThis.__freebieRoute;')
 .replace(/import \{([^}]+)\} from ['"]\.\.\/community-server['"];/,'const {$1}=globalThis.__freebieRoute;')
 .replace(/import \{([^}]+)\} from ['"]\.\.\/community-validation['"];/,'const {$1}=globalThis.__freebieRoute.validation;')
 .replace(/import \{([^}]+)\} from ['"]\.\.\/integrations['"];/,'const {$1}=globalThis.__freebieRoute;')
 .replace(/import \{ places \} from ['"]\.\.\/data['"];/,'const {places}=globalThis.__freebieRoute;')
 .replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,relative)=>'from '+q+compileFreebie(new URL('../lib/freebies/'+relative+'.ts',import.meta.url))+q);
const temp=new URL('.freebie-routes-'+process.pid+'.mjs',import.meta.url);writeFileSync(temp,code);
const {freebiesRoute}=await import(temp.href);unlinkSync(temp);
after(async()=>{await pg.close();delete globalThis.__freebieRoute});
test.beforeEach(async()=>{
 admin=false;jobs=[];rates=[];
 env={UNION_IMPORT_ENABLED:'true',ANTHROPIC_API_KEY:'fixture',ANTHROPIC_MODEL:'fixture-model',FREEBIE_CLAUDE_MODEL:'',CRON_SECRET:secret,FREEBIE_WORKER_URL:'https://campus.example/api/freebies/worker'};
 await pg.exec('TRUNCATE freebie_tasks,freebie_scans,posts RESTART IDENTITY CASCADE');
});
function request(path,body,headers={}){return new Request('https://campus.example/api/freebies/'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://campus.example','content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)})}

test('published events travel through the real feed and client loader, including list-only venues',async()=>{
 const now=Date.now(),source={id:'known:1:2',title:'Campus discussion',url:'https://studentsunionucl.org/whats-on/clubs-societies/example',start:new Date(now+3600000).toISOString(),end:new Date(now+7200000).toISOString(),sourceLocation:'Wilkins Building',imageUrl:null};
 const extraction={hasFreebies:false,summary:'A campus discussion.',freebies:[],venue:'Wilkins Building',address:null,locationEvidence:'Wilkins Building',admission:'free',priceDetails:null,bookingRequired:null,bookingUrl:null,eligibility:null,conditions:[],dietary:[]};
 const deps={places:globalThis.__freebieRoute.places,privacy:()=>null,moderate:async()=>{throw Error('Batch verdict should be reused')}};
 for(const [id,venue,online] of [['known','Wilkins Building',false],['unknown','Venue awaiting confirmation',false],['online','Online',true]])await publishFreebie(db,{...source,id:id+':1:2',title:id,sourceOnline:online,sourceLocation:venue},{...extraction,venue},deps,{approved:true,reasons:[]});
 const result=await loadEventFeed({fetcher:async url=>freebiesRoute(new Request('https://campus.example'+url),['feed'])});
 assert.equal(result.posts.length,3);assert.deepEqual(result.posts.map(p=>p.title).sort(),['known','online','unknown']);
 assert.deepEqual(result.posts.filter(eventLocated).map(p=>p.title),['known']);
 for(const post of result.posts){assert.equal(post.status,'approved');assert.equal(post.type,'event');assert.equal(post.description,'A campus discussion.');}
 assert.equal(result.posts.find(p=>p.title==='unknown').lat,null);assert.equal(result.posts.find(p=>p.title==='online').freebie.attendance,'online');
});
test('anonymous users cannot import, inspect private audit or confirm venues',async()=>{
 for(const [path,body] of [['scan',{action:'start'}],['dashboard',undefined],['location',{postId:'x',placeId:'wilkins',confirmed:true}]]){
  assert.equal((await freebiesRoute(request(path,body),[path])).status,403);
 }
 assert.equal(jobs.length,0);assert.equal(rates.length,0);
});
test('moderator imports require same-origin writes and start a background job using the real current date',async()=>{
 admin=true;
 assert.equal((await freebiesRoute(request('scan',{action:'start'},{origin:'https://evil.example'}),['scan'])).status,403);
 const response=await freebiesRoute(request('scan',{action:'start',startDate:'2099-01-01'}),['scan']);
 assert.equal(response.status,202);const body=await response.json();
 assert.notEqual(body.run.startDate,'2099-01-01');assert.equal(body.models.claude,'fixture-model');assert.equal(jobs.length,1);
 assert.equal((await freebiesRoute(request('scan',{action:'start'}),['scan'])).status,202);
 assert.equal((await db.prepare('SELECT * FROM freebie_scans').all()).results.length,1);
});
test('disabled imports and missing configuration do not create jobs or spend quota',async()=>{
 admin=true;env.UNION_IMPORT_ENABLED='false';
 assert.equal((await freebiesRoute(request('scan',{action:'start'}),['scan'])).status,503);
 env.UNION_IMPORT_ENABLED='true';env.CRON_SECRET='';
 assert.equal((await freebiesRoute(request('scan',{action:'start'}),['scan'])).status,503);
 assert.equal(jobs.length,0);assert.equal(rates.length,0);
});

test('manual import resumes today after automatic retries are exhausted without discarding checkpoints',async()=>{
 admin=true;
 const first=await (await freebiesRoute(request('scan',{action:'start'}),['scan'])).json();const id=first.run.id;
 await db.prepare("UPDATE freebie_scans SET status='partial',active_slot=NULL,exhausted=1,next_page=4,auto_retries=2 WHERE id=?").bind(id).run();
 const source={id:'42:1:2',title:'Saved event',url:'https://studentsunionucl.org/whats-on/clubs-societies/test',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),sourceLocation:null,imageUrl:null};
 await db.prepare("INSERT INTO freebie_tasks(id,run_id,event_id,source_json,page_json,extraction_json,status,failed_stage) VALUES ('saved-task',?,'42:1:2',?,'{\"text\":\"saved page\"}','{\"hasFreebies\":false}','failed','publish')").bind(id,JSON.stringify(source)).run();
 const result=await (await freebiesRoute(request('scan',{action:'start'}),['scan'])).json();
 assert.equal(result.run.id,id);assert.equal(result.run.status,'running');assert.equal(result.run.sourcePages,4);
 assert.equal((await db.prepare('SELECT id FROM freebie_scans').all()).results.length,1);
 const task=await db.prepare("SELECT * FROM freebie_tasks WHERE id='saved-task'").first();
 assert.equal(task.status,'queued');assert.equal(task.failed_stage,null);assert.equal(JSON.parse(task.page_json).text,'saved page');assert.equal(JSON.parse(task.extraction_json).hasFreebies,false);
 assert.equal(rates.filter(rate=>rate[1]==='scan-start').length,1);
});
test('daily imports are off by default; workers require the exact bearer secret',async()=>{
 assert.equal((await freebiesRoute(request('worker',{}),['worker'])).status,401);
 assert.equal((await freebiesRoute(request('worker',{}, {authorization:'Bearer '+secret+'x'}),['worker'])).status,401);
 assert.equal((await freebiesRoute(request('worker',{}, {authorization:'Bearer '+secret}),['worker'])).status,202);
 jobs=[];
 const disabled=await freebiesRoute(request('daily',undefined,{authorization:'Bearer '+secret}),['daily']);
 assert.equal((await disabled.json()).skipped,true);assert.equal(jobs.length,0);
 env.FREEBIE_DAILY_IMPORT_ENABLED='true';
 for(let i=0;i<2;i++)assert.equal((await freebiesRoute(request('daily',undefined,{authorization:'Bearer '+secret}),['daily'])).status,202);
 assert.equal((await db.prepare('SELECT * FROM freebie_scans').all()).results.length,1);
});
test('public feed excludes held, hidden and expired pins and never includes account data',async()=>{
 for(const [id,status,end] of [['live','approved',Date.now()+60000],['held','pending',Date.now()+60000],['hidden','hidden',Date.now()+60000],['expired','approved',Date.now()-1]]){
  await db.prepare("INSERT INTO posts(id,user_id,type,title,description,location,starts_at,expires_at,source_event_key,freebie_json,dietary,status,created_at) VALUES (?,'private-user','freebie','Test event','Test','TBC',?,?,?,'{}','[]',?,?)").bind(id,Date.now()-1000,end,id,status,Date.now()).run();
 }
 const response=await freebiesRoute(request('feed'),['feed']);assert.equal(response.status,200);
 const body=await response.json();assert.deepEqual(body.posts.map(pin=>pin.id),['live']);assert.equal(JSON.stringify(body).includes('private-user'),false);
});

test('public feed distinguishes absent imports, disabled updates and incomplete configuration without revealing secrets',async()=>{
 const initial=await (await freebiesRoute(request('feed'),['feed'])).json();
 assert.equal(initial.lastScan,null);assert.equal(initial.importReady,true);assert.equal(initial.importStatus,'ready');
 env.UNION_IMPORT_ENABLED='false';
 const disabled=await (await freebiesRoute(request('feed'),['feed'])).json();
 assert.equal(disabled.importStatus,'disabled');assert.equal(disabled.importReady,false);
 env.UNION_IMPORT_ENABLED='true';env.CRON_SECRET='';
 const setup=await (await freebiesRoute(request('feed'),['feed'])).json();
 assert.equal(setup.importStatus,'setup_required');assert.equal(setup.importReady,false);
 for(const body of [initial,disabled,setup]){
  const text=JSON.stringify(body);
  for(const privateValue of [secret,'fixture-model','campus.example','ANTHROPIC_API_KEY','CRON_SECRET'])assert.equal(text.includes(privateValue),false);
 }
 assert.equal(jobs.length,0);assert.equal(rates.length,0);
});

test('public feed exposes only the latest import window and safe coverage metadata',async()=>{
 await db.prepare("INSERT INTO freebie_scans(id,start_date,end_date,status,created_at,updated_at,exhausted,error,warnings_json) VALUES ('old-private-id','2026-10-01','2026-10-15','complete','2026-10-01T08:00:00Z','2026-10-01T09:00:00Z',1,'private-error','[]')").run();
 await db.prepare("INSERT INTO freebie_scans(id,start_date,end_date,status,created_at,updated_at,exhausted,error,warnings_json) VALUES ('latest-private-id','2026-10-15','2026-10-29','partial','2026-10-15T08:00:00Z','2026-10-15T09:00:00Z',1,'private-provider-error','[\"private-source-warning\"]')").run();
 const partial=await (await freebiesRoute(request('feed'),['feed'])).json();
 assert.deepEqual(partial.lastScan,{start_date:'2026-10-15',end_date:'2026-10-29',updated_at:'2026-10-15T09:00:00Z',status:'partial',exhausted:1,coverageComplete:false});
 assert.equal(JSON.stringify(partial).includes('private-'),false);
 await db.prepare("UPDATE freebie_scans SET status='complete',warnings_json='[]' WHERE id='latest-private-id'").run();
 assert.equal((await (await freebiesRoute(request('feed'),['feed'])).json()).lastScan.coverageComplete,true);
 await db.prepare("UPDATE freebie_scans SET exhausted=0 WHERE id='latest-private-id'").run();
 assert.equal((await (await freebiesRoute(request('feed'),['feed'])).json()).lastScan.coverageComplete,false);
});

test('public feed includes events and freebies, supports a type filter and bounds London fortnight across DST',async(t)=>{
 const clock=Date.parse('2026-10-15T12:00:00Z'),end=Date.parse('2026-10-29T00:00:00Z');
 t.mock.method(Date,'now',()=>clock);
 for(const [id,type,start,expiry] of [
  ['ongoing','event',clock-86400000,clock+3600000],
  ['offer','freebie',clock+3600000,clock+7200000],
  ['last-night','event',end-1800000,end+3600000],
  ['outside','event',end,end+3600000],
  ['ended','event',clock-3600000,clock],
 ])await db.prepare("INSERT INTO posts(id,user_id,type,title,description,location,starts_at,expires_at,source_event_key,freebie_json,dietary,status,created_at) VALUES (?,'system:union',?,'Event','Test','TBC',?,?,?,'{}','[]','approved',?)").bind(id,type,start,expiry,id,clock).run();
 const all=await (await freebiesRoute(request('feed'),['feed'])).json();
 assert.deepEqual(all.posts.map(p=>p.id),['ongoing','offer','last-night']);
 assert.deepEqual(all.posts.map(p=>p.type),['event','freebie','event']);
 const events=await (await freebiesRoute(request('feed?type=event'),['feed'])).json();assert.deepEqual(events.posts.map(p=>p.id),['ongoing','last-night']);
 const freebies=await (await freebiesRoute(request('feed?type=freebie'),['feed'])).json();assert.deepEqual(freebies.posts.map(p=>p.id),['offer']);
 assert.equal((await freebiesRoute(request('feed?type=unknown'),['feed'])).status,400);
});

test('legacy Jev configuration cannot skip listings in an all-event import',async()=>{
 admin=true;env.FREEBIE_JEV_SCREENING='true';env.JEV_API_KEY='legacy-fixture';
 const response=await freebiesRoute(request('scan',{action:'start'}),['scan']);
 assert.equal(response.status,202);assert.equal((await response.json()).configured.jev,false);
});

test('pagination applies after event-type and date filtering without losing the fifty-first result',async()=>{
 const clock=Date.now();
 for(let i=0;i<53;i++){
  const id='page-'+String(i).padStart(2,'0'),type=i===0?'freebie':'event';
  await db.prepare("INSERT INTO posts(id,user_id,type,title,description,location,starts_at,expires_at,source_event_key,freebie_json,dietary,status,created_at) VALUES (?,'system:union',?,'Event','Test','TBC',?,?,?,'{}','[]','approved',?)").bind(id,type,clock+i*1000,clock+3600000,id,clock).run();
 }
 const first=await (await freebiesRoute(request('feed?type=event'),['feed'])).json();
 assert.equal(first.posts.length,50);assert.equal(first.nextOffset,50);assert.equal(first.posts[0].id,'page-01');
 const second=await (await freebiesRoute(request('feed?type=event&offset='+first.nextOffset),['feed'])).json();
 assert.deepEqual(second.posts.map(p=>p.id),['page-51','page-52']);assert.equal(second.nextOffset,null);
 assert.equal(new Set([...first.posts,...second.posts].map(p=>p.id)).size,52);
 const offers=await (await freebiesRoute(request('feed?type=freebie'),['feed'])).json();
 assert.deepEqual(offers.posts.map(p=>p.id),['page-00']);assert.equal(offers.nextOffset,null);
});
test('a confirmed campus venue uses a real directory position without changing publication state',async()=>{
 admin=true;
 await db.prepare("INSERT INTO posts(id,user_id,type,title,description,location,expires_at,source_event_key,freebie_json,dietary,status,created_at) VALUES ('event','system:union','freebie','Event','Test','TBC',?,'source','{}','[]','pending',?)").bind(Date.now()+60000,Date.now()).run();
 assert.equal((await freebiesRoute(request('location',{postId:'event',placeId:'wilkins',confirmed:true}),['location'])).status,200);
 const row=await db.prepare("SELECT * FROM posts WHERE id='event'").first();assert.equal(row.status,'pending');assert.equal(row.lat,51.5246);assert.equal(row.location,'Wilkins Building');assert.equal(JSON.parse(row.freebie_json).locationConfirmed,true);
});
test('longer expiry requires a trusted moderator import; body flags cannot grant it',()=>{
 const now=Date.now(),body={type:'freebie',title:'Test event',location:'Wilkins',lat:51.5246,lng:-.1338,expiresAt:now+10*86400000,sourceUrl:'https://studentsunionucl.org/whats-on/clubs-societies/test',unionImport:true};
 assert.throws(()=>validation.postInput(body,now),/seven days/);
 assert.equal(validation.postInput(body,now,{unionImport:true}).expiresAt,body.expiresAt);
 assert.throws(()=>validation.postInput({...body,type:'food'},now,{unionImport:true}),/six hours/);
});
