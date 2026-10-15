import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFreebie} from './freebies/load.mjs';
const model=await loadFreebie('lib/incidents/model.ts');
const {incidentInput,incidentVoteKind}=await loadFreebie('lib/incidents/validation.ts');
const {HttpError}=await loadFreebie('lib/community-validation.ts');
const {validIncident,loadIncidentFeed}=await loadFreebie('lib/incidents/feed-client.ts');
const {demoIncidents,parseDemoIncidents,applyDemoIncidentAction,withDemoIncidentVote}=await loadFreebie('lib/incidents/demo.ts');

const now=Date.parse('2026-10-15T12:00:00Z');
const row=(overrides={})=>({id:'inc-1',type:'incident',category:'hazard',severity:'warning',title:'Spill',description:'Wet floor',location:'Quad',lat:51.52,lng:-0.13,status:'approved',createdAt:new Date(now-600000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),resolvedAt:null,resolution:null,confirmCount:0,clearCount:0,own:false,...overrides});

test('incident state follows resolution, moderation and expiry in that order',()=>{
  assert.equal(model.incidentState(row(),now).state,'live');
  assert.equal(model.incidentState(row(),now).label,'Live · 1h 0m left');
  assert.equal(model.incidentState(row({expiresAt:new Date(now+5*60000).toISOString()}),now).endingSoon,true);
  assert.equal(model.incidentState(row({expiresAt:new Date(now-1).toISOString()}),now).state,'expired');
  assert.equal(model.incidentState(row({status:'pending'}),now).label,'Awaiting moderation');
  assert.equal(model.incidentState(row({status:'hidden'}),now).state,'hidden');
  const cleared=model.incidentState(row({status:'hidden',resolvedAt:new Date(now).toISOString(),resolution:'community'}),now);
  assert.equal(cleared.state,'resolved');assert.equal(cleared.label,'Cleared by students');assert.equal(cleared.live,false);
  assert.equal(model.incidentState(row({resolvedAt:new Date(now).toISOString(),resolution:'reporter'}),now).label,'Marked over by the reporter');
});

test('corroboration labels count other students and flag disputes',()=>{
  assert.equal(model.corroborationLabel(0,0).level,'single');
  assert.equal(model.corroborationLabel(1,0).label,'Corroborated by 1 other');
  assert.equal(model.corroborationLabel(2,0).label,'Corroborated by 2 others');
  assert.equal(model.corroborationLabel(3,1).level,'widely');
  assert.equal(model.corroborationLabel(1,2).level,'disputed');
});

test('incidents sort urgent first, then by corroboration, then newest, and filter by text, type and severity',()=>{
  const rows=[row({id:'a',severity:'notice',createdAt:new Date(now-1000).toISOString()}),row({id:'b',severity:'urgent',confirmCount:0}),row({id:'c',severity:'urgent',confirmCount:2}),row({id:'d',severity:'notice',createdAt:new Date(now).toISOString()})];
  assert.deepEqual(model.sortIncidents(rows).map(item=>item.id),['c','b','d','a']);
  assert.equal(model.incidentMatches(row(),{query:'wet quad'}),true);
  assert.equal(model.incidentMatches(row(),{query:'spill hazard'}),true,'category labels are searchable');
  assert.equal(model.incidentMatches(row(),{query:'fire'}),false);
  assert.equal(model.incidentMatches(row(),{category:'fire'}),false);
  assert.equal(model.incidentMatches(row(),{category:'hazard',severity:'warning'}),true);
  assert.equal(model.incidentMatches(row(),{severity:'urgent'}),false);
  assert.equal(model.incidentTimeAgo(row().createdAt,now),'Reported 10 min ago');
  assert.equal(model.categoryInfo('nonsense').id,'other');
});

test('emergency contacts carry the UCL numbers and a source link for the UI to cite',()=>{
  assert.equal(model.EMERGENCY_CONTACTS.emergency.number,'999');
  assert.equal(model.EMERGENCY_CONTACTS.bloomsbury.number,'020 7679 2222');
  assert.equal(model.EMERGENCY_CONTACTS.east.number,'0208 016 0555');
  assert.match(model.EMERGENCY_CONTACTS.sourceUrl,/^https:\/\/www\.ucl\.ac\.uk\//);
});

test('server input validation bounds every field and refuses personal details',()=>{
  const valid={category:'violence',severity:'urgent',title:'Fight outside the Student Centre',description:'Two groups, security called.',location:'Student Centre steps',lat:51.5247,lng:-0.1326,expiresAt:now+3600000,locationConfirmed:true,safetyAcknowledged:true};
  const parsed=incidentInput(valid,now);
  assert.equal(parsed.category,'violence');assert.equal(parsed.expiresAt,now+3600000);assert.equal(parsed.photoKey,null);
  assert.equal(incidentInput({...valid,expiresAt:new Date(now+60000).toISOString()},now).expiresAt,now+60000);
  for(const bad of [{category:'riot'},{severity:'red'},{title:'abc'},{title:'x'.repeat(91)},{description:'y'.repeat(1201)},{location:'ab'},{lat:51.0},{lng:0.5},{expiresAt:now},{expiresAt:now+25*3600000},{expiresAt:'soon'},{locationConfirmed:false},{safetyAcknowledged:'yes'},{description:'Email me at a@b.co'},{title:'Flat 12 is on fire'},{photoKey:'photos/x.gif'}]){
    assert.throws(()=>incidentInput({...valid,...bad},now),HttpError,JSON.stringify(bad));
  }
  assert.equal(incidentInput({...valid,photoKey:'photos/0f0f0f0f-0000-0000-0000-000000000000.webp'},now).photoKey,'photos/0f0f0f0f-0000-0000-0000-000000000000.webp');
  assert.equal(incidentVoteKind('confirm'),'confirm');assert.equal(incidentVoteKind('clear'),'clear');
  assert.throws(()=>incidentVoteKind('still'),HttpError);
});

test('the feed client accepts only well-formed incident records',async()=>{
  assert.equal(validIncident(row()),true);
  for(const broken of [{type:'post'},{category:'meteor'},{severity:'red'},{lat:'51'},{expiresAt:'never'},{status:'gone'},{confirmCount:-1},{own:'yes'},{photoUrl:'https://evil.example/x.jpg'},{resolution:'ghost'},{id:'../x'}])assert.equal(validIncident(row(broken)),false,JSON.stringify(broken));
  const good={incidents:[row()],own:[],resolved:[row({id:'r',resolvedAt:new Date(now).toISOString(),resolution:'community'})],myVotes:[{targetId:'inc-1',kind:'clear'}],total:1,nextOffset:null};
  const fetcher=body=>async()=>({ok:true,json:async()=>body});
  const result=await loadIncidentFeed({fetcher:fetcher(good)});
  assert.equal(result.incidents.length,1);assert.deepEqual(result.myVotes,{'inc-1':'clear'});assert.equal(result.total,1);
  for(const bad of [null,{...good,incidents:[row({lat:999})]},{...good,myVotes:[{targetId:'x',kind:'still'}]},{...good,total:-1},{...good,resolved:'none'}])await assert.rejects(loadIncidentFeed({fetcher:fetcher(bad)}),/could not refresh/);
  await assert.rejects(loadIncidentFeed({fetcher:async()=>({ok:false,json:async()=>({error:'down'})})}),/could not refresh/);
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(loadIncidentFeed({signal:aborted.signal,fetcher:fetcher(good)}),error=>error.name==='AbortError');
});

test('demo incidents are labelled fictional, parse defensively and follow the local lifecycle',()=>{
  const samples=demoIncidents(now);
  assert.ok(samples.length>=3);assert.ok(samples.every(item=>item.demo===true&&/Example/.test(item.title)&&validIncident(item)));
  assert.ok(samples.some(item=>item.resolvedAt),'a cleared example shows the recently cleared list');
  assert.deepEqual(parseDemoIncidents(null),{incidents:[],votes:{}});
  assert.deepEqual(parseDemoIncidents('{"incidents":[{"id":"bad id","category":"hazard"}],"votes":{"x":"still"}}'),{incidents:[],votes:{}});
  let state=parseDemoIncidents(JSON.stringify({incidents:[{id:'mine',category:'protest',severity:'notice',title:'A march','description':'Big','location':'Quad',lat:51.5,lng:-0.1,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),status:'hidden',image:'javascript:alert(1)'}],votes:{'demo-incident-spill':'confirm'}}));
  assert.equal(state.incidents[0].status,'approved','local demo reports are always visible to their author');
  assert.equal(state.incidents[0].image,undefined);assert.deepEqual(state.votes,{'demo-incident-spill':'confirm'});
  state=applyDemoIncidentAction({incidents:[],votes:{}},{action:'create',id:'new',category:'fire',severity:'urgent',title:'Alarm sounding',description:'',location:'Library',lat:51.52,lng:-0.13,expiresAt:new Date(now+3600000).toISOString()},now);
  assert.equal(state.incidents[0].own,true);assert.equal(state.incidents[0].expiresAt,new Date(now+3600000).toISOString());
  assert.throws(()=>applyDemoIncidentAction(state,{action:'create',id:'x',category:'fire',severity:'urgent',title:'Long',location:'Lib',lat:1,lng:1,expiresAt:new Date(now+2*86400000).toISOString()},now),/24 hours/);
  state=applyDemoIncidentAction(state,{action:'resolve',id:'new'},now);
  assert.equal(state.incidents[0].resolution,'reporter');
  state=applyDemoIncidentAction(state,{action:'vote',id:'demo-incident-protest',kind:'clear'},now);
  assert.equal(state.votes['demo-incident-protest'],'clear');
  assert.throws(()=>applyDemoIncidentAction(state,{action:'delete',id:'demo-incident-protest'}),/not one of your demo reports/);
  state=applyDemoIncidentAction(state,{action:'delete',id:'new'},now);
  assert.equal(state.incidents.length,0);
  const sample=samples.find(item=>item.id==='demo-incident-spill');
  assert.equal(withDemoIncidentVote(sample,'confirm').confirmCount,sample.confirmCount+1);
  const nearlyCleared={...sample,confirmCount:0,clearCount:2};
  assert.equal(withDemoIncidentVote(nearlyCleared,'clear').resolution,'community');
  assert.equal(withDemoIncidentVote({...sample,confirmCount:5,clearCount:2},'clear').resolvedAt,null);
});
