import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname,basename} from 'node:path';
import ts from 'typescript';

const temp=await mkdtemp(fileURLToPath(new URL('.food-detail-',import.meta.url)));
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
await writeFile(join(temp,'hooks.mjs'),'export const useState=(...args)=>globalThis.__foodHooks.useState(...args); export const useEffect=(...args)=>globalThis.__foodHooks.useEffect(...args); export const useRef=(...args)=>globalThis.__foodHooks.useRef(...args);');
await writeFile(join(temp,'food.mjs'),compile(await readFile(new URL('../lib/food.ts',import.meta.url),'utf8')));
const source=(await readFile(new URL('../components/food-detail.tsx',import.meta.url),'utf8'))
  .replace("from 'react'","from './hooks.mjs'")
  .replace("from '@/lib/food'","from './food.mjs'")
  .replace("import {ShareCampusLink} from './share-campus-link';",'const ShareCampusLink=()=>null;');
await writeFile(join(temp,'component.mjs'),compile(source));
const Component=(await import(pathToFileURL(join(temp,'component.mjs')).href)).default;
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
function nodes(node,predicate,result=[]){if(node&&typeof node==='object'){if(predicate(node))result.push(node);for(const child of Array.isArray(node)?node:[node.props?.children])nodes(child,predicate,result)}return result}
// Run the real component event handlers with isolated hook state. Network actions
// remain pending until each test resolves them, reproducing navigation races.
function harness(initialProps){
  const slots=[];let cursor=0,pending=[],dirty=true,props=initialProps,tree;
  const hooks={
    useState(initial){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,update=>{const next=typeof update==='function'?update(slots[index].value):update;if(!Object.is(next,slots[index].value)){slots[index].value=next;dirty=true}}]},
    useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index]},
    useEffect(effect,deps){const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(previous.deps?.[i],value))){slots[index]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[index].cleanup?.();slots[index].cleanup=effect()})}},
  };
  function render(){let cycles=0;while(dirty){if(++cycles>20)throw new Error('Unexpected render loop');dirty=false;cursor=0;pending=[];globalThis.__foodHooks=hooks;tree=Component(props);for(const effect of pending)effect()}return tree}
  return{render,async flush(){render();for(let i=0;i<3;i++){await new Promise(resolve=>setImmediate(resolve));render()}return tree},update(next){props={...props,...next};dirty=true},cleanup(){for(const slot of slots)slot.cleanup?.();delete globalThis.__foodHooks}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const clock=Date.parse('2026-10-15T12:00:00Z');
const post={id:'food-a',type:'food',title:'Spare sandwiches',description:'Left after a talk',location:'Student Centre',lat:51.5246,lng:-.134,status:'approved',expiresAt:new Date(clock+30*60000).toISOString(),portionsRemaining:8,collectionInstructions:'Ask at the society table.',revision:0};
const base={post,demo:false,clock,onAction:async()=>({ok:true}),onReport(){}};
const button=(tree,label)=>{const found=nodes(tree,node=>node.type==='button'&&text(node)===label)[0];assert.ok(found,`Missing button: ${label}`);return found};

test('live food feedback confirms a live update without claiming it was saved only in a private demo',async()=>{
  const actions=[],app=harness({...base,onAction:async(...args)=>{actions.push(args);return{ok:true}}});
  try{
    button(app.render(),'Still here').props.onClick();
    const tree=await app.flush();
    assert.match(text(tree),/Availability feedback recorded/);assert.doesNotMatch(text(tree),/Updated in your private demo/);
    assert.deepEqual(actions,[['vote',{targetId:'food-a',kind:'still'}]]);
    assert.equal(button(tree,'Still here').props.disabled,false);
  }finally{app.cleanup()}
});

test('a previous pickup response cannot close an editor opened for a different pickup',async()=>{
  const request=deferred(),app=harness({...base,onAction:()=>request.promise});
  try{
    button(app.render(),'Still here').props.onClick();app.render();
    app.update({post:{...post,id:'food-b',own:true}});
    button(app.render(),'Edit pickup details').props.onClick();
    assert.equal(nodes(app.render(),node=>node.type==='form').length,1);
    request.resolve({message:'Old pickup updated'});
    const tree=await app.flush();
    assert.equal(nodes(tree,node=>node.type==='form').length,1);assert.doesNotMatch(text(tree),/Old pickup updated/);
  }finally{app.cleanup()}
});

test('a previous pickup failure cannot overwrite the current pickup or unlock its pending action',async()=>{
  const old=deferred(),current=deferred(),app=harness({...base,onAction:(_action,body)=>body.targetId==='food-a'?old.promise:current.promise});
  try{
    button(app.render(),'Still here').props.onClick();app.render();
    app.update({post:{...post,id:'food-b'}});
    button(app.render(),'Looks gone').props.onClick();app.render();
    old.reject(new Error('Old pickup has closed'));
    let tree=await app.flush();
    assert.doesNotMatch(text(tree),/Old pickup has closed/);assert.equal(button(tree,'Looks gone').props.disabled,true);
    current.resolve({message:'Current pickup feedback saved'});tree=await app.flush();
    assert.match(text(tree),/Current pickup feedback saved/);assert.equal(button(tree,'Looks gone').props.disabled,false);
  }finally{app.cleanup()}
});

test('pending owners can correct pickup details, while expired alerts have no availability actions',()=>{
  const app=harness({...base,post:{...post,own:true,status:'pending'}});
  try{
    let tree=app.render();assert.ok(button(tree,'Edit pickup details'));assert.ok(button(tree,'Close pickup'));
    assert.equal(nodes(tree,node=>node.type==='button'&&text(node)==='Update availability').length,0);
    assert.match(text(tree),/stays private until moderation finishes/);
    app.update({post:{...post,own:false},clock:clock+31*60000});tree=app.render();
    assert.equal(nodes(tree,node=>node.type==='button'&&['Still here','Looks gone'].includes(text(node))).length,0);assert.match(text(tree),/Collection ended/);
  }finally{app.cleanup()}
});

test.after(async()=>{assert.equal(dirname(temp),fileURLToPath(new URL('.',import.meta.url)).replace(/[\\/]$/,''));assert.ok(basename(temp).startsWith('.food-detail-'));await rm(temp,{recursive:true,force:true})});
