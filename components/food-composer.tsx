'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Camera,Check,ChevronRight,Clock,Leaf,LoaderCircle,MapPin,PackageCheck,Search,ShieldCheck,Sparkles,Utensils,X} from 'lucide-react';
import CampusMap,{type MapPosition,type MapProvider} from './campus-map';
import {preparePhoto} from '@/lib/client-photo';
import {campusCenter,places} from '@/lib/data';
import {hasCoordinates,matchesPlaceSearch} from '@/lib/place-search';
import {FOOD_ALLERGENS,FOOD_DIETARY,readFoodDetails,type FoodDetails} from '@/lib/food';
import './food.css';

type Row=Record<string,any>;
type Props={demo:boolean;signedIn:boolean;services:{ai?:boolean;google?:boolean};initialDraft?:Row;initialPhoto?:{file:File;preview:string};onAccount:()=>void;onSubmit:(data:Row)=>Promise<unknown>;onDone:()=>void};
type Draft={title:string;description:string;location:string;collectionInstructions:string;portionsRemaining:string;dietary:string[];foodDetails:FoodDetails};
type Match=MapPosition&{id:string;name:string;address:string;source:'manual'|'google';attributions?:{provider?:string;providerUri?:string}[]};
const intervals=[15,30,45,60,90,120,180,360];
const steps=['Describe','Food details','Collect'];
const label=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1);
const timeLabel=(value:number)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const plainObject=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const text=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';

/** Only source-declared fields enter the editable draft. AI coordinates are never trusted. */
export function foodDraftFromExtraction(value:unknown,now=Date.now()) {
  const pin=plainObject(value),quantity=pin.portionsRemaining;
  const warnings=Array.isArray(pin.warnings)?pin.warnings.filter((item:unknown):item is string=>typeof item==='string').slice(0,8).map((item:string)=>item.slice(0,300)):[];
  const end=typeof pin.expiresAt==='string'?Date.parse(pin.expiresAt):NaN;
  const start=typeof pin.startsAt==='string'?Date.parse(pin.startsAt):NaN;
  const validExpiry=Number.isFinite(end)&&end>now&&end<=now+360*60000;
  if (Number.isFinite(end)&&!validExpiry) warnings.push(end<=now?'The source time has already passed. Confirm that food is still available and choose a new collection window.':'The source time is more than six hours away. Only post food that is ready to collect now.');
  if (Number.isFinite(start)&&start>now) warnings.push('The source describes a future start. Post only once the food is ready to collect.');
  return {
    draft:{title:text(pin.title,100),description:text(pin.description,1500),location:text(pin.location,150),collectionInstructions:text(pin.collectionInstructions,500),portionsRemaining:typeof quantity==='number'&&Number.isInteger(quantity)&&quantity>=1&&quantity<=10000?String(quantity):'',dietary:Array.isArray(pin.dietary)?[...new Set(pin.dietary.filter((item:unknown):item is string=>typeof item==='string').map((item:string)=>item.toLowerCase()).filter((item:string)=>(FOOD_DIETARY as readonly string[]).includes(item)))]:[],foodDetails:readFoodDetails(pin.foodDetails)} as Draft,
    warnings,confidence:text(pin.confidence,30),expiresAt:validExpiry?new Date(end).toISOString():null,
    duration:validExpiry?Math.max(1,Math.ceil((end-now)/60000)):45,
  };
}

export default function FoodComposer({demo,signedIn,services,initialDraft,initialPhoto,onAccount,onSubmit,onDone}:Props) {
  const [initial]=useState(()=>foodDraftFromExtraction(initialDraft));
  const [step,setStep]=useState(initialDraft?2:1),[sourceText,setSourceText]=useState(initial.draft.description);
  const [draft,setDraft]=useState<Draft>(initial.draft);
  // The handoff photo has already passed preparePhoto in the calling composer.
  const [photo,setPhoto]=useState<File|null>(initialPhoto?.file||null),[preview,setPreview]=useState(initialPhoto?.preview||''),[photoError,setPhotoError]=useState('');
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[warnings,setWarnings]=useState<string[]>(initial.warnings),[confidence,setConfidence]=useState(initial.confidence);
  const [position,setPosition]=useState<MapPosition>(campusCenter),[locationSource,setLocationSource]=useState<'manual'|'google'>('manual'),[mapProvider,setMapProvider]=useState<MapProvider>('unavailable');
  const [matches,setMatches]=useState<Match[]>([]),[showLocations,setShowLocations]=useState(true),[duration,setDuration]=useState(initial.duration),[extractedExpiry,setExtractedExpiry]=useState<string|null>(initial.expiresAt);
  const [locationConfirmed,setLocationConfirmed]=useState(false),[safetyAcknowledged,setSafetyAcknowledged]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null),errorBox=useRef<HTMLDivElement>(null),request=useRef<AbortController|null>(null);
  const uploaded=useRef<{file:File;key:string}|null>(null);
  const initialFocus=useRef(true);
  useEffect(()=>{if(initialFocus.current){initialFocus.current=false;return}heading.current?.focus()},[step]);
  useEffect(()=>{if(error)errorBox.current?.focus()},[error]);
  useEffect(()=>()=>request.current?.abort(),[]);
  const localMatches=draft.location.trim().length>=2?places.filter(place=>!place.demo&&hasCoordinates(place)).filter(place=>matchesPlaceSearch(place,draft.location)).slice(0,6):[];
  const knownMatches:Match[]=localMatches.filter(hasCoordinates).map(place=>({id:place.id,name:place.name,address:place.address,lat:place.lat,lng:place.lng,source:'manual'}));
  const visibleMatches=showLocations?(matches.length?matches:knownMatches):[];
  const estimatedEnd=extractedExpiry?Date.parse(extractedExpiry):Date.now()+duration*60000;
  const patch=(changes:Partial<Draft>)=>{setDraft(previous=>({...previous,...changes}));setSafetyAcknowledged(false)};
  const detail=(changes:Partial<FoodDetails>)=>{setDraft(previous=>({...previous,foodDetails:{...previous.foodDetails,...changes}}));setSafetyAcknowledged(false)};

  async function json<T>(path:string,body:Row):Promise<T> {
    request.current?.abort();const controller=new AbortController();request.current=controller;
    const timeout=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||data.message||'That request did not finish. You can enter the details yourself.');
      return data as T;
    } catch(failure) {
      if((failure as Error).name==='AbortError')throw new Error('The request took too long. Try again, or enter the details yourself.');
      throw failure;
    } finally {clearTimeout(timeout);if(request.current===controller)request.current=null}
  }
  async function selectPhoto(file?:File) {
    if(!file)return;setBusy('photo');setPhotoError('');setError('');
    try {const prepared=await preparePhoto(file);setPhoto(prepared.file);setPreview(prepared.preview);uploaded.current=null;setSafetyAcknowledged(false)}
    catch(failure){setPhotoError((failure as Error).message)}finally{setBusy('')}
  }
  function manualDetails() {
    if(sourceText.trim())setDraft(previous=>({...previous,description:previous.description||sourceText.trim().slice(0,1500),title:previous.title||sourceText.trim().split('\n')[0].slice(0,100)}));
    setError('');setStep(2);
  }
  async function extract() {
    if(demo||!services.ai)return;
    if(!signedIn){onAccount();return}
    setBusy('extract');setError('');
    try {
      const data=await json<{pin:unknown}>('/api/assist',{action:'extract-food',text:sourceText,image:photo?{mediaType:photo.type,data:preview.split(',')[1]}:undefined});
      const extracted=foodDraftFromExtraction(data.pin);
      setDraft(extracted.draft);setWarnings(extracted.warnings);setConfidence(extracted.confidence);setDuration(extracted.duration);setExtractedExpiry(extracted.expiresAt);
      setPosition(campusCenter);setLocationSource('manual');setLocationConfirmed(false);setSafetyAcknowledged(false);setMatches([]);setShowLocations(true);setStep(2);
    } catch(failure){setError((failure as Error).message)}finally{setBusy('')}
  }
  function chooseLocation(match:Match) {
    patch({location:match.name});setPosition({lat:match.lat,lng:match.lng});setLocationSource(match.source);setMatches([]);setShowLocations(false);setLocationConfirmed(false);
  }
  async function findLocation() {
    if(!draft.location.trim())return;
    setShowLocations(true);
    if(knownMatches.length){setMatches(knownMatches);return}
    if(demo||!services.google){setError('No exact campus match was found. Enter the public pickup location, then move the map to its entrance.');return}
    if(!signedIn){onAccount();return}
    setBusy('locate');setError('');setLocationConfirmed(false);
    try {
      const result=await json<{places:Match[]}>('/api/assist',{action:'locate',text:draft.location});
      const located=(result.places||[]).filter(hasCoordinates).map(place=>({...place,source:'google' as const}));
      setMatches(located);
      if(!located.length)setError('No matching location was found. Move the map manually and describe the public pickup point.');
    } catch(failure){setError((failure as Error).message)}finally{setBusy('')}
  }
  function nextDetails(event:React.FormEvent) {
    event.preventDefault();setError('');
    if(draft.foodDetails.allergenStatus==='provided'&&!draft.foodDetails.allergens.length&&!draft.foodDetails.ingredients.trim()) {
      setError('Add the known allergens or ingredient information, or choose “Unknown”.');return;
    }
    setLocationConfirmed(false);setSafetyAcknowledged(false);setStep(3);
  }
  async function submit(event:React.FormEvent) {
    event.preventDefault();setError('');
    if(!demo&&!signedIn){onAccount();return}
    if(!locationConfirmed||!safetyAcknowledged){setError('Confirm the pickup location and sharing details before posting.');return}
    if(locationSource==='google'&&mapProvider!=='google'){setError('Wait for the Google map, or choose a manual campus location before sharing.');return}
    if(!hasCoordinates(position)||draft.location.trim().length<3){setError('Enter and confirm the public pickup location.');return}
    const expiresAt=extractedExpiry?Date.parse(extractedExpiry):Date.now()+duration*60000;
    if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+360*60000){setError('Choose a collection window between now and six hours from now. The extracted time may have passed.');return}
    setBusy('submit');
    try {
      let photoKey:string|undefined;
      if(photo&&!demo) {
        if(uploaded.current?.file===photo)photoKey=uploaded.current.key;
        else {
          const form=new FormData();form.append('file',photo);
          const controller=new AbortController();request.current=controller;
          const timeout=setTimeout(()=>controller.abort(),30000);
          try {
            const response=await fetch('/api/community/upload',{method:'POST',body:form,signal:controller.signal}),result=await response.json();
            if(!response.ok)throw new Error(result.error||'Photo upload failed. Try again, or go back and remove the photo.');
            if(typeof result.key!=='string'||!/^photos\/[a-f0-9-]+\.(jpg|png|webp)$/.test(result.key))throw new Error('The photo could not be attached. Try again, or continue without it.');
            photoKey=result.key;uploaded.current={file:photo,key:result.key};
          } finally {clearTimeout(timeout);if(request.current===controller)request.current=null}
        }
      }
      await onSubmit({type:'food',title:draft.title.trim(),description:draft.description.trim(),location:draft.location.trim(),lat:position.lat,lng:position.lng,dietary:draft.dietary,expiresAt:new Date(expiresAt).toISOString(),collectionInstructions:draft.collectionInstructions.trim(),portionsRemaining:draft.portionsRemaining===''?null:Number(draft.portionsRemaining),foodDetails:{...draft.foodDetails,allergens:draft.foodDetails.allergenStatus==='provided'?draft.foodDetails.allergens:[]},foodSafetyAcknowledged:true,locationConfirmed:true,...(photoKey?{photoKey}:{}),...(demo&&preview?{image:preview}:{})});
      onDone();
    } catch(failure){setError((failure as Error).name==='AbortError'?'Photo upload took too long. Try again, or continue without the photo.':(failure as Error).message)}finally{setBusy('')}
  }

  return <section className="food-composer" aria-labelledby="food-compose-title" aria-busy={Boolean(busy)}>
    <div className="food-eyebrow"><Utensils size={14}/> Good food, shared</div>
    <h2 id="food-compose-title" ref={heading} tabIndex={-1}>{step===1?'Food left over? Pass it on.':step===2?'What can people collect?':'Set the pickup point.'}</h2>
    <p className="food-intro">{step===1?'A quick heads-up can turn spare food into someone’s lunch.':step===2?'Share what you know. Leave anything uncertain as unknown.':'Help people find the right entrance while the food is still available.'}</p>
    <ol className="food-stepper" aria-label="Food sharing progress">{steps.map((name,index)=><li key={name} className={index+1===step?'current':index+1<step?'complete':''} aria-current={index+1===step?'step':undefined}><span>{index+1<step?<Check size={13}/>:index+1}</span>{name}</li>)}</ol>
    {demo&&<p className="food-notice food-demo-note">Private demo: this alert and photo stay in this browser. No food is advertised to other students.</p>}
    {!demo&&!signedIn&&<div className="food-notice"><ShieldCheck size={18}/><div>Sign in with your UCL email before sharing or using Claude.<button type="button" className="food-inline-button" onClick={onAccount}>Sign in to continue <ChevronRight size={13}/></button></div></div>}
    {error&&<div className="food-error" ref={errorBox} tabIndex={-1} role="alert">{error}</div>}
    {step===1&&<div className="food-step-content">
      <label className="food-field">Tell us what’s left<textarea value={sourceText} maxLength={4000} rows={4} onChange={event=>setSourceText(event.target.value)} disabled={Boolean(busy)} placeholder="For example: We have 8 boxed lunches left after our society talk. Collect from the Student Centre foyer in the next 30 minutes. Bring your UCL ID."/></label>
      <div className="food-photo-area">{preview?<div className="food-photo-preview"><img src={preview} alt="Your prepared food photo"/><button type="button" className="food-photo-remove" aria-label="Remove food photo" disabled={Boolean(busy)} onClick={()=>{setPhoto(null);setPreview('');uploaded.current=null;setPhotoError('')}}><X size={17}/></button></div>:<label className="food-photo-picker"><Camera size={25}/><strong>Add a photo <span>optional</span></strong><small>Show the food, packaging or ingredient label</small><input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={event=>{void selectPhoto(event.target.files?.[0]);event.target.value=''}}/><span className="food-photo-link">{busy==='photo'?'Preparing photo…':'Choose a photo'}</span></label>}<p className="food-hint">JPG, PNG or WebP, up to 5 MB. Photos are resized and camera location metadata is removed before use.</p>{photoError&&<p className="food-error" role="alert">{photoError} You can continue without a photo.</p>}</div>
      {!demo&&services.ai&&<button type="button" className="food-button food-primary" onClick={extract} disabled={Boolean(busy)||(!sourceText.trim()&&!photo)}>{busy==='extract'?<LoaderCircle className="spin" size={17}/>:<Sparkles size={17}/>}Let Claude draft the details</button>}
      <button type="button" className={`food-button ${demo||!services.ai?'food-primary':'food-secondary'}`} onClick={manualDetails} disabled={Boolean(busy)}>{sourceText.trim()?'Use this text and fill in details':'Enter the details myself'}<ArrowRight size={16}/></button>
      <p className="food-hint">{demo?'Claude extraction is off in the demo. You can try every manual step.':services.ai?'Claude can organise your message or photo. You will check the details and location before sharing.':'You can share manually while Claude is unavailable.'}</p>
    </div>}
    {step===2&&<form className="food-step-content" onSubmit={nextDetails}>
      {confidence&&<p className="food-notice"><Sparkles size={16}/>Claude draft · {confidence} confidence. Confirm each field below.</p>}
      {warnings.length>0&&<div className="food-notice food-warning"><strong>Check these details</strong><ul>{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}
      {preview&&<div className="food-attached-photo"><img src={preview} alt="Attached food photo"/><span>Photo attached<small>{demo?'Saved only in this browser':'Shared with your food alert'}</small></span><button type="button" className="food-inline-button" onClick={()=>{setError('');setStep(1)}}>Change photo</button></div>}
      <label className="food-field">What’s available?<input required minLength={3} maxLength={100} value={draft.title} onChange={event=>patch({title:event.target.value})} placeholder="Boxed lunches after our society talk"/></label>
      <label className="food-field">A little more detail<textarea required minLength={3} maxLength={1500} rows={3} value={draft.description} onChange={event=>patch({description:event.target.value})} placeholder="Describe the food and what people can expect."/></label>
      <div className="food-grid"><label className="food-field">Estimated portions <span className="food-optional">optional</span><input type="number" min={1} max={10000} step={1} inputMode="numeric" value={draft.portionsRemaining} onChange={event=>patch({portionsRemaining:event.target.value})} placeholder="Leave blank if unknown"/></label><label className="food-field">Society or organiser <span className="food-optional">optional</span><input maxLength={100} value={draft.foodDetails.sourceLabel} onChange={event=>detail({sourceLabel:event.target.value})} placeholder="Your society or event name"/></label></div>
      <label className="food-field">How should people collect it?<textarea required minLength={5} maxLength={500} rows={2} value={draft.collectionInstructions} onChange={event=>patch({collectionInstructions:event.target.value})} placeholder="For example: Use the main entrance and ask at the society table by reception."/></label>
      <div className="food-grid"><label className="food-field">Who can reach the pickup point?<select value={draft.foodDetails.pickupAccess} onChange={event=>detail({pickupAccess:event.target.value as FoodDetails['pickupAccess']})}><option value="ask">Check access with the sharer</option><option value="ucl">UCL ID needed</option><option value="public">Public access</option></select></label><label className="food-check food-container-check"><input type="checkbox" checked={draft.foodDetails.bringContainer} onChange={event=>detail({bringContainer:event.target.checked})}/><span><PackageCheck size={17}/>Bring a container</span></label></div>
      <fieldset className="food-fieldset"><legend>Dietary information you can confirm</legend><p className="food-hint">Only tick claims supported by the packaging or organiser. These are not an allergy guarantee.</p><div className="food-options">{FOOD_DIETARY.map(tag=><label className="food-option" key={tag}><input type="checkbox" checked={draft.dietary.includes(tag)} onChange={event=>patch({dietary:event.target.checked?[...draft.dietary,tag]:draft.dietary.filter(item=>item!==tag)})}/><span><Leaf size={13}/>{label(tag)}</span></label>)}</div></fieldset>
      <fieldset className="food-fieldset"><legend>Allergen information</legend><div className="food-radio-list"><label className="food-check"><input type="radio" name="food-allergen-status" value="unknown" checked={draft.foodDetails.allergenStatus==='unknown'} onChange={()=>detail({allergenStatus:'unknown',allergens:[]})}/><span>Unknown — collectors should ask before taking food</span></label><label className="food-check"><input type="radio" name="food-allergen-status" value="provided" checked={draft.foodDetails.allergenStatus==='provided'} onChange={()=>detail({allergenStatus:'provided'})}/><span>I have ingredient or allergen information</span></label></div>{draft.foodDetails.allergenStatus==='provided'&&<><p className="food-hint">Select allergens you know are present. An unchecked allergen is not a “free from” claim.</p><div className="food-allergen-options">{FOOD_ALLERGENS.map(allergen=><label className="food-check" key={allergen.id}><input type="checkbox" checked={draft.foodDetails.allergens.includes(allergen.id)} onChange={event=>detail({allergens:event.target.checked?[...draft.foodDetails.allergens,allergen.id]:draft.foodDetails.allergens.filter(item=>item!==allergen.id)})}/><span>{allergen.label}</span></label>)}</div></>}</fieldset>
      <label className="food-field">Ingredients or label details <span className="food-optional">optional</span><textarea maxLength={500} rows={2} value={draft.foodDetails.ingredients} onChange={event=>detail({ingredients:event.target.value})} placeholder="Copy information from the packaging or organiser. Don’t guess."/></label>
      <label className="food-field">How has the food been kept? <span className="food-optional">optional</span><textarea maxLength={300} rows={2} value={draft.foodDetails.handling} onChange={event=>detail({handling:event.target.value})} placeholder="For example: Still in sealed boxes. Tell people what you know about storage and preparation."/></label>
      <div className="food-actions"><button type="button" className="food-button food-secondary" onClick={()=>{setError('');setStep(1)}}><ArrowLeft size={16}/>Back</button><button type="submit" className="food-button food-primary">Choose pickup point<ArrowRight size={16}/></button></div>
    </form>}
    {step===3&&<form className="food-step-content" onSubmit={submit}>
      <label className="food-field">Public pickup location<div className="food-search-field"><input required minLength={3} maxLength={150} value={draft.location} disabled={Boolean(busy)} onChange={event=>{patch({location:event.target.value});setMatches([]);setShowLocations(true);setLocationConfirmed(false)}} placeholder="Find a campus building or describe the location"/><button type="button" onClick={findLocation} disabled={Boolean(busy)||draft.location.trim().length<2} aria-label="Find food pickup location">{busy==='locate'?<LoaderCircle className="spin" size={17}/>:<Search size={17}/>}</button></div></label>
      {visibleMatches.length>0&&<div className="food-location-options" aria-label="Suggested pickup locations"><p>{matches.some(match=>match.source==='google')?'Location suggestions from Google Maps':'Choose a known campus location, then check the entrance'}</p>{visibleMatches.map(match=><div key={match.id}><button type="button" disabled={Boolean(busy)} onClick={()=>chooseLocation(match)}><MapPin size={16}/><span><strong>{match.name}</strong><small>{match.address}</small></span><ChevronRight size={15}/></button>{match.attributions?.map((credit,index)=><small className="food-map-credit" key={index}>{credit.provider||''}</small>)}</div>)}</div>}
      <div className="food-map"><CampusMap items={[]} onSelect={()=>{}} confirm initialPosition={position} requireGoogle={locationSource==='google'} onProviderChange={setMapProvider} onPosition={point=>{setPosition(point);setLocationConfirmed(false)}}/><div className="food-map-caption"><MapPin size={14}/>Drag to the pickup entrance. Building points are not entrances.</div></div>
      {locationSource==='google'&&mapProvider!=='google'&&<div className="food-notice food-warning">The selected Google location needs an attributed Google map.<button type="button" className="food-inline-button" onClick={()=>{setPosition(campusCenter);setLocationSource('manual');setLocationConfirmed(false);patch({location:''});setMatches([])}}>Reset and choose a manual campus location</button></div>}
      <fieldset className="food-fieldset"><legend><Clock size={16}/>How long is collection available?</legend><div className="food-expiry-options">{intervals.map(minutes=><button type="button" key={minutes} disabled={Boolean(busy)} className={!extractedExpiry&&duration===minutes?'selected':''} aria-pressed={!extractedExpiry&&duration===minutes} onClick={()=>{setDuration(minutes);setExtractedExpiry(null);setSafetyAcknowledged(false)}}>{minutes<60?`${minutes} min`:`${minutes/60} hr`}</button>)}</div>{extractedExpiry&&<p className="food-notice">From your source: collection ends at <b>{timeLabel(Date.parse(extractedExpiry))}</b> London time. Choose a button above only if you need to correct that time.</p>}<p className="food-hint">The alert disappears when collection ends. A countdown is not a food-safety assessment.</p></fieldset>
      <div className="food-review"><div className="food-review-heading"><span><Check size={16}/>Check your alert</span><button type="button" disabled={Boolean(busy)} onClick={()=>{setError('');setStep(2)}}>Edit details</button></div><h3>{draft.title}</h3><p>{draft.description}</p><dl><div><dt>Where</dt><dd>{draft.location||'Choose a pickup location above'}</dd></div><div><dt>Quantity</dt><dd>{draft.portionsRemaining?`About ${draft.portionsRemaining} portions`:'Not specified'}</dd></div><div><dt>Collect by</dt><dd>{timeLabel(estimatedEnd)} London time{!extractedExpiry?` · ${duration} minutes after posting`:''}</dd></div><div><dt>Instructions</dt><dd>{draft.collectionInstructions}</dd></div><div><dt>Access</dt><dd>{draft.foodDetails.pickupAccess==='ucl'?'UCL ID needed':draft.foodDetails.pickupAccess==='public'?'Public access':'Check with the sharer'}{draft.foodDetails.bringContainer?' · Bring a container':''}</dd></div><div><dt>Allergens</dt><dd>{draft.foodDetails.allergenStatus==='unknown'?'Unknown — ask the sharer':draft.foodDetails.allergens.length?draft.foodDetails.allergens.map(id=>FOOD_ALLERGENS.find(item=>item.id===id)?.label).join(', '):'See the ingredient information. No “free from” claim.'}</dd></div></dl>{draft.dietary.length>0&&<div className="food-tags">{draft.dietary.map(tag=><span className="food-tag" key={tag}>{label(tag)}</span>)}</div>}</div>
      <label className="food-check food-confirm"><input required type="checkbox" disabled={Boolean(busy)||(locationSource==='google'&&mapProvider!=='google')} checked={locationConfirmed} onChange={event=>setLocationConfirmed(event.target.checked)}/><span>I checked the map pin, public pickup location and collection instructions.</span></label>
      <label className="food-check food-confirm"><input required type="checkbox" disabled={Boolean(busy)} checked={safetyAcknowledged} onChange={event=>setSafetyAcknowledged(event.target.checked)}/><span>The food is ready to collect now, I have permission to share it, and I will pass on what I know about its ingredients and handling.</span></label>
      <p className="food-hint">Food is shared at each person’s judgement. Availability, dietary claims and safety are not guaranteed by Rate My Campus.</p>
      <div className="food-actions"><button type="button" className="food-button food-secondary" disabled={Boolean(busy)} onClick={()=>{setError('');setStep(2)}}><ArrowLeft size={16}/>Back</button><button type="submit" className="food-button food-primary" disabled={Boolean(busy)||(locationSource==='google'&&mapProvider!=='google')}>{busy==='submit'?<LoaderCircle className="spin" size={17}/>:<Utensils size={17}/>} {demo?'Add private demo alert':signedIn?'Share food alert':'Sign in to share'}</button></div>
    </form>}
  </section>;
}
