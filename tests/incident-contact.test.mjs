import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileFreebie,loadFreebie} from './freebies/load.mjs';

const {EmergencyStrip,default:IncidentHub}=await loadFreebie('components/incident-hub.tsx');
const {default:IncidentDetail}=await loadFreebie('components/incident-detail.tsx');
const {EMERGENCY_CONTACTS}=await loadFreebie('lib/incidents/model.ts');
const {metadata}=await loadFreebie('app/layout.tsx');
// Render both real composer steps without loading the map/data bundle. Its
// external map and photo effects are outside this contact-control regression.
async function composerStep(step){
  const file=new URL(`.incident-contact-composer-${step}-${process.pid}.mjs`,import.meta.url);
  const source=(await readFile(new URL('../components/incident-composer.tsx',import.meta.url),'utf8'))
    .replace(/^import CampusMap,.*$/m,'const CampusMap=()=>null;')
    .replace(/^import .* from '@\/lib\/client-photo';$/m,'const preparePhoto=()=>{throw new Error("Unexpected photo preparation during render")};')
    .replace(/^import .* from '@\/lib\/data';$/m,'const places=[];')
    .replace(/^import .* from '@\/lib\/place-search';$/m,'const hasCoordinates=()=>false,matchesPlaceSearch=()=>false;')
    .replace("from './incident-hub'",`from '${compileFreebie(new URL('../components/incident-hub.tsx',import.meta.url))}'`)
    .replace("from '@/lib/incidents/model'",`from '${compileFreebie(new URL('../lib/incidents/model.ts',import.meta.url))}'`)
    .replace('[step,setStep]=useState(1)',`[step,setStep]=useState(${step})`);
  try{
    await writeFile(file,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);
    return (await import(file.href)).default;
  }finally{await unlink(file).catch(()=>{});}
}
const IncidentComposer=await composerStep(1),IncidentComposerDetails=await composerStep(2);
const now=Date.parse('2026-10-16T12:00:00Z');
const incident={id:'example',category:'hazard',severity:'urgent',title:'Example incident',description:'Fictional test report.',location:'Campus',lat:51.5246,lng:-.134,status:'approved',createdAt:new Date(now-60000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),confirmCount:0,clearCount:0};
const noAction=()=>{throw new Error('Rendering reference information must not initiate an action.');};
const markup=(component,props)=>renderToStaticMarkup(createElement(component,props));
const plainText=html=>html.replace(/<[^>]*>/g,'');
function assertNoContactAction(html){
  assert.doesNotMatch(html,/(?:href|action|formaction)="(?:tel|sms|smsto|mailto|callto|facetime|facetime-audio):/i);
  for(const button of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)){
    assert.doesNotMatch(plainText(button[1]),/\b(?:call|dial|contact|message|notify)\b.*\b(?:999|emergency|security)\b/i);
  }
}

for(const compact of [false,true])test(`emergency strip (${compact?'compact':'full'}) displays reference numbers without contact actions`,()=>{
  const html=markup(EmergencyStrip,{compact});
  assertNoContactAction(html);
  assert.doesNotMatch(html,/<button\b/i);
  assert.match(html,/999/);
  assert.match(html,/020 7679 2222/);
  assert.match(html,/never calls, messages or contacts emergency services or UCL Security/);
  assert.match(html,/These numbers are for reference only/);
  const links=[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(links,compact?[]:[EMERGENCY_CONTACTS.sourceUrl]);
  if(!compact)assert.match(html,/0208 016 0555/);
});

for(const demo of [false,true])test(`incident hub and composer have no emergency contact actions in ${demo?'demo':'live'} mode`,()=>{
  const hub=markup(IncidentHub,{incidents:[incident],own:[],resolved:[],demo,clock:now,distance:()=>0,originLabel:'Campus',loading:false,error:'',updatedAt:now,onRefresh:noAction,onOpen:noAction,onReport:noAction,onMap:noAction});
  const composer=markup(IncidentComposer,{demo,signedIn:true,onAccount:noAction,onSubmit:noAction,onDone:noAction,onOpenExisting:noAction});
  assertNoContactAction(markup(IncidentComposerDetails,{demo,signedIn:true,onAccount:noAction,onSubmit:noAction,onDone:noAction,onOpenExisting:noAction}));
  for(const html of [hub,composer]){
    assertNoContactAction(html);
    assert.match(html,/never calls, messages or contacts emergency services or UCL Security/);
    assert.match(html,/999/);
  }
});

for(const severity of ['notice','warning','urgent'])test(`${severity} incident details never provide emergency contact actions`,()=>{
  for(const demo of [false,true]){
    const html=markup(IncidentDetail,{incident:{...incident,severity},demo,clock:now,onAction:noAction,onFlag:noAction});
    assertNoContactAction(html);
    assert.match(plainText(html),/Emergency: 999/);
    if(severity==='urgent')assert.match(html,/never calls, messages or contacts emergency services or UCL Security/);
  }
});

test('emergency reference data contains no callable addresses',()=>{
  for(const key of ['emergency','bloomsbury','east']){
    assert.equal(Object.hasOwn(EMERGENCY_CONTACTS[key],'dial'),false);
    assert.equal(Object.hasOwn(EMERGENCY_CONTACTS[key],'href'),false);
  }
});

test('page metadata disables automatic telephone and email links on supported mobile browsers',()=>{
  assert.deepEqual(metadata.formatDetection,{telephone:false,email:false,address:false});
});
