import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
import {loadFreebie,compileFreebie} from './freebies/load.mjs';
const {createDatabase}=await loadFreebie('lib/db.ts');
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
  await db.prepare("INSERT INTO posts(id,user_id,type,title,description,location,expires_at,source_event_key,freebie_json,dietary,status,created_at) VALUES (?,'private-user','freebie','Test event','Test','TBC',?,?,'{}','[]',?,?)").bind(id,end,id,status,Date.now()).run();
 }
 const response=await freebiesRoute(request('feed'),['feed']);assert.equal(response.status,200);
 const body=await response.json();assert.deepEqual(body.posts.map(pin=>pin.id),['live']);assert.equal(JSON.stringify(body).includes('private-user'),false);
});
test('a confirmed campus venue uses a real directory position without changing publication state',async()=>{
 admin=true;
 await db.prepare("INSERT INTO posts(id,user_id,type,title,description,location,expires_at,source_event_key,freebie_json,dietary,status,created_at) VALUES ('event','system:union','freebie','Event','Test','TBC',?,'source','{}','[]','pending',?)").bind(Date.now()+60000,Date.now()).run();
 assert.equal((await freebiesRoute(request('location',{postId:'event',placeId:'wilkins',confirmed:true}),['location'])).status,200);
 const row=await db.prepare("SELECT * FROM posts WHERE id='event'").first();assert.equal(row.status,'pending');assert.equal(row.lat,51.5246);assert.equal(JSON.parse(row.freebie_json).locationConfirmed,true);
});
test('longer expiry requires a trusted moderator import; body flags cannot grant it',()=>{
 const now=Date.now(),body={type:'freebie',title:'Test event',location:'Wilkins',lat:51.5246,lng:-.1338,expiresAt:now+10*86400000,sourceUrl:'https://studentsunionucl.org/whats-on/clubs-societies/test',unionImport:true};
 assert.throws(()=>validation.postInput(body,now),/seven days/);
 assert.equal(validation.postInput(body,now,{unionImport:true}).expiresAt,body.expiresAt);
 assert.throws(()=>validation.postInput({...body,type:'food'},now,{unionImport:true}),/six hours/);
});
