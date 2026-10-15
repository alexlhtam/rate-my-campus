import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const searchSource=await readFile(new URL('../lib/campus-search.ts',import.meta.url),'utf8');
const {requestCampusSearch,localSearchFilters,SearchRequestError}=await import('data:text/javascript;base64,'+Buffer.from(compile(searchSource)).toString('base64'));
const viewSource=await readFile(new URL('../lib/campus-assistant-view.ts',import.meta.url),'utf8');
const {directoryAnswer}=await import('data:text/javascript;base64,'+Buffer.from(compile(viewSource)).toString('base64'));
const filters={query:'',category:'study',layer:'rated',tags:['plugs'],dietary:[],openNow:false};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};

test('the complete search request times out even if fetch never returns headers',async()=>{
 let signal;
 await assert.rejects(requestCampusSearch('study',{timeoutMs:10,fetcher:(_url,options)=>{signal=options.signal;return new Promise(()=>{})}}),/too long/);
 assert.equal(signal.aborted,true);
});

test('the complete search deadline also bounds response-body parsing',async()=>{
 let parsing=false;
 await assert.rejects(requestCampusSearch('study',{timeoutMs:10,fetcher:async()=>({ok:true,json:()=>{parsing=true;return new Promise(()=>{})}})}),/too long/);
 assert.equal(parsing,true);
});

test('cancelling search releases the caller even when the network ignores abort',async()=>{
 const controller=new AbortController();let signal;
 const request=requestCampusSearch('study',{signal:controller.signal,fetcher:(_url,options)=>{signal=options.signal;return new Promise(()=>{})}});
 controller.abort();
 await assert.rejects(request,{name:'AbortError'});assert.equal(signal.aborted,true);
 let calls=0;
 await assert.rejects(requestCampusSearch('study',{signal:controller.signal,fetcher:async()=>{calls++;return Response.json({filters})}}),{name:'AbortError'});
 assert.equal(calls,0);
});

test('successful requests send the question and preserve actionable authentication errors',async()=>{
 let sent;
 const result=await requestCampusSearch('a place with plugs',{fetcher:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return Response.json({filters})}});
 assert.deepEqual(sent,{url:'/api/assist',body:{action:'search',text:'a place with plugs'}});
 assert.deepEqual(result.filters,filters);
 await assert.rejects(requestCampusSearch('study',{fetcher:async()=>Response.json({error:'Sign in to use connected services.'},{status:401})}),error=>error instanceof SearchRequestError&&error.status===401&&/Sign in/.test(error.message));
});

// Execute the component's actual search handlers, with controlled setters and
// deferred network replies, so stale-response/input behavior is covered without
// a browser or a live Claude account.
const componentSource=await readFile(new URL('../components/campus-app.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('campus-app.tsx',componentSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const app=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='CampusApp');
const names=['search','cancelSearch','clearFilters'];
const handlers=names.map(name=>{
 const node=app.body.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text===name);
 assert.ok(node,`Missing real ${name} handler`);return node.getText(ast);
}).join('\n');
const setterKeys=['searchBusy','submittedQuery','searchFailed','searchNeedsSignIn','aiMessage','tab','mobileMap','searchTerm','searchTags','category','dietary','radius','nowOnly','freebieTime','layers','assistantResult','assistantSelected','assistantFocus'];
const factory=new Function('deps','requestCampusSearch','localSearchFilters','SearchRequestError','directoryAnswer',compile(`
 const state={query:deps.query??'where can I study',searchBusy:false,submittedQuery:'',searchFailed:false,searchNeedsSignIn:false,aiMessage:'',tab:'community',mobileMap:true,busy:true};
 let query=state.query;
 const setQuery=value=>{query=value;state.query=value};
 ${setterKeys.map(key=>`const set${key[0].toUpperCase()+key.slice(1)}=value=>{state.${key}=value};`).join('\n')}
 const setBusy=()=>{throw new Error('Search must not touch unrelated form loading state')};
 const searchSequence={current:0},searchController={current:null};
 const services=deps.services??{ai:true},stateLoaded=deps.stateLoaded??true,availablePlaces=deps.places??[];
 const applied=[];const applySearchFilters=value=>applied.push(value);
 const showAssistantResult=value=>{state.assistantResult=value};
 ${handlers}
 `)+'\nreturn {state,applied,search,cancelSearch,clearFilters,controller:searchController};');
const harness=(deps={})=>factory(deps,deps.request??requestCampusSearch,localSearchFilters,SearchRequestError,directoryAnswer);

test('submitting clears only the draft immediately and retains the question while awaiting Claude',async()=>{
 const pending=deferred();let question;
 const app=harness({request:input=>{question=input;return pending.promise}});
 const request=app.search({preventDefault(){}});
 assert.equal(app.state.query,'');assert.equal(app.state.submittedQuery,'where can I study');assert.equal(question,'where can I study');
 assert.equal(app.state.searchBusy,true);assert.equal(app.state.busy,true);
 assert.equal(app.state.tab,'explore');assert.equal(app.state.mobileMap,false);
 pending.resolve({filters,message:'Recorded study places.'});await request;
 assert.equal(app.state.searchBusy,false);assert.equal(app.state.submittedQuery,'where can I study');assert.equal(app.state.aiMessage,'Recorded study places.');assert.deepEqual(app.applied,[filters]);
});

test('a newer question aborts the old request and a late old reply cannot change current results',async()=>{
 const old=deferred(),latest=deferred(),signals=[];
 const app=harness({request:(question,options)=>{signals.push(options.signal);return question==='first question'?old.promise:latest.promise}});
 const first=app.search(undefined,'first question'),second=app.search(undefined,'second question');
 assert.equal(signals[0].aborted,true);
 old.resolve({filters:{query:'stale'},message:'Old answer'});await first;
 assert.deepEqual(app.applied,[]);assert.equal(app.state.searchBusy,true);assert.equal(app.state.submittedQuery,'second question');
 latest.resolve({filters,message:'New answer'});await second;
 assert.equal(app.state.aiMessage,'New answer');assert.deepEqual(app.applied,[filters]);
});

test('Cancel and Reset invalidate pending work without locking the search or another form',async()=>{
 for(const action of ['cancelSearch','clearFilters']){
  const pending=deferred(),app=harness({request:()=>pending.promise});
  const request=app.search();const signal=app.controller.current.signal;app[action]();
  assert.equal(signal.aborted,true);assert.equal(app.state.searchBusy,false);assert.equal(app.state.busy,true);
  pending.resolve({filters,message:'Late answer'});await request;
  assert.deepEqual(app.applied,[]);assert.notEqual(app.state.aiMessage,'Late answer');
  assert.equal(app.state.submittedQuery,action==='clearFilters'?'':'where can I study');
 }
});

test('failed searches retain the question for retry and preserve the previous map filters',async()=>{
 let attempt=0;
 const app=harness({request:async()=>{if(attempt++===0)throw new SearchRequestError('Sign in to use connected services.',401);return{filters,message:'Search recovered.'}}});
 await app.search();
 assert.equal(app.state.query,'');assert.equal(app.state.submittedQuery,'where can I study');assert.equal(app.state.searchBusy,false);
 assert.equal(app.state.searchFailed,true);assert.equal(app.state.searchNeedsSignIn,true);assert.deepEqual(app.applied,[]);assert.match(app.state.aiMessage,/previous results are unchanged/);
 await app.search(undefined,app.state.submittedQuery);
 assert.equal(app.state.searchFailed,false);assert.equal(app.state.searchNeedsSignIn,false);assert.equal(app.state.aiMessage,'Search recovered.');
});

test('exact names and disconnected keyword search also clear their submitted draft',async()=>{
 const exact=harness({query:'  Main Library  ',places:[{id:'main-library',name:'Main Library',address:'Wilkins Building',description:'Campus library',aliases:[]}],request:()=>{throw new Error('Exact names do not need Claude')}});
 await exact.search();assert.equal(exact.state.query,'');assert.equal(exact.state.submittedQuery,'Main Library');assert.equal(exact.state.searchBusy,false);assert.deepEqual(exact.applied,[{query:'Main Library',layer:'rated'}]);
 const offline=harness({query:'quiet study with plugs',services:{ai:false}});await offline.search();
 assert.equal(offline.state.query,'');assert.equal(offline.state.submittedQuery,'quiet study with plugs');assert.match(offline.state.aiMessage,/not connected/);assert.deepEqual(offline.applied[0].tags,['quiet','plugs']);
});

test('researched answers reach the map state, and Reset clears their private pins',async()=>{
 const assistant={answer:'A source-backed answer.',sources:[],suggestions:[{id:'campus:main-library',name:'Main Library'}]};
 const app=harness({request:async()=>({filters:null,message:assistant.answer,assistant})});
 await app.search();assert.deepEqual(app.state.assistantResult,assistant);assert.deepEqual(app.applied,[]);
 app.clearFilters();assert.equal(app.state.assistantResult,null);assert.equal(app.state.assistantFocus,undefined);assert.equal(app.state.assistantSelected,null);
});

test('unknown service status does not prematurely bypass connected search',async()=>{
 for(const stateLoaded of [false,true]){
  let calls=0;const app=harness({services:{},stateLoaded,request:async()=>{calls++;return{filters:null,message:'Which kind of campus place?'}}});
  await app.search();assert.equal(calls,1);assert.equal(app.state.aiMessage,'Which kind of campus place?');assert.deepEqual(app.applied,[]);
 }
});
