'use client';
import {useState} from 'react';
import {ArrowRight,Camera,LoaderCircle,MapPin,Siren} from 'lucide-react';
import CampusMap,{type MapProvider} from './campus-map';
import {EmergencyStrip,incidentIcon} from './incident-hub';
import {INCIDENT_CATEGORIES,INCIDENT_DURATIONS,INCIDENT_SEVERITIES,categoryInfo} from '@/lib/incidents/model';
import {places} from '@/lib/data';
import {hasCoordinates,matchesPlaceSearch} from '@/lib/place-search';
import {preparePhoto} from '@/lib/client-photo';
type Row=Record<string,any>;
export type IncidentSubmitResult={ok?:boolean;incident?:Row;message?:string;error?:string;existingId?:string};

export default function IncidentComposer({demo,signedIn,onAccount,onSubmit,onDone,onOpenExisting}:{demo:boolean;signedIn:boolean;onAccount:()=>void;onSubmit:(data:Row)=>Promise<IncidentSubmitResult>;onDone:(incident:Row)=>void;onOpenExisting:(id:string)=>void}) {
  const [step,setStep]=useState(1),[acknowledged,setAcknowledged]=useState(false),[category,setCategory]=useState<string>(''),[severity,setSeverity]=useState<string>('warning');
  const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[location,setLocation]=useState(''),[position,setPosition]=useState({lat:51.5246,lng:-0.134}),[duration,setDuration]=useState(120),[locationConfirmed,setLocationConfirmed]=useState(false);
  const [matches,setMatches]=useState<Row[]>([]),[photo,setPhoto]=useState<{file:File;preview:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[existing,setExisting]=useState('');
  const [,setProvider]=useState<MapProvider>('unavailable');
  const chosen=INCIDENT_CATEGORIES.find(item=>item.id===category);
  function pickCategory(id:string){setCategory(id);setSeverity(categoryInfo(id).defaultSeverity)}
  function findPlace(){const found=places.filter(place=>!place.demo&&hasCoordinates(place)&&matchesPlaceSearch(place,location)).slice(0,6);setMatches(found);if(!found.length)setError('No campus place matched. Type a description and drag the map to the spot instead.');else setError('')}
  async function submit(event:React.FormEvent){
    event.preventDefault();setError('');setExisting('');
    if(!demo&&!signedIn){onAccount();return}
    if(!locationConfirmed){setError('Tick the box to confirm the map pin is in the right place.');return}
    setBusy(true);
    try{
      let photoKey='';
      if(photo&&!demo){const form=new FormData();form.append('file',photo.file);const response=await fetch('/api/community/upload',{method:'POST',body:form});const body=await response.json() as Row;if(!response.ok)throw new Error(body.error||'The photo could not be uploaded.');photoKey=body.key}
      const result=await onSubmit({category,severity,title,description,location,lat:position.lat,lng:position.lng,expiresAt:new Date(Date.now()+duration*60000).toISOString(),photoKey:photoKey||null,locationConfirmed:true,safetyAcknowledged:acknowledged,image:demo&&photo?photo.preview:undefined});
      if(result.existingId){setExisting(result.existingId);setError(result.error||'A live report already exists nearby.');return}
      if(result.error||!result.incident)throw new Error(result.error||'The report could not be saved.');
      onDone(result.incident);
    }catch(failure){setError(failure instanceof Error?failure.message:'The report could not be saved. Please try again.')}
    finally{setBusy(false)}
  }
  return <section className="incident-composer" aria-label="Report an incident">
    <div className="inc-tape" aria-hidden="true"/>
    <div className="inc-heading" style={{marginTop:18}}><span className="inc-symbol"><Siren size={26}/></span><div><div className="eyebrow">REPORT AN INCIDENT · STEP {step} OF 2</div><h2>{step===1?'What are you seeing?':'Where, and how serious?'}</h2><p>{demo?'Private demo: your report stays in this browser.':'A short heads-up for students nearby. Live for a limited time, cleared by the people who are there.'}</p></div></div>
    <div className="inc-steps" aria-hidden="true"><span className="done"/><span className={step===2?'done':''}/></div>
    {step===1?<>
      <EmergencyStrip/>
      <label className="inc-check"><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/><span>I understand this report does not call anyone. If someone is hurt or in danger I have already called 999 or UCL Security, or someone with me has.</span></label>
      <div className="inc-category-grid" role="group" aria-label="Incident type">{INCIDENT_CATEGORIES.map(item=>{const Icon=incidentIcon(item.id);return <button type="button" key={item.id} aria-pressed={category===item.id} onClick={()=>pickCategory(item.id)}><Icon size={18}/><span><b>{item.label}</b><small>{item.hint}</small></span></button>})}</div>
      <p className="fineprint">Describe what is happening, never who. No names, no faces, no descriptions that single out a person. Reports with personal details are rejected.</p>
      <button type="button" className="button alert full" disabled={!acknowledged||!category} onClick={()=>{setStep(2);setError('')}}>Continue <ArrowRight size={15}/></button>
    </>:<form onSubmit={submit}>
      <label>How serious is it?</label>
      <div className="inc-severity" role="group" aria-label="Severity">{INCIDENT_SEVERITIES.map(item=><button type="button" key={item.id} className={item.id} aria-pressed={severity===item.id} onClick={()=>setSeverity(item.id)}><b>{item.label}</b><small>{item.hint}</small></button>)}</div>
      <label>Headline <span className="inc-count">{title.length}/90</span><input required minLength={4} maxLength={90} value={title} onChange={e=>setTitle(e.target.value)} placeholder={chosen?.id==='hazard'?'Chemical smell on the first-floor corridor':chosen?.id==='protest'?'Demonstration blocking the Portico steps':chosen?.id==='fire'?'Fire alarm, building being evacuated':'What should people nearby know?'}/></label>
      <label>What’s happening <small>(optional)</small> <span className="inc-count">{description.length}/1200</span><textarea maxLength={1200} rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="What you can see, which entrances or routes to avoid, whether Security is already there."/></label>
      <label>Where?<div className="input-with-button"><input required minLength={3} maxLength={150} value={location} onChange={e=>{setLocation(e.target.value);setMatches([]);setLocationConfirmed(false)}} placeholder="Building, entrance or street"/><button type="button" onClick={findPlace} disabled={!location.trim()}><MapPin size={15}/>Find</button></div></label>
      {matches.length>0&&<div className="location-matches"><p>Choose the matching campus place, then check the map.</p>{matches.map(place=><button type="button" key={place.id} onClick={()=>{setPosition({lat:place.lat as number,lng:place.lng as number});setLocation(place.name);setMatches([]);setLocationConfirmed(false)}}><b>{place.name}</b><small>{place.address}</small></button>)}</div>}
      <div className="location-confirm"><CampusMap key={`${position.lat.toFixed(5)}-${position.lng.toFixed(5)}-${matches.length}`} initialPosition={position} items={[]} onSelect={()=>{}} confirm onProviderChange={setProvider} onPosition={p=>{setPosition(p);setLocationConfirmed(false)}}/><span>Drag the map so the cross sits on the spot · {position.lat.toFixed(5)}, {position.lng.toFixed(5)}</span></div>
      <label className="inc-check"><input type="checkbox" checked={locationConfirmed} onChange={e=>setLocationConfirmed(e.target.checked)}/><span>The pin is on the right spot. (A building point, not an exact entrance.)</span></label>
      <div className="form-columns"><label>Keep live for<select value={duration} onChange={e=>setDuration(Number(e.target.value))}>{INCIDENT_DURATIONS.map(item=><option key={item.minutes} value={item.minutes}>{item.label}</option>)}</select></label></div>
      <label className="photo-upload" style={{marginTop:14}}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setError('');setBusy(true);try{const prepared=await preparePhoto(file);setPhoto(prepared)}catch(failure){setError((failure as Error).message)}finally{setBusy(false)}}}/>{photo?<img src={photo.preview} alt="Your selected photo"/>:<><Camera size={26}/><b>Add a photo (optional)</b><span>Scene only, no faces. JPG, PNG or WebP · metadata is removed</span></>}</label>
      {photo&&<button type="button" className="text-link" onClick={()=>setPhoto(null)}>Remove photo</button>}
      <p className="fineprint">{demo?'Demo reports are saved only in this browser.':'Live reports are checked automatically before publication and expire on their own. Three students saying it’s over can clear it early; you can mark it over at any time.'}</p>
      {error&&<div className="form-error" role="alert">{error}{existing&&<> <button type="button" className="text-link" style={{display:'inline',margin:0,textDecoration:'underline'}} onClick={()=>onOpenExisting(existing)}>Open the existing alert</button></>}</div>}
      <div className="inc-composer-actions"><button type="button" className="button ghost-alert" onClick={()=>setStep(1)}>Back</button><button className="button alert" disabled={busy||!title.trim()||!location.trim()}>{busy?<LoaderCircle className="spin" size={16}/>:<Siren size={16}/>}{demo?'Add demo alert':'Publish heads-up'}</button></div>
    </form>}
  </section>;
}
