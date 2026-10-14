import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX};
const foodSource=await fs.readFile(new URL('../lib/food.ts',import.meta.url),'utf8');
const foodURL='data:text/javascript;base64,'+Buffer.from(ts.transpileModule(foodSource,{compilerOptions:options}).outputText).toString('base64');
const source=(await fs.readFile(new URL('../components/food-composer.tsx',import.meta.url),'utf8'))
  .replace(/^import CampusMap,.*$/m,'const CampusMap=()=>null;')
  .replace(/^import .* from '@\/lib\/client-photo';$/m,'const preparePhoto=async()=>{throw new Error("Unexpected photo preparation during render")};')
  .replace(/^import .* from '@\/lib\/data';$/m,'const campusCenter={lat:51.5246,lng:-.134},places=[];')
  .replace(/^import .* from '@\/lib\/place-search';$/m,'const hasCoordinates=place=>Number.isFinite(place.lat)&&Number.isFinite(place.lng),matchesPlaceSearch=()=>false;')
  .replace("from '@/lib/food'",`from '${foodURL}'`)
  .replace("import './food.css';",'');
const temporary=new URL('.food-composer-under-test.mjs',import.meta.url);
let FoodComposer,foodDraftFromExtraction;
try {
  await fs.writeFile(temporary,ts.transpileModule(source,{compilerOptions:options}).outputText);
  ({default:FoodComposer,foodDraftFromExtraction}=await import(temporary.href));
}finally{await fs.rm(temporary,{force:true})}
const now=Date.parse('2026-10-12T12:00:00Z');

test('an AI food draft cannot supply a confirmed location or infer food facts from its title',()=>{
  const result=foodDraftFromExtraction({title:'Vegan nut-free sandwiches',lat:51.52,lng:-.13,locationConfirmed:true,foodSafetyAcknowledged:true},now);
  assert.deepEqual(result.draft.dietary,[]);
  assert.equal(result.draft.foodDetails.allergenStatus,'unknown');
  assert.deepEqual(result.draft.foodDetails.allergens,[]);
  assert.equal(result.draft.portionsRemaining,'');
  assert.equal(result.draft.foodDetails.pickupAccess,'ask');
  for(const key of ['lat','lng','locationConfirmed','foodSafetyAcknowledged'])assert.equal(key in result.draft,false);
});

test('handoff preserves explicit details, normalizes dietary labels and drops unsupported claims',()=>{
  const result=foodDraftFromExtraction({title:'Pizza',description:'Left after a talk',location:'Student Centre',portionsRemaining:8,dietary:['Vegetarian','vegan','VEGAN','nut-free'],collectionInstructions:'Ask at the society table',foodDetails:{allergenStatus:'provided',allergens:['milk','tree-nuts','milk','unknown'],ingredients:'Label: milk, wheat',pickupAccess:'ucl',bringContainer:true}},now);
  assert.equal(result.draft.title,'Pizza');
  assert.equal(result.draft.location,'Student Centre');
  assert.equal(result.draft.portionsRemaining,'8');
  assert.deepEqual(result.draft.dietary,['vegetarian','vegan']);
  assert.deepEqual(result.draft.foodDetails.allergens,['milk','tree-nuts']);
  assert.equal(result.draft.foodDetails.pickupAccess,'ucl');
  assert.equal(result.draft.foodDetails.bringContainer,true);
});

test('missing, invalid and zero quantities remain unknown in a new pickup',()=>{
  for(const value of [null,undefined,0,-1,1.5,10001,'8'])assert.equal(foodDraftFromExtraction({portionsRemaining:value},now).draft.portionsRemaining,'');
});

test('extraction keeps an exact collection deadline without extending it on later renders',()=>{
  const end='2026-10-12T12:30:00Z';
  assert.equal(foodDraftFromExtraction({expiresAt:end},now).expiresAt,'2026-10-12T12:30:00.000Z');
  const later=foodDraftFromExtraction({expiresAt:end},now+9*60000);
  assert.equal(later.expiresAt,'2026-10-12T12:30:00.000Z');
  assert.equal(later.duration,21);
});

test('stale and future-event food drafts require a new collection window',()=>{
  const stale=foodDraftFromExtraction({expiresAt:'2026-10-12T11:30:00Z'},now);
  assert.equal(stale.expiresAt,null);
  assert.match(stale.warnings.join(' '),/already passed/);
  const future=foodDraftFromExtraction({startsAt:'2026-10-13T12:00:00Z',expiresAt:'2026-10-13T13:00:00Z'},now);
  assert.equal(future.expiresAt,null);
  assert.match(future.warnings.join(' '),/ready to collect/);
});

const props={demo:true,signedIn:false,services:{ai:true,google:true},onAccount:()=>{},onSubmit:async()=>{},onDone:()=>{}};
test('the demo offers a manual composer without a live extraction action',()=>{
  const html=renderToStaticMarkup(React.createElement(FoodComposer,props));
  assert.match(html,/Private demo/);
  assert.match(html,/Enter the details myself/);
  assert.match(html,/Claude extraction is off in the demo/);
  assert.doesNotMatch(html,/Let Claude draft the details/);
  assert.doesNotMatch(html,/Sign in to continue/);
});

test('a generic draft handoff starts at editable details without losing text or declaring allergens',()=>{
  const html=renderToStaticMarkup(React.createElement(FoodComposer,{...props,initialDraft:{title:'Sandwiches after a talk',description:'A few boxed lunches left.',dietary:['Vegetarian'],lat:0,lng:0,locationConfirmed:true,foodSafetyAcknowledged:true}}));
  assert.match(html,/What can people collect/);
  assert.match(html,/value="Sandwiches after a talk"/);
  assert.match(html,/A few boxed lunches left/);
  assert.match(html,/<input(?=[^>]*value="unknown")(?=[^>]*checked="")[^>]*>/);
  assert.doesNotMatch(html,/Share food alert/);
});
