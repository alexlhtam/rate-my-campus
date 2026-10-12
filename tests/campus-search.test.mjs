import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../lib/campus-search.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {localSearchFilters}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

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
