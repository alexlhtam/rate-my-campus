import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = await fs.readFile(new URL('../lib/community-view.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { summarizePlace, reviewYear, mergeRows, criteriaFor } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('scores and tags exclude withheld reviews and deduplicate tags within a contribution', () => {
  const rows = [
    {id:'1',placeId:'garden-halls',rating:4,recommend:true,status:'approved',criteria:{value:4},tags:['Good value','good value']},
    {id:'2',placeId:'garden-halls',rating:2,recommend:false,status:'approved',criteria:{value:2},tags:['Good value','Noise']},
    {id:'3',placeId:'garden-halls',rating:5,recommend:true,status:'pending',criteria:{value:5},tags:['Fake']},
    {id:'4',placeId:'garden-halls',rating:1,status:'hidden',tags:['Hidden']},
    {id:'5',placeId:'other',rating:5,status:'approved'},
  ];
  const result=summarizePlace(rows,'garden-halls');
  assert.equal(result.count,2); assert.equal(result.rating,3); assert.equal(result.recommend,50); assert.equal(result.criteria.value,3);
  assert.deepEqual(result.tags,[{tag:'Good value',count:2},{tag:'Noise',count:1}]);
});
test('unreviewed places have no made-up rating or recommendation percentage', () => {
  const result=summarizePlace([], 'new'); assert.equal(result.count,0); assert.equal(result.rating,null); assert.equal(result.recommend,null); assert.deepEqual(result.tags,[]);
});
test('demo seed reviews without status remain usable but pending demos stay withheld', () => {
  const result=summarizePlace([{id:'a',placeId:'x',rating:4,demo:true},{id:'b',placeId:'x',rating:1,demo:true,status:'pending'}], 'x');
  assert.equal(result.count,1); assert.equal(result.rating,4);
});
test('pagination updates existing rows rather than duplicating contributions', () => {
  assert.deepEqual(mergeRows([{id:'1',text:'old'}],[{id:'1',text:'updated'},{id:'2',text:'second'}]),[{id:'1',text:'updated'},{id:'2',text:'second'}]);
  assert.equal(reviewYear({term:'Autumn 2026'}),2026); assert.equal(reviewYear({term:'Summer',year:2025}),2025);
  assert.deepEqual(criteriaFor('building'),['comfort','wifi','accessibility']);
});
