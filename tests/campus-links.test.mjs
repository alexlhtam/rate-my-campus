import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/campus-links.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {campusShareUrl,parseCampusLink,parseCampusMode}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

test('unselected map links retain their live or demo mode on refresh and back navigation',()=>{
  assert.equal(parseCampusMode('http://localhost:3000/?mode=live'),'live');
  assert.equal(parseCampusMode('https://example.org/?mode=demo'),'demo');
  assert.equal(parseCampusMode('https://example.org/?place=garden-halls&mode=live'),'live');
  for(const input of ['https://example.org/','https://example.org/?mode=demo&mode=live','https://example.org/?mode=anything','javascript:alert(1)?mode=live','not a URL'])assert.equal(parseCampusMode(input),null);
});

test('place and alert sharing preserves explicit demo/live mode without leaking unrelated URL state',()=>{
  const url=campusShareUrl('https://user:secret@example.org/campus?email=private%40ucl.ac.uk&pin=old#private',{kind:'place',id:'garden-halls',mode:'live'});
  assert.equal(url,'https://example.org/campus?place=garden-halls&mode=live');
  assert.deepEqual(parseCampusLink(url),{kind:'place',id:'garden-halls',mode:'live'});
  assert.deepEqual(parseCampusLink(campusShareUrl('http://192.168.1.2:3000',{kind:'pin',id:'demo-food-1',mode:'demo'})),{kind:'pin',id:'demo-food-1',mode:'demo'});
});

test('invalid, ambiguous and retired collection links never select a public place or alert',()=>{
  for(const bad of ['?place=x','?place=x&mode=other','?place=x&pin=y&mode=demo','?place=x&mode=demo&mode=live','?pin=x&pin=y&mode=live','?place=../../secret&mode=live','?collection=legacy&mode=live','?place=x&mode=live&collection=legacy'])assert.equal(parseCampusLink(`https://example.org/${bad}`),null,bad);
  assert.equal(parseCampusLink('javascript:alert(1)?place=x&mode=demo'),null);
  assert.throws(()=>campusShareUrl('javascript:alert(1)',{kind:'pin',id:'x',mode:'demo'}));
  for(const target of [{kind:'collection',id:'x',mode:'live'},{kind:'place',id:'../../private',mode:'live'},{kind:'place',id:'x',mode:'missing'}])assert.throws(()=>campusShareUrl('https://example.org/',target));
});
