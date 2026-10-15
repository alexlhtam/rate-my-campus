import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname,basename} from 'node:path';
import ts from 'typescript';

const temp=await mkdtemp(fileURLToPath(new URL('.community-interactions-',import.meta.url)));
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
await writeFile(join(temp,'hooks.mjs'),'export const useState=(...args)=>globalThis.__interactionHooks.useState(...args); export const useEffect=(...args)=>globalThis.__interactionHooks.useEffect(...args); export const useRef=(...args)=>globalThis.__interactionHooks.useRef(...args);');
await writeFile(join(temp,'view.mjs'),compile(await readFile(new URL('../lib/community-view.ts',import.meta.url),'utf8')));
const communitySource=(await readFile(new URL('../components/place-community.tsx',import.meta.url),'utf8')).replace("from 'react'","from './hooks.mjs'").replace("from '@/lib/community-view'","from './view.mjs'");
const inboxSource=(await readFile(new URL('../components/campus-inbox.tsx',import.meta.url),'utf8')).replace("from 'react'","from './hooks.mjs'").replace("import { places } from '@/lib/data';",'const places=[];');
await writeFile(join(temp,'community.mjs'),compile(communitySource));
await writeFile(join(temp,'inbox.mjs'),compile(inboxSource));
const PlaceCommunity=(await import(pathToFileURL(join(temp,'community.mjs')).href)).default;
const {FollowPlace}=await import(pathToFileURL(join(temp,'inbox.mjs')).href);
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
function nodes(node,predicate,result=[]){if(node&&typeof node==='object'){if(predicate(node))result.push(node);for(const child of Array.isArray(node)?node:[node.props?.children])nodes(child,predicate,result)}return result}
// Real component render and event handlers, isolated hook slots per instance.
// Child Replies receives its own scheduler, exactly as a separate React component.
function harness(Component,initialProps){
  const slots=[];let cursor=0,pending=[],dirty=true,props=initialProps,tree;
  const hooks={
    useState(initial){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,update=>{const next=typeof update==='function'?update(slots[index].value):update;if(!Object.is(next,slots[index].value)){slots[index].value=next;dirty=true}}]},
    useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index]},
    useEffect(effect,deps){const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(previous.deps?.[i],value))){slots[index]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[index].cleanup?.();slots[index].cleanup=effect()})}},
  };
  function render(){let cycles=0;while(dirty){if(++cycles>20)throw new Error('Unexpected render loop');dirty=false;cursor=0;pending=[];globalThis.__interactionHooks=hooks;tree=Component(props);for(const effect of pending)effect()}return tree}
  return{render,async flush(){render();for(let i=0;i<3;i++){await new Promise(resolve=>setImmediate(resolve));render()}return tree},update(next){props={...props,...next};dirty=true},cleanup(){for(const slot of slots)slot.cleanup?.();delete globalThis.__interactionHooks}};
}
const response=(body,ok=true)=>({ok,async json(){return body}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const button=(tree,label)=>{const found=nodes(tree,node=>node.type==='button'&&text(node)===label)[0];assert.ok(found,`Missing button: ${label}`);return found};
const replyNode=tree=>nodes(tree,node=>typeof node.type==='function'&&node.type.name==='Replies')[0];
const base={place:{id:'library',category:'study'},demo:false,tab:'community',reviews:[],threads:[],replies:[],summary:{count:0},votes:{},ai:false,refreshKey:'v1',onReview(){},onThread(){},onReport(){},async onAction(){},onNotice(){}};
const threads=['first','requested'].map(id=>({id,placeId:'library',title:`Conversation ${id}`,text:'A question about this place',status:'approved'}));

test('a requested live thread opens its actual replies and composer after the thread list loads',async()=>{
  const originalFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async url=>{const params=new URL(url,'https://campus.test').searchParams;requests.push(Object.fromEntries(params));return response(params.get('kind')==='replies'?{rows:[{id:'reply-1',text:'Reply for the requested thread',status:'approved'}],total:1}:{rows:threads,total:threads.length})};
  const app=harness(PlaceCommunity,{...base,initialThread:'requested'});let replies;
  try{
    const tree=await app.flush(),child=replyNode(tree);assert.ok(child);assert.equal(child.props.threadId,'requested');
    replies=harness(child.type,child.props);const content=await replies.flush();
    assert.match(text(content),/Reply for the requested thread/);assert.equal(nodes(content,node=>node.type==='form').length,1);
    assert.equal(nodes(content,node=>node.type==='input'&&node.props['aria-label']==='Your reply').length,1);
    assert.equal(requests.find(request=>request.kind==='replies').threadId,'requested');
  }finally{replies?.cleanup();app.cleanup();globalThis.fetch=originalFetch}
});

test('changing a requested thread at the same place preserves the fetched list and opens the new conversation',async()=>{
  const originalFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return response({rows:threads,total:threads.length})};
  const app=harness(PlaceCommunity,{...base,initialThread:'first'});
  try{
    assert.equal(replyNode(await app.flush())?.props.threadId,'first');
    app.update({initialThread:'requested'});const tree=await app.flush();
    assert.match(text(tree),/Conversation first/);assert.match(text(tree),/Conversation requested/);
    assert.equal(replyNode(tree)?.props.threadId,'requested');assert.equal(requests,1,'Selecting a loaded thread should retain the loaded list');
  }finally{app.cleanup();globalThis.fetch=originalFetch}
});

test('an approved requested thread supplied by a teaser opens even when it is outside the first fetched page',async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>response({rows:[threads[0]],total:31});
  const app=harness(PlaceCommunity,{...base,initialThread:'requested',threads:[threads[1]]});
  try{
    const tree=await app.flush();assert.match(text(tree),/Conversation first/);assert.match(text(tree),/Conversation requested/);
    assert.equal(replyNode(tree)?.props.threadId,'requested');
    assert.ok(button(tree,'Load more conversations'),'The supplied teaser must not consume a server page offset');
  }finally{app.cleanup();globalThis.fetch=originalFetch}
});

test('a requested pending thread stays private and cannot render a reply composer',async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>response({rows:[{...threads[1],status:'pending',own:true}],total:1});
  const app=harness(PlaceCommunity,{...base,initialThread:'requested'});
  try{const tree=await app.flush();assert.equal(replyNode(tree),undefined);assert.match(text(tree),/pending · visible only to you/)}finally{app.cleanup();globalThis.fetch=originalFetch}
});

test('failed follow preferences can be retried and the recovered Follow action writes the latest list',async()=>{
  const originalFetch=globalThis.fetch,calls=[];let fail=true;
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(fail){fail=false;return response({error:'Preferences temporarily unavailable'},false)}return response(options.body?{follows:JSON.parse(options.body).follows}:{follows:['another-place']})};
  const app=harness(FollowPlace,{placeId:'library',enabled:true,onAccount(){throw new Error('Already signed in')}});
  try{
    let tree=await app.flush();assert.match(text(tree),/Preferences temporarily unavailable/);assert.equal(button(tree,'Follow place').props.disabled,true);
    button(tree,'Try again').props.onClick();tree=await app.flush();
    assert.doesNotMatch(text(tree),/Preferences temporarily unavailable/);assert.equal(button(tree,'Follow place').props.disabled,false);
    await button(tree,'Follow place').props.onClick();tree=await app.flush();
    assert.equal(button(tree,'Following').props['aria-pressed'],true);assert.match(text(tree),/New reviews and discussions/);
    const write=calls.find(call=>call.options.method==='POST');assert.ok(write);assert.deepEqual(JSON.parse(write.options.body),{follows:['another-place','library']});assert.equal(calls.length,4);
  }finally{app.cleanup();globalThis.fetch=originalFetch}
});

test('reply loading is visible, a failed request can retry, and successful retry restores replies and the form',async()=>{
  const originalFetch=globalThis.fetch,initial=deferred(),retry=deferred();let replyRequests=0;
  globalThis.fetch=async url=>new URL(url,'https://campus.test').searchParams.get('kind')==='replies'?(++replyRequests===1?initial.promise:retry.promise):response({rows:threads,total:threads.length});
  const app=harness(PlaceCommunity,{...base,initialThread:'requested'});let replies;
  try{
    const child=replyNode(await app.flush());assert.ok(child);replies=harness(child.type,child.props);
    assert.match(text(replies.render()),/Loading replies/);
    initial.resolve(response({error:'Replies temporarily unavailable'},false));let tree=await replies.flush();
    assert.match(text(tree),/Replies temporarily unavailable/);assert.doesNotMatch(text(tree),/Loading replies/);
    button(tree,'Try again').props.onClick();tree=replies.render();assert.match(text(tree),/Loading replies/);assert.doesNotMatch(text(tree),/Replies temporarily unavailable/);
    retry.resolve(response({rows:[{id:'recovered',text:'Recovered reply',status:'approved'}],total:1}));tree=await replies.flush();
    assert.match(text(tree),/Recovered reply/);assert.doesNotMatch(text(tree),/Loading replies/);assert.equal(nodes(tree,node=>node.type==='form').length,1);assert.equal(replyRequests,2);
  }finally{replies?.cleanup();app.cleanup();globalThis.fetch=originalFetch}
});

test('a summary from an older review dataset cannot replace the current summary or clear its loading state',async()=>{
  const originalFetch=globalThis.fetch,old=deferred(),current=deferred();let requests=0;
  globalThis.fetch=async()=>++requests===1?old.promise:current.promise;
  const app=harness(PlaceCommunity,{...base,demo:true,tab:'reviews',ai:true,reviews:[{id:'review-1',placeId:'library',text:'Great study space',rating:4,demo:true}]});
  try{
    button(app.render(),'Summarise with Claude').props.onClick();app.render();
    app.update({refreshKey:'v2'});button(app.render(),'Summarise with Claude').props.onClick();app.render();
    old.resolve(response({summary:'Old and stale summary'}));let tree=await app.flush();
    assert.doesNotMatch(text(tree),/Old and stale summary/);assert.equal(button(tree,'Summarising…').props.disabled,true);
    current.resolve(response({summary:'Current review summary'}));tree=await app.flush();assert.match(text(tree),/Current review summary/);assert.equal(button(tree,'Summarise with Claude').props.disabled,false);
  }finally{app.cleanup();globalThis.fetch=originalFetch}
});

test.after(async()=>{assert.equal(dirname(temp),fileURLToPath(new URL('.',import.meta.url)).replace(/[\\/]$/,''));assert.ok(basename(temp).startsWith('.community-interactions-'));await rm(temp,{recursive:true,force:true})});
