import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadFreebie} from './freebies/load.mjs';
const {askClaudeBatch,selectBatch,fingerprint,reusableCheckpoint,readCheckpoint}=await loadFreebie('lib/freebies/batch.ts');
const {actOnScan}=await loadFreebie('lib/freebies/pipeline.ts');
const {workFreebies}=await loadFreebie('lib/freebies/worker.ts');
const {insertEvents,dashboard}=await loadFreebie('lib/freebies/store.ts');
const {publishFreebie}=await loadFreebie('lib/freebies/publication.ts');
const {parseEventPage}=await loadFreebie('lib/freebies/ucl.ts');
const {createDatabase}=await loadFreebie('lib/db.ts');
const pg=new PGlite();
for(const name of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8').split('-- Private bucket')[0]);
const runner=on=>async(sql,args)=>(await on.query(sql,args)).rows;
const db=createDatabase(runner(pg),work=>pg.transaction(tx=>work(runner(tx))));
after(()=>pg.close());
const config={claudeKey:'test-only',claudeModel:'test-model',jevKey:'',jevModel:'',threshold:.5};
const extraction={hasFreebies:false,summary:'A society discussion.',freebies:[],venue:'Wilkins Building',address:null,locationEvidence:'Wilkins Building',admission:'free',priceDetails:null,bookingRequired:null,bookingUrl:null,eligibility:null,conditions:[],dietary:[]};
const moderation={approved:true,reasons:[]};
const html='<main><article><div class="field--name-body">A society discussion. Free entry. Wilkins Building.</div></article></main>';
function item(id){const source={id:'event-'+id+':1:2',url:'https://studentsunionucl.org/whats-on/clubs-societies/example-'+id,title:'Event '+id,start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),sourceLocation:'Wilkins Building',sourceOnline:false,imageUrl:null};return {id:String(id),source,page:parseEventPage(html,source)};}
function respond(events,stop_reason='end_turn'){return Response.json({stop_reason,content:[{type:'text',text:JSON.stringify({events})}]});}
function fakeProvider(t,transform=(row)=>row){const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});const calls=[];globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');const body=JSON.parse(options.body);calls.push(body);return respond(JSON.parse(body.messages[0].content).events.map(event=>transform({id:event.id,extraction,moderation})).filter(Boolean))};return calls;}
const deps={places:[{id:'wilkins',name:'Wilkins Building',lat:51.5246,lng:-.1338}],privacy:()=>null,moderate:async()=>{throw Error('A second moderation call must not run')}};
const publish=(source,extraction,verdict)=>publishFreebie(db,source,extraction,deps,verdict);
async function clear(){await pg.exec('TRUNCATE freebie_tasks,freebie_scans,posts,freebie_venues RESTART IDENTITY CASCADE');await pg.exec('UPDATE freebie_worker SET lock_token=NULL,lock_until=0');}
async function seed(items,{pages=true}={}){const start=await actOnScan(db,config,{action:'start'});await insertEvents(db,start.run.id,items.map(i=>i.source));await db.prepare("UPDATE freebie_scans SET exhausted=1,status='running' WHERE id=?").bind(start.run.id).run();if(pages)for(const i of items)await db.prepare('UPDATE freebie_tasks SET page_json=? WHERE run_id=? AND event_id=?').bind(JSON.stringify(i.page),start.run.id,i.source.id).run();return start.run.id;}

test('30 events use one request with extraction and moderation, no adaptive thinking',async(t)=>{
 const calls=fakeProvider(t),items=Array.from({length:30},(_,i)=>item(i));
 const result=await askClaudeBatch(items,config);assert.equal(calls.length,1);assert.equal(result.size,30);
 assert.equal(calls[0].thinking,undefined);assert.ok(calls[0].max_tokens>2500);
 for(const i of items){assert.equal(result.get(i.id).checkpoint._processing.moderation.approved,true);assert.equal(result.get(i.id).checkpoint._processing.fingerprint,fingerprint(i,config.claudeModel));}
});
test('batch sizes respect complete text, 30-event cap and smaller retries',()=>{
 const items=Array.from({length:35},(_,i)=>item(i));assert.equal(selectBatch(items).length,30);
 const large=items.map(i=>({...i,page:{...i.page,text:'x'.repeat(40000)}}));assert.equal(selectBatch(large).length,1);assert.equal(selectBatch(large)[0].page.text.length,40000);
 assert.equal(selectBatch(items.map(i=>({...i,attempts:2}))).length,5);
});
test('wrong IDs, missing approvals and cross-event evidence fail only the affected rows',async(t)=>{
 const items=[item('good'),item('bad'),item('missing')];
 fakeProvider(t,row=>row.id==='missing'?null:row.id==='bad'?{...row,extraction:{...extraction,hasFreebies:true,freebies:[{item:'pizza',category:'food',certainty:'confirmed',evidence:'Free pizza for everyone'}]}}:row);
 const result=await askClaudeBatch(items,config);assert.ok(result.get('good').checkpoint);assert.ok(result.get('bad').error);assert.ok(result.get('missing').error);
});
test('duplicate response IDs never select an arbitrary approval',async(t)=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async()=>respond([{id:'one',extraction,moderation},{id:'one',extraction,moderation:{approved:false,reasons:['Held']}}]);
 assert.ok((await askClaudeBatch([item('one')],config)).get('one').error);
});
test('missing moderation and truncated batches cannot approve anything',async(t)=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async()=>respond([{id:'one',extraction}]);assert.ok((await askClaudeBatch([item('one')],config)).get('one').error);
 globalThis.fetch=async()=>respond([{id:'one',extraction,moderation}],'max_tokens');await assert.rejects(askClaudeBatch([item('one')],config),/cut short/);
});
test('cache reuse requires identical source, complete page, model and policy',async(t)=>{
 fakeProvider(t);const i=item('one'),saved=(await askClaudeBatch([i],config)).get(i.id).checkpoint;
 assert.ok(reusableCheckpoint(saved,i,config.claudeModel));
 for(const changed of [{...i,page:{...i.page,text:i.page.text+' Changed offer.'}},{...i,source:{...i.source,title:'Changed title'}}])assert.equal(reusableCheckpoint(saved,changed,config.claudeModel),null);
 assert.equal(reusableCheckpoint(saved,i,'different-model'),null);
 assert.equal(readCheckpoint({...saved,_processing:{...saved._processing,version:'old-policy'}}),null);
 assert.equal(readCheckpoint(extraction),null);
});
test('real pipeline publishes 30 events with one AI call and saves individual checkpoints',async(t)=>{
 await clear();const calls=fakeProvider(t),items=Array.from({length:30},(_,i)=>item(i)),id=await seed(items);
 const outcome=await workFreebies(db,config,publish,{sleep:async()=>{}});assert.equal(outcome.status,'complete');assert.equal(calls.length,1);
 const view=await dashboard(db,config,id);assert.equal(view.run.published,30);assert.equal(view.run.located,30);assert.equal(view.run.extracted,30);
 assert.equal(view.events[0].extraction._processing,undefined);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM posts').first()).n,30);
});
test('a changed source is reprocessed, unchanged rescans refetch pages but make zero AI calls',async(t)=>{
 await clear();const i=item('same'),calls=fakeProvider(t);await seed([i]);await workFreebies(db,config,publish,{sleep:async()=>{}});assert.equal(calls.length,1);
 let fetches=0;globalThis.fetch=async(url)=>{assert.equal(url,i.source.url);fetches++;return new Response(html,{headers:{'content-type':'text/html'}})};
 const id=await seed([i],{pages:false});await workFreebies(db,config,publish,{sleep:async()=>{}});assert.equal(fetches,1);assert.equal((await dashboard(db,config,id)).run.published,1);
 let ai=0;globalThis.fetch=async(url,options)=>{if(String(url).includes('api.anthropic.com')){ai++;return respond(JSON.parse(JSON.parse(options.body).messages[0].content).events.map(row=>({id:row.id,extraction,moderation})))}return new Response(html.replace('discussion.','discussion with a new speaker.'),{headers:{'content-type':'text/html'}})};
 await seed([i],{pages:false});await workFreebies(db,config,publish,{sleep:async()=>{}});assert.equal(ai,1);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM posts').first()).n,1);
});
test('ended listings are skipped before page fetch or Claude',async(t)=>{
 await clear();const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async()=>{throw Error('Must not spend on ended events')};
 const i=item('expired');i.source.end=new Date(Date.now()-1000).toISOString();const id=await seed([i],{pages:false});await workFreebies(db,config,publish,{sleep:async()=>{}});
 const view=await dashboard(db,config,id);assert.equal(view.events[0].publicationState,'expired');assert.equal(view.run.extracted,0);assert.equal(view.run.fetched,0);
});
test('held batch verdicts, local privacy checks and moderator decisions still prevent publication',async(t)=>{
 await clear();fakeProvider(t,row=>({...row,moderation:{approved:false,reasons:['Needs checking']}}));await seed([item('held')]);await workFreebies(db,config,publish,{sleep:async()=>{}});
 assert.equal((await db.prepare('SELECT status FROM posts').first()).status,'pending');
 await clear();const i=item('privacy');await publishFreebie(db,i.source,extraction,{...deps,privacy:()=> 'Private details'},moderation);assert.equal((await db.prepare('SELECT status FROM posts').first()).status,'pending');
 await db.prepare("UPDATE posts SET status='hidden',moderation_revision=1").run();assert.equal((await publishFreebie(db,i.source,extraction,deps,moderation)).state,'held_by_moderator');
});
test('automatic retry sends only failed IDs and does not rerun successful approvals',async(t)=>{
 await clear();const i=[item('good'),item('retry')],seen=[];let first=true;
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async(url,options)=>{const rows=JSON.parse(JSON.parse(options.body).messages[0].content).events;seen.push(rows.map(r=>r.id));const output=rows.filter(row=>!first||!row.id.includes('event-retry:')).map(row=>({id:row.id,extraction,moderation}));first=false;return respond(output)};
 await seed(i);const result=await workFreebies(db,config,publish,{sleep:async()=>{}});assert.equal(result.status,'complete');assert.equal(seen.length,2);assert.equal(seen[0].length,2);assert.equal(seen[1].length,1);assert.match(seen[1][0],/event-retry:/);
});
