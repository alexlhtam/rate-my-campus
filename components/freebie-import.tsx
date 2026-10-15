'use client';
import {useCallback,useEffect,useState,useRef} from 'react';
import {Download,ExternalLink,Gift,LoaderCircle,RefreshCw} from 'lucide-react';
import type {Dashboard,EventRecord} from '@/lib/freebies/types';
import {canConfirmEventVenue,csvCell,eventTime} from '@/lib/freebies/view';
import {places} from '@/lib/data';
import {hasCoordinates} from '@/lib/place-search';
import CampusMap from './campus-map';
import './freebie-events.css';

type ImportState=Dashboard&{enabled:boolean;workerConnected:boolean;dailyEnabled?:boolean;history?:{id:string;start_date:string;status:string}[]};
function download(filename:string,body:string,type:string){const url=URL.createObjectURL(new Blob([body],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export default function FreebieImport({onChanged,onModeration}:{onChanged:()=>void;onModeration:()=>void}){
 const [data,setData]=useState<ImportState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[runId,setRunId]=useState(''),[filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[limit,setLimit]=useState(50),[locating,setLocating]=useState<EventRecord|null>(null),[placeId,setPlaceId]=useState('');
 const requestId=useRef(0);
 const cancelRequests=useCallback(()=>{requestId.current++},[]);
 const load=useCallback(async()=>{
  const id=++requestId.current;
  try{const response=await fetch('/api/freebies/dashboard'+(runId?'?runId='+encodeURIComponent(runId):''),{cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error||'The import status could not load.');if(id===requestId.current){setData(body);setError('');}}
  catch(failure){if(id===requestId.current)setError((failure as Error).message);}
 },[runId]);
 useEffect(()=>{const first=setTimeout(()=>void load(),0);const timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},10000);return()=>{clearTimeout(first);clearInterval(timer);cancelRequests()}},[load,cancelRequests]);
 async function post(path:string,body:object){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||'The change could not be saved.');return result;
 }
 async function importEvents(){
  setBusy('import');setError('');
  try{const result=await post('/api/freebies/scan',{action:'start'});cancelRequests();setRunId('');setData(current=>({...current,...result}));onChanged();}
  catch(failure){setError((failure as Error).message);}finally{setBusy('');}
 }
 async function decide(event:EventRecord,decision:'approve'|'hide'){
  if(!event.publishedPostId)return;
  setBusy(event.id);setError('');
  try{await post('/api/community/moderation',{targetId:event.publishedPostId,decision,reason:decision==='hide'?'Hidden after checking the Union listing.':''});await load();onChanged();}
  catch(failure){setError((failure as Error).message);}finally{setBusy('');}
 }
 const events=data?.events||[],run=data?.run;
 const published=events.filter(event=>event.publicationState==='published').length;
 const held=events.filter(event=>['needs_review','held_by_moderator'].includes(event.publicationState||'')).length;
 const failed=events.filter(event=>event.status==='failed').length;
 const skipped=events.filter(event=>event.status==='out_of_window'||['expired','already_imported'].includes(event.publicationState||'')).length;
 const visible=events.filter(event=>(filter==='all'||filter===event.status||filter===event.publicationState)&&[event.title,event.sourceLocation,event.sourceOrganizer,event.extraction?.society?.name,event.extraction?.summary].join(' ').toLowerCase().includes(query.toLowerCase()));
 const venue=places.find(place=>place.id===placeId&&hasCoordinates(place));
 return <section className="freebie-audit" aria-label="Union event imports">
  <div><div className="eyebrow"><Gift size={14}/> UNION EVENTS</div><h2>What’s on around campus.</h2><p>Import the next two weeks of public Students’ Union UCL events. Events with explicit free food or items get a separate freebie badge; free entry alone is a regular event.</p></div>
  {error&&<div role="alert" className="freebie-audit-error">{error}</div>}
  {!data?<button className="button light" onClick={()=>{setError('');void load()}}>Check import service</button>:<>
   <div className="freebie-audit-controls"><button className="button coral" disabled={!!busy||!data.enabled||!data.configured.claude||!data.workerConnected} onClick={importEvents}>{busy==='import'?<LoaderCircle className="spin" size={15}/>:<Gift size={15}/>}Import next 14 days</button><button className="button light" onClick={()=>{setError('');void load();onChanged()}}><RefreshCw size={14}/>Refresh</button><button className="button light" onClick={onModeration}>Moderation & reports</button></div>
   {!data.enabled&&<p className="setup-note">Union imports are disabled. The operator needs to confirm source permission and enable them.</p>}
   {(!data.configured.claude||!data.workerConnected)&&<p className="setup-note">The server needs Claude and the background worker connection. Setup instructions are in docs/freebies.md.</p>}
   <p className="fineprint">You can close this panel while an import runs. Up to 30 events share one Claude request for extraction and approval. Unchanged listings reuse their saved AI checks. Progress and retries are saved automatically. Daily imports: {data.dailyEnabled?'enabled; the registered schedule triggers them':'off'}.</p>
   {!!data.history?.length&&<label>Import history<select value={runId} onChange={event=>{setRunId(event.target.value);setLimit(50)}}><option value="">Latest import</option>{data.history.map(item=><option key={item.id} value={item.id}>{item.start_date} · {item.status} · {item.id.slice(0,8)}</option>)}</select></label>}
   {run?<div className="freebie-audit-summary" role="status"><b>{['running','discovering'].includes(run.status)?'Import in progress':run.status==='complete'?'Import complete':run.status==='paused'?'Import paused — use Import next 14 days to retry':'Import finished with items to check'}</b><div className="freebie-scan-stats"><span><b>{published}</b> published</span><span><b>{held}</b> held</span><span><b>{skipped}</b> skipped</span><span><b>{failed}</b> failed</span><span><b>{run.queued}</b> remaining</span></div><p className="fineprint">{run.discovered} events found · {run.sourcePages} calendar pages checked. {run.fetched??0} pages read · {run.extracted??0} AI checks saved · {run.located??0} published with map locations. {run.coverageComplete?'Coverage complete.':'Coverage is not complete yet.'}</p>{run.error&&<p className="freebie-audit-error">{run.error}</p>}{run.warnings.map((warning,index)=><p key={index} className="fineprint">{warning}</p>)}</div>:<p className="setup-note">No imports yet. Published findings will appear in the live campus view.</p>}
   {events.length>0&&<><div className="freebie-audit-controls"><button className="button light small" onClick={()=>download('campus-events.json',JSON.stringify({run,events},null,2),'application/json')}><Download size={13}/>JSON</button><button className="button light small" onClick={()=>download('campus-events.csv',[['Title','Start','End','Society','Items','Admission','Status','Source'],...events.map(event=>[event.title,event.start,event.end,event.extraction?.society?.name,event.extraction?.freebies.map(item=>item.item).join('; '),event.extraction?.priceDetails,event.publicationState||event.status,event.url])].map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8')}><Download size={13}/>CSV</button></div>
    <label>Find an event<input value={query} onChange={event=>{setQuery(event.target.value);setLimit(50)}} placeholder="Event, society or venue"/></label><label>Show<select value={filter} onChange={event=>{setFilter(event.target.value);setLimit(50)}}><option value="all">All events</option><option value="published">Published</option><option value="needs_review">Held for review</option><option value="held_by_moderator">Hidden by a moderator</option><option value="no_freebies">Regular events (no freebies)</option><option value="failed">Failed</option><option value="queued">Remaining</option></select></label>
    {visible.slice(0,limit).map(event=><article className="freebie-audit-row" key={event.id}><h3>{event.title}</h3><p>{eventTime(event.start)} · {event.publicationState||event.status.replaceAll('_',' ')}</p>{event.extraction&&<><p>{event.extraction.summary}</p><p>{event.extraction.priceDetails||'Entry price not stated'}{event.extraction.eligibility?' · '+event.extraction.eligibility:''}</p><details><summary>Evidence & conditions</summary>{event.extraction.freebies.map((item,index)=><p key={index}>{item.item} ({item.certainty}): “{item.evidence}”</p>)}{event.extraction.conditions.map((condition,index)=><p key={index}>{condition}</p>)}</details></>}{event.error&&<p className="freebie-audit-error">{event.failedStage}: {event.error}</p>}<a className="source-link" href={event.url} target="_blank" rel="noreferrer">Original Union listing <ExternalLink size={12}/></a>{event.publishedPostId&&<div className="freebie-audit-controls">{event.publicationState==='needs_review'&&<button className="button coral small" disabled={!!busy} onClick={()=>void decide(event,'approve')}>Approve</button>}{event.publicationState!=='held_by_moderator'&&<button className="button light small" disabled={!!busy} onClick={()=>void decide(event,'hide')}>{event.publicationState==='needs_review'?'Reject':'Hide pin'}</button>}{canConfirmEventVenue(event)&&<button className="button light small" onClick={()=>{setLocating(event);setPlaceId('')}}>Confirm venue</button>}</div>}</article>)}
    {visible.length>limit&&<button className="button light" onClick={()=>setLimit(value=>value+50)}>Show 50 more ({visible.length-limit} remaining)</button>}
   </>}
   {locating&&<section className="freebie-audit-row" aria-label="Confirm event venue"><h3>Venue for {locating.title}</h3><p>{locating.extraction?.venue||locating.sourceLocation||'Location TBC'}</p><label>Verified campus building<select value={placeId} onChange={event=>setPlaceId(event.target.value)}><option value="">Choose a building</option>{places.filter(place=>!place.demo&&hasCoordinates(place)).map(place=><option value={place.id} key={place.id}>{place.name}</option>)}</select></label>{venue&&<div style={{height:230,position:'relative'}}><CampusMap key={venue.id} initialPosition={{lat:venue.lat!,lng:venue.lng!}} items={[{id:venue.id,name:venue.name,lat:venue.lat!,lng:venue.lng!}]} selected={venue.id} onSelect={()=>{}}/></div>}<p className="fineprint">This confirms the building point. Follow the listing’s room and entrance instructions.</p><div className="freebie-audit-controls"><button className="button coral" disabled={!venue||!!busy} onClick={async()=>{setBusy('venue');setError('');try{await post('/api/freebies/location',{postId:locating.publishedPostId,placeId,confirmed:true});setLocating(null);onChanged();await load()}catch(failure){setError((failure as Error).message)}finally{setBusy('')}}}>Confirm building</button><button className="button light" onClick={()=>setLocating(null)}>Cancel</button></div></section>}
  </>}
 </section>;
}
