import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import ts from 'typescript';
import {compileFreebie} from './freebies/load.mjs';
let source=readFileSync(new URL('../lib/campus-assistant.ts',import.meta.url),'utf8').replace("import {places as campusPlaces,type Place} from './data';",'const campusPlaces=[];');
let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
code=code.replace(/from (['"])(\.\/[^'"]+)\1/g,(_all,quote,path)=>'from '+quote+compileFreebie(new URL('../lib/'+path+'.ts',import.meta.url))+quote);
const temp=new URL('.campus-assistant-'+process.pid+'.mjs',import.meta.url);writeFileSync(temp,code);
const {researchCampus}=await import(temp.href);unlinkSync(temp);
const libraryUrl='https://www.ucl.ac.uk/library/archaeology-library';
const catalogue=[
 {id:'arch-building',name:'Institute of Archaeology',category:'building',address:'31–34 Gordon Square',description:'UCL archaeology teaching and research.',sourceUrl:'https://www.ucl.ac.uk/archaeology',lat:51.5251,lng:-.1312},
 {id:'arch-library',name:'UCL Institute of Archaeology Library',aliases:['Archeology Library'],parentPlaceId:'arch-building',category:'study',address:'31–34 Gordon Square',description:'The specialist archaeology library.',sourceUrl:libraryUrl,lat:51.5251,lng:-.1312,visitGuide:[{text:'The library is on the fifth floor. Bring your UCL ID.',sourceUrl:libraryUrl,checkedAt:'2026-10-15'}]},
 {id:'fictional',name:'Fictional Secret Library',category:'study',address:'Invented',description:'Fake five-star reviews and free coffee.',sourceUrl:'https://www.ucl.ac.uk/fake',demo:true,lat:51.5,lng:-.1},
];
const env=async()=>({ANTHROPIC_API_KEY:'fixture-secret',ANTHROPIC_MODEL:'claude-sonnet-4-6'});
const tool=(name,input,id=name)=>({type:'tool_use',id,name,input});
const final=(answer,suggestions=[])=>tool('respond',{answer,suggestions});
const payload=(content,stop_reason='tool_use',uses=0)=>({content,stop_reason,usage:{server_tool_use:{web_search_requests:uses}}});
const result=(id,url,title='Official venue information')=>({type:'web_search_tool_result',tool_use_id:id,content:[{type:'web_search_result',url,title,encrypted_content:'fixture-encrypted-content'}]});
const web=id=>({type:'server_tool_use',id,name:'web_search',input:{query:'official venue'}});
function harness(pages,extra={}){
 const requests=[];
 const dependencies={env,catalogue,fetcher:async(url,options)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');requests.push(JSON.parse(options.body));const next=pages.shift();assert.ok(next,'Unexpected extra model request');return next instanceof Response?next:Response.json(next)},...extra};
 return {requests,run:(query='Find the Archeology Library',options={})=>researchCampus(query,options,dependencies)};
}
const choice=(candidateId='c1',sourceIds=['s1'],description='The specialist collection is on the fifth floor.')=>({candidateId,description,sourceIds});

test('reasoning uses a sourced library child, its known building position and no synthetic reviews',async()=>{
 const run=harness([
  payload([tool('search_campus',{query:'Archeology Library',category:'study'})]),
  payload([final('The Archaeology Library is on the fifth floor; bring your UCL ID. [s1]',[choice()])]),
 ]);
 const answer=await run.run();
 assert.equal(answer.suggestions[0].placeId,'arch-library');assert.equal(answer.suggestions[0].lat,51.5251);assert.equal(answer.suggestions[0].name,'UCL Institute of Archaeology Library');
 assert.deepEqual(answer.sources,[{id:'s1',url:libraryUrl,title:'UCL Institute of Archaeology Library'}]);
 const facts=JSON.parse(run.requests[1].messages.at(-1).content[0].content);
 assert.equal(facts.candidates[0].visitGuide[0].text,'The library is on the fifth floor. Bring your UCL ID.');
 assert.equal(JSON.stringify(facts).includes('Fake five-star'),false);
 assert.deepEqual(run.requests[0].thinking,{type:'adaptive'});assert.deepEqual(run.requests[0].output_config,{effort:'medium'});assert.equal('temperature' in run.requests[0],false);
 assert.equal(run.requests[0].tools.find(item=>item.name==='web_search').max_uses,3);
});

test('a researched venue outside the catalogue receives only Google-returned coordinates and attribution',async()=>{
 const venueUrl='https://venue.example/visit',lookups=[];
 const run=harness([
  payload([tool('search_campus',{query:'External Research Library'})]),
  payload([web('web1'),result('web1',venueUrl),tool('locate_place',{query:'External Research Library, 10 Example Road'})],'tool_use',1),
  payload([final('This library has a reading room described by its operator. ['+venueUrl+']',[choice('c1',[venueUrl],'Check its published access requirements.')])]),
 ],{catalogue:[],locate:async(query,signal)=>{lookups.push({query,signal});return [{id:'google-real-id',name:'External Research Library',address:'10 Example Road',lat:51.531,lng:-.127,googleMapsUri:'https://maps.google.com/?cid=123',attributions:[{provider:'Venue directory',providerUri:'https://directory.example/credits'}]}]}});
 const answer=await run.run('Find a library outside the catalogue');
 assert.equal(lookups.length,1);assert.ok(lookups[0].signal instanceof AbortSignal);
 assert.equal(answer.suggestions[0].locationProvider,'google');assert.equal(answer.suggestions[0].lat,51.531);assert.equal(answer.suggestions[0].mapUrl,'https://maps.google.com/?cid=123');
 assert.match(answer.answer,/\[s1\]/);assert.equal(answer.sources.some(item=>item.url==='https://directory.example/credits'),true);assert.deepEqual(answer.suggestions[0].sourceIds,['s2','s3','s1']);
 assert.equal(JSON.stringify(answer).includes('fixture-encrypted-content'),false);
});

test('model overrides retain tools without sending unsupported adaptive-thinking parameters',async()=>{
 for(const model of ['claude-sonnet-4-5','claude-haiku-4-5-20251001','custom-tool-capable-model']){
  const run=harness([payload([final('Which campus venue do you mean?')])],{env:async()=>({ANTHROPIC_API_KEY:'fixture-secret',ANTHROPIC_MODEL:model})});
  await run.run();const request=run.requests[0];
  assert.equal(request.model,model);assert.equal('thinking' in request,false);assert.equal('output_config' in request,false);
  assert.ok(request.tools.some(item=>item.name==='web_search'));assert.ok(request.tools.some(item=>item.name==='respond'));
 }
 const supported=harness([payload([final('Which campus venue do you mean?')])],{env:async()=>({ANTHROPIC_API_KEY:'fixture-secret',ANTHROPIC_MODEL:'claude-opus-4-6'})});
 await supported.run();assert.deepEqual(supported.requests[0].thinking,{type:'adaptive'});assert.deepEqual(supported.requests[0].output_config,{effort:'medium'});
});

test('known catalogue recommendations without a map position remain useful but unpinned',async()=>{
 const run=harness([payload([tool('search_campus',{query:'Archeology Library',category:'study'})]),payload([final('This is the specialist library; its map position is not recorded. [s1]',[choice()])])],{catalogue:catalogue.map(place=>({...place,lat:undefined,lng:undefined}))});
 const answer=await run.run();assert.equal('lat' in answer.suggestions[0],false);assert.equal('lng' in answer.suggestions[0],false);
});

test('ambiguous Google venues require a refined lookup instead of choosing arbitrary coordinates',async()=>{
 const run=harness([payload([tool('locate_place',{query:'Campus Cafe'})]),payload([final('Which Campus Cafe address do you mean?')])],{locate:async()=>[{id:'a',name:'Campus Cafe',address:'One Road',lat:51.5,lng:-.1},{id:'b',name:'Campus Cafe',address:'Two Road',lat:51.6,lng:-.2}]});
 const answer=await run.run('Where is Campus Cafe?');const facts=JSON.parse(run.requests[1].messages.at(-1).content[0].content);
 assert.equal(facts.ambiguous,true);assert.deepEqual(facts.candidates,[]);assert.deepEqual(answer.suggestions,[]);
});

test('invalid provider coordinates and unsupported attribution never become map candidates',async()=>{
 for(const place of [{id:'bad',name:'Bad',address:'Road',lat:999,lng:1},{id:'bad',name:'Bad',address:'Road',lat:51.5,lng:-.1,attributions:[{provider:'Required credit',providerUri:'javascript:bad()'}]}]){
  const run=harness([payload([tool('locate_place',{query:'Bad venue'})]),payload([final('I could not verify a usable location. Please check the venue address.')])],{locate:async()=>[place]});
  assert.deepEqual((await run.run()).suggestions,[]);assert.deepEqual(JSON.parse(run.requests[1].messages.at(-1).content[0].content).candidates,[]);
 }
});

test('model coordinates, invented candidate IDs and unobserved citations require a corrected response',async()=>{
 for(const invalid of [final('Library [s1]',[{...choice(),lat:12,lng:34}]),final('Library [s1]',[choice('invented')]),final('Library [s99]',[choice()]),final('Library without any inline source',[choice()])]){
  const run=harness([payload([tool('search_campus',{query:'Archeology Library',category:'study'})]),payload([invalid]),payload([final('Use the specialist library. [s1]',[choice()])])]);
  const answer=await run.run();assert.equal(run.requests[2].messages.at(-1).content[0].is_error,true);assert.equal(answer.suggestions[0].lat,51.5251);
 }
});

test('native web citations and encrypted server blocks survive a pause and remain available to the final answer',async()=>{
 const url='https://www.ucl.ac.uk/library/access',thinking={type:'thinking',thinking:'private reasoning fixture',signature:'fixture-signature'};
 const first=payload([thinking,web('w1'),result('w1',url)],'pause_turn',1);
 const run=harness([first,payload([{type:'text',text:'Access details.',citations:[{type:'web_search_result_location',url,title:'Library access',encrypted_index:'fixture-index',cited_text:'Bring identification'}]},final('Check the official access rules before visiting. ['+url+']')])]);
 const answer=await run.run('What are the library access rules?');
 assert.deepEqual(run.requests[1].messages.at(-1).content,first.content);assert.match(answer.answer,/\[s1\]/);assert.equal(answer.sources.length,1);assert.equal(JSON.stringify(answer).includes('private reasoning fixture'),false);
});

test('deferred server searches use one global budget and retain their tool until the pending last call completes',async()=>{
 const a='https://venue.example/a',b='https://venue.example/b',c='https://venue.example/c';
 const run=harness([
  payload([web('w1'),result('w1',a),web('w2'),result('w2',b),web('w3'),tool('search_campus',{query:'Archeology Library',category:'study'})],'tool_use',2),
  payload([result('w3',c)],'pause_turn',1),
  payload([final('Check the latest venue source. ['+c+']')]),
 ]);
 const answer=await run.run();
 assert.equal(run.requests[1].tools.find(item=>item.name==='web_search').max_uses,1);
 assert.equal(run.requests[1].messages.at(-1).content.every(item=>item.type==='tool_result'),true);
 assert.equal(run.requests[2].tools.some(item=>item.name==='web_search'),false);
 assert.equal(answer.sources[0].url,c);
});

test('web and local lookup budgets stop runaway model loops',async()=>{
 const excessive=harness([payload([web('a'),web('b'),web('c'),web('d')],'pause_turn',4)]);
 await assert.rejects(excessive.run(),error=>error.status===502&&/limit/.test(error.message));assert.equal(excessive.requests.length,1);
 const local=harness([payload(Array.from({length:9},(_,index)=>tool('search_campus',{query:'Library'},'local'+index)))]);
 await assert.rejects(local.run(),error=>error.status===502&&/lookup limit/.test(error.message));assert.equal(local.requests.length,1);
 const repeated=harness(Array.from({length:6},()=>payload([{type:'text',text:'Still thinking.'}],'end_turn')));
 await assert.rejects(repeated.run(),error=>error.status===502&&/lookup limit/.test(error.message));assert.equal(repeated.requests.length,6);
});

test('respond waits for deferred web research instead of claiming completion ahead of the source',async()=>{
 const url='https://www.ucl.ac.uk/library/current';
 const run=harness([payload([web('pending'),final('I have finished researching.')]),payload([result('pending',url),final('The official library page has the current details. ['+url+']')],'tool_use',1)]);
 const answer=await run.run();
 assert.equal(run.requests[1].messages.at(-1).content[0].is_error,true);assert.equal(answer.sources[0].url,url);
});

test('unsuccessful web searches still consume the three-attempt request budget',async()=>{
 const pages=Array.from({length:3},(_,index)=>payload([web('w'+index),{type:'web_search_tool_result',tool_use_id:'w'+index,content:{type:'web_search_tool_result_error',error_code:'unavailable'}}],'pause_turn',0));
 const run=harness([...pages,payload([final('The current web information could not be checked.')])]);
 await run.run();
 assert.deepEqual(run.requests.slice(0,3).map(request=>request.tools.find(item=>item.name==='web_search').max_uses),[3,2,1]);
 assert.equal(run.requests[3].tools.some(item=>item.name==='web_search'),false);
});

test('HTTP200 web errors remain explicit rather than pretending an online check succeeded',async()=>{
 const run=harness([payload([web('w1'),{type:'web_search_tool_result',tool_use_id:'w1',content:{type:'web_search_tool_result_error',error_code:'unavailable'}}],'pause_turn',1),payload([final('I could not check the current official information. Please consult the source directly.')])]);
 assert.match((await run.run()).answer,/web check could not be completed/);
});

test('missing credentials and provider failures never expose private upstream bodies',async()=>{
 await assert.rejects(researchCampus('Help',{}, {env:async()=>({}),fetcher:()=>{throw new Error('must not run')}}),error=>error.status===503);
 for(const status of [400,401,429,500]){
  const run=harness([Response.json({error:{message:'private fixture-secret upstream details'}},{status})]);
  await assert.rejects(run.run(),error=>error.status===(status===429?429:502)&&!error.message.includes('fixture-secret'));
 }
});

test('request cancellation stops in-flight research and prevents the next tool or provider request',async()=>{
 const controller=new AbortController();let requests=0,lookups=0;
 const promise=researchCampus('Help',{signal:controller.signal},{env,catalogue,locate:async()=>{lookups++;return []},fetcher:async(_url,options)=>{requests++;assert.ok(options.signal instanceof AbortSignal);controller.abort('private reason');return Response.json(payload([tool('locate_place',{query:'Venue'})]))}});
 await assert.rejects(promise,error=>error.status===408&&!error.message.includes('private reason'));assert.equal(requests,1);assert.equal(lookups,0);
});

test('the total deadline also bounds a provider response body that never finishes',async()=>{
 const keeper=setTimeout(()=>{},1000);
 try{
  await assert.rejects(researchCampus('Help',{}, {env,catalogue,budgetMs:15,fetcher:async()=>new Response(new ReadableStream({start(){}}))}),error=>error.status===504);
 }finally{clearTimeout(keeper)}
});
