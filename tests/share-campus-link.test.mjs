import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX};
const helper=ts.transpileModule(await readFile(new URL('../lib/campus-links.ts',import.meta.url),'utf8'),{compilerOptions:options}).outputText;
const source=(await readFile(new URL('../components/share-campus-link.tsx',import.meta.url),'utf8')).replace("'../lib/campus-links'",`'data:text/javascript;base64,${Buffer.from(helper).toString('base64')}'`).replace("import './share-campus-link.css';",'');
const files=[];
async function component(variant,expanded=false){
  const file=new URL(`.share-campus-link-${variant}-${process.pid}.mjs`,import.meta.url);files.push(file);
  const input=expanded?source.replace("[base,setBase]=useState(''),[show,setShow]=useState(false)","[base,setBase]=useState('https://example.org/?private=removed'),[show,setShow]=useState(true)"):source;
  await writeFile(file,ts.transpileModule(input,{compilerOptions:options}).outputText);
  return (await import(file.href)).ShareCampusLink;
}
let Share,Expanded;
try {Share=await component('default');Expanded=await component('expanded',true)}finally{await Promise.all(files.map(file=>unlink(file)))}

test('shared place and food controls remain server-renderable without opening the removed toolkit',()=>{
  for(const kind of ['place','pin']){
    const html=renderToStaticMarkup(React.createElement(Share,{target:{kind,id:'example',mode:'live'},label:'Example'}));
    assert.match(html,kind==='place'?/Share place/:/Share alert/);
    assert.match(html,/aria-expanded="false"/);
    assert.doesNotMatch(html,/toolkit|collections|timetable/i);
  }
});

test('expanded food sharing retains copy, native share, QR and explicit demo limitations',()=>{
  const html=renderToStaticMarkup(React.createElement(Expanded,{target:{kind:'pin',id:'food-1',mode:'demo'},label:'Food pickup'}));
  for(const action of ['Copy link','Share','Show QR'])assert.ok(html.includes(action));
  assert.match(html,/only exist on this device/);
  assert.match(html,/aria-label="Share address for Food pickup"/);
  assert.match(html,/https:\/\/example.org\/\?pin=food-1&amp;mode=demo/);
  assert.doesNotMatch(html,/private=removed/);
});
