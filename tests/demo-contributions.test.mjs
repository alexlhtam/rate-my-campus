import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../lib/demo-contributions.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}});
const {updateDemoContribution}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('demo edits cannot modify a seed or absent contribution',()=>{
  assert.throws(()=>updateDemoContribution({reviews:[]},{action:'delete-own',kind:'review',targetId:'demo-review-1'}),/not one of your/);
});
test('deleting a local discussion removes its replies and local votes without mutating input',()=>{
  const state={threads:[{id:'t'}],replies:[{id:'r',threadId:'t'},{id:'s',threadId:'other'}],votes:{r:'helpful',s:'helpful'},reports:[{targetId:'r'}]};
  const result=updateDemoContribution(state,{action:'delete-own',kind:'thread',targetId:'t'});
  assert.deepEqual(result.threads,[]);assert.deepEqual(result.replies,[{id:'s',threadId:'other'}]);assert.deepEqual(result.votes,{s:'helpful'});assert.deepEqual(result.reports,[]);assert.equal(state.threads.length,1);
});
test('food updates close zero portions and never reopen expired alerts',()=>{
  const state={posts:[{id:'p',type:'food',expiresAt:new Date(5000).toISOString()}]};
  const result=updateDemoContribution(state,{action:'update-post',targetId:'p',collectionInstructions:'Collect at the public foyer',portionsRemaining:0},1000);
  assert.equal(Date.parse(result.posts[0].expiresAt),1000);
  assert.throws(()=>updateDemoContribution(result,{action:'update-post',targetId:'p',portionsRemaining:5},2000),/expired/);
  assert.throws(()=>updateDemoContribution(state,{action:'update-post',targetId:'p',portionsRemaining:-1},1000),/whole-number/);
});
