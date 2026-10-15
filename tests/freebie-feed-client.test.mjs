import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFreebie} from './freebies/load.mjs';
const {loadEventFeed}=await loadFreebie('lib/freebies/feed-client.ts');
const metadata={importReady:true,importStatus:'ready',lastScan:{start_date:'2026-10-15',end_date:'2026-10-29',updated_at:'2026-10-15T12:00:00Z',status:'complete',exhausted:1,coverageComplete:true}};
const event=id=>({id,type:'event',status:'approved',title:'Source event '+id,description:'A public event.',location:'Venue TBC',lat:null,lng:null,startsAt:'2026-10-16T12:00:00Z',expiresAt:'2026-10-16T13:00:00Z',dietary:[],freebie:null});
const page=(posts,nextOffset=null,meta=metadata)=>({...meta,posts,nextOffset});
const response=body=>Response.json(body);
const safeError=error=>error.message==='Union events could not refresh. Please try again.';

test('loads every page atomically, deduplicates events and preserves first-page public metadata',async()=>{
 const calls=[],controller=new AbortController(),firstMeta={...metadata,lastScan:{...metadata.lastScan,privateError:'private provider data'}};
 const pages=[page([event('a'),event('b')],50,firstMeta),page([{...event('b'),title:'Updated source event'},event('c')],null,{...metadata,lastScan:{...metadata.lastScan,updated_at:'2026-10-15T12:05:00Z'}})];
 const result=await loadEventFeed({signal:controller.signal,fetcher:async(url,options)=>{calls.push({url,options});return response(pages.shift())}});
 assert.deepEqual(calls.map(call=>call.url),['/api/freebies/feed?offset=0','/api/freebies/feed?offset=50']);
 for(const {options} of calls){assert.equal(options.cache,'no-store');assert.equal(options.signal,controller.signal)}
 assert.deepEqual(result.posts.map(post=>post.id),['a','b','c']);assert.equal(result.posts[1].title,'Updated source event');
 assert.deepEqual(result.metadata,metadata);assert.equal(JSON.stringify(result.metadata).includes('private provider data'),false);
});

test('empty successful feeds preserve the distinction between no imports and disabled imports',async()=>{
 for(const meta of [{...metadata,lastScan:null},{importReady:false,importStatus:'disabled',lastScan:null}]){
  const result=await loadEventFeed({fetcher:async()=>response(page([],null,meta))});
  assert.deepEqual(result,{posts:[],metadata:meta});
 }
});

test('a later page failure never resolves with a partial replacement feed or exposes backend errors',async()=>{
 let calls=0,settled=false;
 await assert.rejects(loadEventFeed({fetcher:async()=>++calls===1?response(page([event('a')],50)):Response.json({error:'private database password and provider body'},{status:503})}).then(result=>{settled=true;return result}),safeError);
 assert.equal(calls,2);assert.equal(settled,false);
});

test('network and malformed JSON errors have the same student-safe failure message',async()=>{
 for(const fetcher of [async()=>{throw new Error('private upstream details')},async()=>new Response('<html>Private server failure</html>',{status:200})])await assert.rejects(loadEventFeed({fetcher}),safeError);
});

test('rejects invalid, repeated, backwards and excessive pagination before another request',async()=>{
 for(const nextOffset of [0,-1,0.5,10001,'50',undefined,NaN,Infinity]){
  let calls=0;
  await assert.rejects(loadEventFeed({fetcher:async()=>{calls++;return {ok:true,json:async()=>({...metadata,posts:[event('a')],nextOffset})}}}),safeError);
  assert.equal(calls,1);
 }
 for(const second of [50,25]){
  let calls=0;
  await assert.rejects(loadEventFeed({fetcher:async()=>response(page([event(String(++calls))],calls===1?50:second))}),safeError);
  assert.equal(calls,2);
 }
 let emptyCalls=0;
 await assert.rejects(loadEventFeed({fetcher:async()=>{emptyCalls++;return response(page([],50))}}),safeError);
 assert.equal(emptyCalls,1);
});

test('allows the last supported offset and rejects a continuation past it',async()=>{
 const offsets=[];
 const result=await loadEventFeed({fetcher:async url=>{offsets.push(url);return response(page([event(String(offsets.length))],offsets.length===1?10000:null))}});
 assert.equal(result.posts.length,2);assert.equal(offsets[1],'/api/freebies/feed?offset=10000');
});

test('malformed post collections, coordinates and event details reject the whole feed',async()=>{
 const invalid=[null,{},[null],[{}],[{...event('a'),id:''}],[{...event('a'),title:4}],[{...event('a'),status:'pending'}],[{...event('a'),expiresAt:'invalid'}],[{...event('a'),lat:'51.5'}],[{...event('a'),lng:181}],[{...event('a'),dietary:{tag:'Vegan'}}],[{...event('a'),freebie:{conditions:'broken',freebies:[]}}],[{...event('a'),freebie:{conditions:[],freebies:[null]}}],Array.from({length:51},(_,i)=>event(String(i)))];
 for(const posts of invalid)await assert.rejects(loadEventFeed({fetcher:async()=>response(page(posts))}),safeError);
});

test('accepts source-backed freebie fields and valid located coordinates',async()=>{
 const post={...event('offer'),type:'freebie',lat:51.5246,lng:-.1338,freebie:{hasFreebies:true,conditions:['Members only'],freebies:[{item:'pizza',evidence:'Free pizza',category:'food',certainty:'confirmed'}],society:{name:'Example society',evidence:'Example society'},dietary:[{tag:'Vegan',evidence:'Vegan pizza'}],admission:'free',priceDetails:null,eligibility:null,bookingUrl:null,eventEnd:'2026-10-16T13:00:00Z'}};
 assert.deepEqual((await loadEventFeed({fetcher:async()=>response(page([post]))})).posts,[post]);
});

test('malformed or contradictory coverage metadata cannot masquerade as a current feed',async()=>{
 for(const meta of [{...metadata,importStatus:'secret text'},{...metadata,importReady:false},{...metadata,lastScan:undefined},{...metadata,lastScan:{...metadata.lastScan,start_date:'2026-02-30'}},{...metadata,lastScan:{...metadata.lastScan,status:'running'}},{...metadata,lastScan:{...metadata.lastScan,exhausted:0}},{...metadata,lastScan:{...metadata.lastScan,updated_at:'invalid'}}])await assert.rejects(loadEventFeed({fetcher:async()=>response(page([],null,meta))}),safeError);
});

test('cancellation stops pagination and never exposes an AbortSignal reason',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(loadEventFeed({signal:controller.signal,fetcher:async()=>{calls++;controller.abort('private cancellation reason');return response(page([event('a')],50))}}),error=>error.name==='AbortError'&&error.message==='Event loading was cancelled.');
 assert.equal(calls,1);
 await assert.rejects(loadEventFeed({signal:controller.signal,fetcher:async()=>{calls++;throw new Error('must not fetch')}}),error=>error.name==='AbortError');
 assert.equal(calls,1);
});
