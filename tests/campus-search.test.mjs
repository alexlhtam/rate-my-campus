import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../lib/campus-search.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {localSearchFilters,canonicalSearchTag,matchesSearchTags,readSearchResponse}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('semantic filter aliases match recorded facilities, including sockets rather than plug wording',()=>{
  assert.equal(canonicalSearchTag('power outlets'),'plugs');
  assert.equal(canonicalSearchTag('Wi-Fi'),'wifi');
  assert.equal(canonicalSearchTag('silent study'),'quiet');
  assert.ok(matchesSearchTags(['quiet','plugs','wifi'],['Silent study','Power sockets','Great Wi-Fi'],false));
  assert.ok(matchesSearchTags(['accessible'],['Step-free access'],false));
  assert.ok(!matchesSearchTags(['quiet','plugs'],['Quiet areas'],false),'unknown facilities must not become matches');
  assert.ok(!matchesSearchTags(['quiet'],['Not quiet'],false));
  assert.ok(!matchesSearchTags(['plugs'],['No plug sockets'],false));
  assert.ok(!matchesSearchTags(['accessible'],['Not wheelchair accessible'],false));
  assert.ok(!matchesSearchTags(['late'],['Open late'],false),'opening hours require schedule evidence');
  assert.ok(matchesSearchTags(['late'],[],true));
  assert.ok(!matchesSearchTags(['cosy'],['Cosy'],false));
});

test('ambiguous questions return a clarification without applying empty filters',async()=>{
  const result=await readSearchResponse(Response.json({filters:{query:'',tags:[],clarification:'Do you mean a study space or student accommodation?'}}));
  assert.equal(result.filters,null);
  assert.match(result.message,/study space/);
});

test('search explains the interpreted constraints without claiming it found results',async()=>{
  const filters={query:'',category:'study',layer:'rated',tags:['plugs'],dietary:[],openNow:false,near:'Bloomsbury',radiusKm:.5,clarification:null};
  const result=await readSearchResponse(Response.json({filters}));
  assert.deepEqual(result.filters,filters);
  assert.match(result.message,/study spaces · plugs · near Bloomsbury · within 0.5 km/);
  assert.match(result.message,/missing details can limit results/);
});

test('sign-in, quota and provider failures retain the actual action the user needs',async()=>{
  for(const [status,error] of [[401,'Sign in to use connected services.'],[429,'Too many requests. Try again later.'],[502,'Claude is temporarily unavailable. Please try again later.']]){
    await assert.rejects(readSearchResponse(Response.json({error},{status})),{message:error});
  }
  await assert.rejects(readSearchResponse(new Response('<html>Gateway timeout</html>',{status:504})),/unreadable response/);
  for(const data of [{},{filters:{}},{filters:[]},null])await assert.rejects(readSearchResponse(Response.json(data)),/incomplete filters/);
});

test('offline study search combines quiet, plugs, late and a separate origin',()=>{
  const result=localSearchFilters('quiet study spot with plugs open late near Bloomsbury');
  assert.deepEqual(result.tags,['quiet','plugs','late']);
  assert.equal(result.category,'study');assert.equal(result.layer,'rated');
  assert.equal(result.query,'');assert.equal(result.near,'Bloomsbury');
  assert.equal(result.openNow,false);
});
test('actual names remain usable instead of disappearing into generic filters',()=>{
  assert.equal(localSearchFilters('SSEES study').query,'SSEES');
  assert.equal(localSearchFilters('Senate House Library').query,'Senate House');
  assert.equal(localSearchFilters('Logan Hall').category,null);
  assert.equal(localSearchFilters('Logan Hall').query,'Logan Hall');
  assert.equal(localSearchFilters('Garden Hall').query,'Garden Hall');
  assert.equal(localSearchFilters('Garden Halls').query,'Garden');
});
test('origin words cannot switch the search to the wrong layer or category',()=>{
  const food=localSearchFilters('free food near Ramsay Hall');
  assert.equal(food.layer,'food');assert.equal(food.category,null);
  assert.equal(food.near,'Ramsay Hall');assert.equal(food.query,'');
  const deals=localSearchFilters('deals near Science Library within 500 m');
  assert.equal(deals.layer,'deal');assert.equal(deals.category,null);
  assert.equal(deals.near,'Science Library');assert.equal(deals.radiusKm,.5);
});
test('filters following an origin stay filters rather than part of its name',()=>{
  const result=localSearchFilters('study near Bloomsbury open now with wifi under 1.5 km');
  assert.equal(result.near,'Bloomsbury');assert.equal(result.openNow,true);
  assert.deepEqual(result.tags,['wifi']);assert.equal(result.radiusKm,1.5);
  assert.equal(result.query,'');
});
test('distance and dietary parsing preserve bounds and avoid substring claims',()=>{
  assert.equal(localSearchFilters('study within 250 metres').radiusKm,.25);
  assert.equal(localSearchFilters('study within 100 kilometres').radiusKm,undefined);
  assert.match(localSearchFilters('study within 100 kilometres').query,/100 kilometres/);
  assert.deepEqual(localSearchFilters('gluten free deals').dietary,['gluten-free']);
  assert.deepEqual(localSearchFilters('veganism institute').dietary,[]);
  assert.equal(localSearchFilters('merchandising building').layer,null);
});

test('Union events have their own search layer and freebie requests stay distinct',async()=>{
  const events=localSearchFilters('Union events near Wilkins happening now');
  assert.equal(events.layer,'event');assert.equal(events.category,null);assert.equal(events.query,'');
  assert.equal(events.near,'Wilkins');assert.equal(events.openNow,true);
  const discussion=localSearchFilters('philosophy society socials near Bloomsbury');
  assert.equal(discussion.layer,'event');assert.equal(discussion.query,'philosophy');
  const freeFood=localSearchFilters('events with free food near Science Library');
  assert.equal(freeFood.layer,'freebie');assert.equal(freeFood.query,'');
  assert.equal(freeFood.category,null);assert.equal(freeFood.near,'Science Library');
  assert.equal(localSearchFilters('freebie events').layer,'freebie');
  assert.equal(localSearchFilters('free events').layer,'event','free admission alone is not a freebie');
  assert.equal(localSearchFilters('free events').query,'free','unsupported admission filter must not be silently discarded');
  const result=await readSearchResponse(Response.json({filters:events}));
  assert.match(result.message,/Union events/);
});
