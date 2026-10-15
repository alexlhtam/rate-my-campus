import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/campus-map-focus.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {mapFocusTarget,MAP_FOCUS_ZOOM}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const cafe={id:'assistant-cafe',lat:51.525,lng:-.134,type:'assistant'};
const focus={id:cafe.id,request:1};

test('focus waits for a matching valid map item and never guesses a position',()=>{
  assert.equal(mapFocusTarget([],focus,undefined,'openstreetmap'),undefined);
  assert.equal(mapFocusTarget([cafe],{id:'missing',request:1},undefined,'openstreetmap'),undefined);
  for(const coordinates of [{lat:NaN},{lng:Infinity},{lat:85},{lng:180},{lat:-90}])assert.equal(mapFocusTarget([{...cafe,...coordinates}],focus,undefined,'google'),undefined);
  assert.equal(mapFocusTarget([cafe],focus,undefined,'openstreetmap'),cafe);
  assert.ok(MAP_FOCUS_ZOOM>=18,'Focus reveals unrated places as well as suggestions');
});

test('a consumed request cannot undo a user pan, but a new request can refocus the same item',()=>{
  assert.equal(mapFocusTarget([cafe],focus,{...focus},'openstreetmap'),undefined);
  assert.equal(mapFocusTarget([{...cafe,title:'Refreshed content'}],focus,{...focus},'google'),undefined);
  assert.equal(mapFocusTarget([cafe],{...focus,request:2},focus,'openstreetmap'),cafe);
  assert.equal(mapFocusTarget([cafe],undefined,focus,'openstreetmap'),undefined);
});

test('Google coordinates cannot move either renderer onto an OSM or unavailable map',()=>{
  const googleCafe={...cafe,locationProvider:'google'};
  assert.equal(mapFocusTarget([googleCafe],focus,undefined,'openstreetmap'),undefined);
  assert.equal(mapFocusTarget([googleCafe],focus,undefined,'unavailable'),undefined);
  assert.equal(mapFocusTarget([cafe],focus,undefined,'unavailable'),undefined);
  assert.equal(mapFocusTarget([googleCafe],focus,undefined,'google'),googleCafe,'A waiting request can run once attributed Google tiles are ready');
});
