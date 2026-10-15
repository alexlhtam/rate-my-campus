import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/campus-results.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {orderCampusResults,activateCardWithKey}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

test('nearest ordering interleaves places and finds, leaving unlocated events last',()=>{
  const places=[{id:'library',name:'Library',distance:1},{id:'hall',name:'Hall',distance:5}];
  const pins=[{id:'online',title:'Online event',distance:Infinity},{id:'food',title:'Food',distance:0.2}];
  assert.deepEqual(orderCampusResults(places,pins,'distance',p=>p.distance).map(p=>p.id),['food','library','hall','online']);
  assert.deepEqual(pins.map(p=>p.id),['online','food']);
});
test('default ordering preserves rated places and orders upcoming alerts by time',()=>{
  const places=[{id:'best'},{id:'second'}];
  const pins=[{id:'later',startsAt:'2026-10-17T12:00:00Z'},{id:'soon',startsAt:'2026-10-15T12:00:00Z'},{id:'unknown'}];
  assert.deepEqual(orderCampusResults(places,pins,'recommended',()=>0).map(p=>p.id),['best','second','soon','later','unknown']);
});
test('bookmark keys never trigger a parent card, while focused cards support Enter and Space',()=>{
  const card={},bookmark={};let opens=0,prevented=0;
  for(const key of ['Enter',' '])activateCardWithKey({key,target:bookmark,currentTarget:card,preventDefault:()=>prevented++},()=>opens++);
  assert.equal(opens,0);assert.equal(prevented,0);
  for(const key of ['Enter',' '])activateCardWithKey({key,target:card,currentTarget:card,preventDefault:()=>prevented++},()=>opens++);
  activateCardWithKey({key:'Tab',target:card,currentTarget:card,preventDefault:()=>prevented++},()=>opens++);
  assert.equal(opens,2);assert.equal(prevented,2);
});
