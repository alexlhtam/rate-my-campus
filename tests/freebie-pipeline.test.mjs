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
test('Union publication caps lifetime at 14 days and expires at the source end',async()=>{
 await clear();
 const result=await publishFreebie(db,source,extraction,deps);
 assert.equal(Number((await db.prepare('SELECT expires_at FROM posts WHERE id=?').bind(result.id).first()).expires_at),Date.parse(source.end));
 const capped=await publishFreebie(db,{...source,id:'99:2:3',end:'2026-11-20T20:00:00Z'},extraction,deps);
 assert.equal(Number((await db.prepare('SELECT expires_at FROM posts WHERE id=?').bind(capped.id).first()).expires_at),now+14*86400000);
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
