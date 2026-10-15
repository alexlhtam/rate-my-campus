import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadFreebie} from './freebies/load.mjs';
const {createDatabase}=await loadFreebie('lib/db.ts');
const {publishFreebie,matchCampusVenue,publicFreebie}=await loadFreebie('lib/freebies/publication.ts');
const {resolveVenue}=await loadFreebie('lib/freebies/venues.ts');
const {actOnScan}=await loadFreebie('lib/freebies/pipeline.ts');
const {insertEvents,acquireLock,releaseLock}=await loadFreebie('lib/freebies/store.ts');
const {workFreebies}=await loadFreebie('lib/freebies/worker.ts');
const {eventWindow,inFreebieWindow,eventBadge,csvCell}=await loadFreebie('lib/freebies/view.ts');
const {verifyExtraction}=await loadFreebie('lib/freebies/providers.ts');
const pg=new PGlite();
for(const name of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8').split('-- Private bucket')[0]);
const runner=on=>async(sql,args)=>(await on.query(sql,args)).rows;
const db=createDatabase(runner(pg),work=>pg.transaction(tx=>work(runner(tx))));
after(()=>pg.close());
const now=Date.parse('2026-10-12T12:00:00Z');
const places=[{id:'wilkins',name:'Wilkins Building',aliases:['Wilkins'],lat:51.5246,lng:-.1338}];
const source={id:'42:1791831600:1791835200',url:'https://studentsunionucl.org/whats-on/clubs-societies/example?v=1',title:'Example pizza night',start:'2026-10-12T19:00:00Z',end:'2026-10-12T20:00:00Z',sourceLocation:'Wilkins Building',imageUrl:null};
const extraction={hasFreebies:true,summary:'Pizza is included.',freebies:[{item:'Pizza',category:'food',certainty:'confirmed',evidence:'Free Pizza for everyone'}],venue:'Wilkins Building',address:null,locationEvidence:'Wilkins Building',admission:'paid',priceDetails:'£5 ticket includes pizza',bookingRequired:true,bookingUrl:null,eligibility:'Members',conditions:[],dietary:[]};
const ordinary={...extraction,hasFreebies:false,summary:'A student society discussion.',freebies:[],admission:'free',priceDetails:'Free entry'};
const deps={places,moderate:async()=>({approved:true,reasons:[]}),privacy:()=>null,now:()=>now};
async function clear(){await pg.exec('TRUNCATE freebie_tasks,freebie_scans,posts,freebie_venues RESTART IDENTITY CASCADE');await pg.exec("UPDATE freebie_worker SET lock_token=NULL,lock_until=0");}

test('publication uses the real schema: auto-approval, paid-ticket metadata, dedup and changed end time',async()=>{
 await clear();
 const first=await publishFreebie(db,source,extraction,deps);assert.equal(first.state,'published');
 const second=await publishFreebie(db,{...source,id:'42:1791831600:1791840000',end:'2026-10-12T21:20:00Z'},extraction,deps);assert.equal(first.id,second.id);
 const rows=await db.prepare('SELECT * FROM posts').all();assert.equal(rows.results.length,1);
 assert.equal(Number(rows.results[0].expires_at),Date.parse('2026-10-12T21:20:00Z'));
 assert.equal(publicFreebie(rows.results[0]).freebie.admission,'paid');
});

test('ordinary events publish without inventing freebies and classification changes update the same occurrence',async()=>{
 await clear();
 const first=await publishFreebie(db,{...source,sourceOrganizer:'Example Society'},ordinary,deps);
 assert.equal(first.state,'published');
 let row=await db.prepare('SELECT * FROM posts WHERE id=?').bind(first.id).first();
 assert.equal(row.type,'event');assert.equal(publicFreebie(row).type,'event');
 assert.equal(publicFreebie(row).freebie.hasFreebies,false);assert.deepEqual(publicFreebie(row).freebie.freebies,[]);
 assert.equal(publicFreebie(row).freebie.society.name,'Example Society');
 const offer=await publishFreebie(db,source,extraction,deps);assert.equal(offer.id,first.id);
 row=await db.prepare('SELECT * FROM posts WHERE id=?').bind(first.id).first();assert.equal(row.type,'freebie');
 const reverted=await publishFreebie(db,source,ordinary,deps);assert.equal(reverted.id,first.id);
 row=await db.prepare('SELECT * FROM posts WHERE id=?').bind(first.id).first();assert.equal(row.type,'event');assert.equal(row.status,'approved');
 assert.equal((await db.prepare('SELECT id FROM posts').all()).results.length,1);
});

test('missing extraction does not create an event, and ordinary events retain moderation and online safeguards',async()=>{
 await clear();await publishFreebie(db,source,null,deps);
 assert.equal((await db.prepare('SELECT id FROM posts').all()).results.length,0);
 await assert.rejects(publishFreebie(db,source,ordinary,{...deps,moderate:async()=>{throw Error('Unavailable')}}));
 assert.equal((await db.prepare('SELECT id FROM posts').all()).results.length,0);
 const event=await publishFreebie(db,{...source,sourceOnline:true},ordinary,{...deps,moderate:async()=>({approved:false,reasons:['Review required']})});
 const row=await db.prepare('SELECT * FROM posts WHERE id=?').bind(event.id).first();
 assert.equal(event.state,'needs_review');assert.equal(row.status,'pending');assert.equal(row.lat,null);
 assert.equal(publicFreebie(row).freebie.attendance,'online');
});
test('unknown and online venues stay unlocated; possible costs are pending',async()=>{
 await clear();
 const online=await publishFreebie(db,source,{...extraction,attendance:'online'},deps);
 assert.equal((await db.prepare('SELECT lat FROM posts WHERE id=?').bind(online.id).first()).lat,null);
 await clear();
 const held=await publishFreebie(db,source,{...extraction,venue:'Unconfirmed room',freebies:[{...extraction.freebies[0],certainty:'possible'}]},deps);
 assert.equal(held.state,'needs_review');
 assert.equal((await db.prepare('SELECT lat FROM posts WHERE id=?').bind(held.id).first()).lat,null);
});
test('a provider failure cannot approve; hidden pins cannot be republished',async()=>{
 await clear();
 await assert.rejects(publishFreebie(db,source,extraction,{...deps,moderate:async()=>{throw Error('Unavailable')}}));
 assert.equal((await db.prepare('SELECT * FROM posts').all()).results.length,0);
 const posted=await publishFreebie(db,source,extraction,deps);
 await db.prepare("UPDATE posts SET status='hidden',moderation_revision=1 WHERE id=?").bind(posted.id).run();
 assert.equal((await publishFreebie(db,source,extraction,deps)).state,'held_by_moderator');
});
test('a moderator decision during the provider call wins the publication race',async()=>{
 await clear();const posted=await publishFreebie(db,source,extraction,deps);
 const result=await publishFreebie(db,source,extraction,{...deps,moderate:async()=>{await db.prepare("UPDATE posts SET status='hidden',moderation_revision=moderation_revision+1 WHERE id=?").bind(posted.id).run();return {approved:true,reasons:[]}}});
 assert.equal(result.state,'held_by_moderator');
});
test('source withdrawal removes an old offer and separate recurrences remain separate',async()=>{
 await clear();const first=await publishFreebie(db,source,extraction,deps);
 await publishFreebie(db,{...source,id:'42:1791918000:1791921600',start:'2026-10-13T19:00:00Z',end:'2026-10-13T20:00:00Z'},extraction,deps);
 await publishFreebie(db,source,null,deps);
 assert.equal((await db.prepare('SELECT status FROM posts WHERE id=?').bind(first.id).first()).status,'hidden');
 assert.equal((await db.prepare("SELECT id FROM posts WHERE status='approved'").all()).results.length,1);
});
test('a venue correction made during moderation is not overwritten by an old lookup',async()=>{
 await clear();const posted=await publishFreebie(db,source,extraction,deps);
 await publishFreebie(db,source,extraction,{...deps,moderate:async()=>{
  await db.prepare("UPDATE posts SET lat=51.55,lng=-.12,source_location_revision=source_location_revision+1 WHERE id=?").bind(posted.id).run();
  return {approved:true,reasons:[]};
 }});
 assert.equal((await db.prepare('SELECT lat FROM posts WHERE id=?').bind(posted.id).first()).lat,51.55);
});
test('Union publication caps lifetime at the London fourteen-date boundary and preserves the source end',async()=>{
 await clear();
 const result=await publishFreebie(db,source,extraction,deps);
 assert.equal(Number((await db.prepare('SELECT expires_at FROM posts WHERE id=?').bind(result.id).first()).expires_at),Date.parse(source.end));
 const capped=await publishFreebie(db,{...source,id:'99:2:3',end:'2026-11-20T20:00:00Z'},extraction,deps);
 const row=await db.prepare('SELECT expires_at,freebie_json FROM posts WHERE id=?').bind(capped.id).first();
 assert.equal(Number(row.expires_at),Date.parse('2026-10-26T00:00:00Z'));
 assert.equal(JSON.parse(row.freebie_json).eventEnd,'2026-11-20T20:00:00Z');
});

test('a last-night event across the London autumn clock change expires after its start',async()=>{
 await clear();const clock=Date.parse('2026-10-14T23:00:00Z');
 const late={...source,id:'99:1793230200:1793235600',start:'2026-10-28T23:30:00Z',end:'2026-10-29T01:00:00Z'};
 const result=await publishFreebie(db,late,ordinary,{...deps,now:()=>clock});
 assert.equal(result.state,'published');
 const row=await db.prepare('SELECT starts_at,expires_at,freebie_json FROM posts WHERE id=?').bind(result.id).first();
 assert.equal(Number(row.expires_at),Date.parse('2026-10-29T00:00:00Z'));
 assert.ok(Number(row.expires_at)>Number(row.starts_at));
 assert.equal(JSON.parse(row.freebie_json).eventEnd,late.end);
});

test('missing or nonpositive event duration cannot become an invented live event',async()=>{
 await clear();
 for(const end of [null,source.start,'invalid'])await assert.rejects(publishFreebie(db,{...source,end},ordinary,deps),/later end time/);
 assert.equal((await db.prepare('SELECT id FROM posts').all()).results.length,0);
});
test('campus matching and Google cache avoid duplicate lookups, reject ambiguity and TBC',async()=>{
 await clear();let calls=0;const lookup=async()=>{calls++;return [{id:'place-42',name:'Example Hall',lat:51.51,lng:-.13}]};
 assert.equal((await resolveVenue(db,'Wilkins North Cloisters',places,lookup,now)).provider,'campus');assert.equal(calls,0);
 const matches=await Promise.all([resolveVenue(db,'Example Hall',places,lookup,now),resolveVenue(db,'Example Hall',places,lookup,now)]);
 assert.equal(calls,1);assert.equal(matches[0].googlePlaceId,'place-42');
 await resolveVenue(db,'Example Hall',places,lookup,now+86400000);assert.equal(calls,1);
 assert.equal(await resolveVenue(db,'Online Zoom',places,lookup,now),null);
 assert.equal(await resolveVenue(db,'TBC',places,lookup,now),null);assert.equal(calls,1);
 assert.equal(matchCampusVenue('Wilkins Building',[...places,{...places[0],id:'other',lat:51.5}]),null);
 await resolveVenue(db,'Example Hall',places,lookup,now+31*86400000);assert.equal(calls,2);
});
test('London time filters include live cross-midnight events and handle the DST week',()=>{
 const clock=Date.parse('2026-10-25T00:30:00Z');
 assert.equal(eventWindow('today',clock).end,Date.parse('2026-10-26T00:00:00Z'));
 assert.equal(eventWindow('week',clock).end,Date.parse('2026-10-26T00:00:00Z'));
 assert.equal(eventWindow('fortnight',clock).end,Date.parse('2026-11-08T00:00:00Z'));
 assert.equal(inFreebieWindow({startsAt:'2026-10-24T22:00:00Z',expiresAt:'2026-10-25T02:00:00Z'},'now',clock),true);
 assert.equal(inFreebieWindow({startsAt:'2026-10-26T00:00:00Z',expiresAt:'2026-10-26T01:00:00Z'},'today',clock),false);
 assert.equal(eventBadge({startsAt:'2026-10-24T22:00:00Z',expiresAt:new Date(clock).toISOString()},clock).state,'ended');
 assert.equal(eventBadge({startsAt:'2026-10-25T01:30:00Z',expiresAt:'2026-10-25T02:30:00Z'},clock).state,'upcoming');
 assert.match(csvCell('=WEBSERVICE(\"bad\")'),/^"'/);
});
test('society and dietary claims require matching evidence; unsupported claims are omitted',()=>{
 const page={text:'Example Society offers Free Pizza for everyone. Vegan pizza available. Wilkins Building',links:[]};
 const actual=verifyExtraction({...extraction,society:{name:'Invented Society',evidence:'Example Society'},dietary:[{tag:'Vegan',evidence:'Vegan pizza available.'},{tag:'Halal',evidence:'Vegan pizza available.'}]},page);
 assert.equal(actual.society,null);assert.deepEqual(actual.dietary.map(item=>item.tag),['Vegan']);
});
test('saved stages resume automatically without a browser; a publication failure retries only that stage',async(t)=>{
 t.mock.method(Date,'now',()=>now);
 await clear();const config={jevKey:'',claudeKey:'fixture',jevModel:'jev-latest',claudeModel:'fixture',threshold:.5};
 const start=await actOnScan(db,config,{action:'start',startDate:'2026-10-12'});const id=start.run.id;
 await insertEvents(db,id,[source,source]);assert.equal((await db.prepare('SELECT * FROM freebie_tasks').all()).results.length,1);
 await db.prepare("UPDATE freebie_scans SET exhausted=1,status='running' WHERE id=?").bind(id).run();
 await db.prepare('UPDATE freebie_tasks SET page_json=?,extraction_json=? WHERE run_id=?').bind(JSON.stringify({text:'fixture'}),JSON.stringify(extraction),id).run();
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async()=>{throw Error('Checkpoint must not call a provider again')};
 let calls=0;
 const result=await workFreebies(db,config,async()=>{if(++calls===1)throw Error('Temporary publish error');return {id:'saved',state:'published'}},{sleep:async()=>{}});
 assert.equal(result.more,false);assert.equal(result.status,'complete');assert.equal(calls,2);
 const row=await db.prepare('SELECT * FROM freebie_tasks').first();assert.equal(row.status,'found');
});
test('leases reject overlapping batches and recover abandoned workers',async()=>{
 await clear();const config={jevKey:'',claudeKey:'fixture',jevModel:'j',claudeModel:'c',threshold:.5};
 const run=await actOnScan(db,config,{action:'start',startDate:'2026-10-12'});
 const token=await acquireLock(db,run.run.id);assert.ok(token);assert.equal(await acquireLock(db,run.run.id),null);
 await releaseLock(db,run.run.id,'wrong-token');assert.equal(await acquireLock(db,run.run.id),null);
 await releaseLock(db,run.run.id,token);assert.ok(await acquireLock(db,run.run.id));
 await pg.exec("UPDATE freebie_worker SET lock_until=9999999999999");
 assert.equal((await workFreebies(db,config,async()=>{throw Error('Must not publish')})).busy,true);
});
test('a fresh import discovers pages, opens the event, runs Claude and publishes without browser steps',async(t)=>{
 await clear();const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
 const startSeconds=Math.floor((Date.now()+3600000)/1000),endSeconds=startSeconds+3600;
 const eventRow={product_id:'500',variation_id:'700',title:'Example pizza',variation_url:'https://studentsunionucl.org/whats-on/clubs-societies/example',field_date_range_value:String(startSeconds),field_date_range_end_value:String(endSeconds),field_event_venue__label:'Wilkins Building'};
 let pages=0,details=0,claude=0;
 globalThis.fetch=async(url,options)=>{
  const address=String(url);
  if(address.startsWith('https://api.anthropic.com/')){claude++;return Response.json({model:'fixture',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({events:JSON.parse(JSON.parse(options.body).messages[0].content).events.map(item=>({id:item.id,extraction,moderation:{approved:true,reasons:[]}}))})}]})}
  if(address.includes('/whats-on/clubs-societies/')){details++;return new Response('<main><article><div class="field--name-body">Free Pizza for everyone. Wilkins Building. Tickets cost £5.</div></article></main>',{headers:{'content-type':'text/html'}})}
  if(address.startsWith('https://studentsunionucl.org/')){pages++;return Response.json(pages===1?[eventRow,eventRow]:[])}
  throw Error('Unexpected external request');
 };
 const config={jevKey:'',claudeKey:'fixture',jevModel:'j',claudeModel:'fixture',threshold:.5};
 await actOnScan(db,config,{action:'start'});
 const result=await workFreebies(db,config,(source,extraction)=>publishFreebie(db,source,extraction,{...deps,now:Date.now}),{sleep:async()=>{}});
 assert.equal(result.status,'complete');assert.equal(pages,2);assert.equal(details,1);assert.equal(claude,1);
 const rows=await db.prepare('SELECT * FROM posts').all();assert.equal(rows.results.length,1);assert.equal(rows.results[0].status,'approved');
 assert.equal(Number(rows.results[0].expires_at),endSeconds*1000);
});

test('ordinary events receive a full Claude check even when a legacy Jev rejection is saved',async(t)=>{
 t.mock.method(Date,'now',()=>now);
 await clear();const config={jevKey:'legacy-fixture',claudeKey:'fixture',jevModel:'j',claudeModel:'fixture',threshold:.5};
 const run=await actOnScan(db,config,{action:'start',startDate:'2026-10-12'});
 await insertEvents(db,run.run.id,[source]);
 await db.prepare("UPDATE freebie_scans SET exhausted=1,status='running' WHERE id=?").bind(run.run.id).run();
 await db.prepare('UPDATE freebie_tasks SET page_json=?,jev_json=? WHERE run_id=?').bind(JSON.stringify({text:'A student society discussion. Wilkins Building. Free entry.',links:[]}),JSON.stringify({score:0}),run.run.id).run();
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let claude=0;
 globalThis.fetch=async(url,options)=>{assert.match(String(url),/^https:\/\/api\.anthropic\.com\//);claude++;return Response.json({model:'fixture',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({events:JSON.parse(JSON.parse(options.body).messages[0].content).events.map(item=>({id:item.id,extraction:ordinary,moderation:{approved:true,reasons:[]}}))})}]})};
 const result=await workFreebies(db,config,(event,details)=>publishFreebie(db,event,details,deps),{sleep:async()=>{}});
 assert.equal(result.status,'complete');assert.equal(claude,1);
 const task=await db.prepare('SELECT * FROM freebie_tasks').first();assert.equal(task.status,'no_freebies');assert.equal(task.publication_state,'published');assert.ok(task.published_post_id);
 assert.equal((await db.prepare('SELECT type FROM posts').first()).type,'event');
});


test('campus names take precedence over inherited room aliases without guessing different positions',()=>{
 const building=places[0],room={...building,id:'room',name:'Lecture Room',aliases:['Wilkins Building','Wilkins'],parentPlaceId:building.id};
 assert.equal(matchCampusVenue('Wilkins Building',[room,building]).id,building.id);
 assert.equal(matchCampusVenue('Wilkins',[room,building]).id,building.id);
 assert.equal(matchCampusVenue('Wilkins',[{...room,lat:51.6},building]),null);
});
test('confirmed venue labels survive rescans until the listing changes venue',async()=>{
 await clear();const posted=await publishFreebie(db,source,extraction,deps);
 await db.prepare("UPDATE posts SET location='Confirmed Hall',lat=51.55,lng=-.12,freebie_json=jsonb_set(freebie_json::jsonb,'{locationConfirmed}','true'::jsonb)::text WHERE id=?").bind(posted.id).run();
 await publishFreebie(db,source,extraction,deps);
 let row=await db.prepare('SELECT * FROM posts WHERE id=?').bind(posted.id).first();assert.equal(row.location,'Confirmed Hall');assert.equal(row.lat,51.55);
 await publishFreebie(db,source,{...extraction,venue:'Different unknown venue'},deps);
 row=await db.prepare('SELECT * FROM posts WHERE id=?').bind(posted.id).first();assert.equal(row.location,'Different unknown venue');assert.equal(row.lat,null);
});
