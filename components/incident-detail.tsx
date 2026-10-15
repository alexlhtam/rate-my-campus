'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,CircleCheck,Clock,Flag,MapPin,Navigation,Trash2,Users} from 'lucide-react';
import {EMERGENCY_CONTACTS,INCIDENT_CLEAR_QUORUM,categoryInfo,corroborationLabel,incidentState,incidentTimeAgo,severityInfo} from '@/lib/incidents/model';
import {ShareCampusLink} from './share-campus-link';
import {EmergencyStrip,incidentIcon} from './incident-hub';
type Row=Record<string,any>;

export default function IncidentDetail({incident,demo,clock,vote,onAction,onFlag}:{incident:Row;demo:boolean;clock:number;vote?:string;onAction:(action:string,body:Row)=>Promise<Row|unknown>;onFlag:()=>void}) {
  const Icon=incidentIcon(incident.category),state=incidentState(incident,clock),who=corroborationLabel(Number(incident.confirmCount||0),Number(incident.clearCount||0));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirmDelete,setConfirmDelete]=useState(false);
  const version=useRef(0);
  useEffect(()=>{setError('');setNotice('');setBusy(false);setConfirmDelete(false);return()=>{version.current++}},[incident.id]);
  async function act(action:string,body:Row={}){const current=++version.current;setBusy(true);setError('');try{const result=await onAction(action,{id:incident.id,...body}) as Row;if(current!==version.current)return;setNotice(result?.message||'Thanks.')}catch(failure){if(current===version.current)setError(failure instanceof Error?failure.message:'That could not be saved. Please try again.')}finally{if(current===version.current)setBusy(false)}}
  const confirms=Number(incident.confirmCount||0),clears=Number(incident.clearCount||0),total=confirms+clears;
  const canRespond=state.live&&!incident.own;
  return <div className="incident-detail">
    <div className="inc-tape" aria-hidden="true"/>
    <div className="inc-heading" style={{marginTop:18,marginBottom:6}}><span className="inc-symbol"><Icon size={26}/></span><div><div className="eyebrow">{incident.demo?'SAMPLE INCIDENT · FICTIONAL':incident.own?'YOUR INCIDENT REPORT':'CAMPUS INCIDENT'}</div><div className="inc-detail-badges"><span className={`inc-badge ${incident.severity}`}>{severityInfo(incident.severity).label}</span><span className="inc-badge notice">{categoryInfo(incident.category).label}</span></div></div></div>
    <h2>{incident.title}</h2>
    <div className={`inc-state ${state.live?'':'ended'} ${state.state==='pending'?'pending':''}`}>{state.live?<i className="inc-dot" aria-hidden="true"/>:state.state==='resolved'?<CircleCheck size={16}/>:<Clock size={16}/>}{state.label}</div>
    {incident.severity==='urgent'&&state.live&&<EmergencyStrip compact/>}
    {incident.moderationReason&&incident.own&&<p className="inc-notice">{incident.moderationReason}</p>}
    <p>{incident.description||'No further details were given.'}</p>
    {incident.image&&<img className="post-photo" src={incident.image} alt={incident.demo?'Illustrative sample photo':'Photo attached by the reporter'}/>}
    <dl className="inc-facts">
      <div><dt>Where</dt><dd><MapPin size={14}/>{incident.location}{Number.isFinite(incident.lat)&&Number.isFinite(incident.lng)&&<a href={`https://www.google.com/maps/dir/?api=1&destination=${incident.lat},${incident.lng}`} target="_blank" rel="noreferrer"><Navigation size={12}/>Directions <ArrowUpRight size={11}/></a>}</dd></div>
      <div><dt>When</dt><dd>{incidentTimeAgo(incident.createdAt,clock)} · {new Date(incident.createdAt).toLocaleTimeString('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'})}{state.live?` · expires in ${state.countdown}`:''}</dd></div>
      <div><dt>Who says so</dt><dd><Users size={14}/>{who.label}</dd></div>
    </dl>
    <div className="inc-quorum" aria-label="Student responses">
      <div className="inc-quorum-bar" role="img" aria-label={`${confirms} can see it, ${clears} say it’s over`}><i className="confirm" style={{width:total?`${confirms/total*100}%`:'0%'}}/><i className="clear" style={{width:total?`${clears/total*100}%`:'0%'}}/></div>
      <div className="inc-quorum-legend"><span><b>{confirms}</b> can see this too</span><span><b>{clears}</b> say it’s over{state.live?` · clears at ${INCIDENT_CLEAR_QUORUM} if they outnumber`:''}</span></div>
    </div>
    {canRespond&&<div className="inc-response"><button className="button alert" disabled={busy} aria-pressed={vote==='confirm'} onClick={()=>act('vote',{kind:'confirm'})}><Check size={16}/>{vote==='confirm'?'You can see this too':'I can see this too'}</button><button className="button ghost-alert" disabled={busy} aria-pressed={vote==='clear'} onClick={()=>act('vote',{kind:'clear'})}><CircleCheck size={16}/>{vote==='clear'?'You said it’s over':'It’s over now'}</button></div>}
    {incident.own&&(state.live||state.state==='pending')&&<div className="inc-owner"><button className="button ghost-alert" disabled={busy} onClick={()=>act('resolve')}><CircleCheck size={15}/>Mark as over</button>{confirmDelete?<button className="button alert" disabled={busy} onClick={()=>act('delete')}><Trash2 size={15}/>Yes, delete it</button>:<button className="button ghost-alert" disabled={busy} onClick={()=>setConfirmDelete(true)}><Trash2 size={15}/>Delete report</button>}</div>}
    {incident.own&&state.state==='resolved'&&<div className="inc-owner"><button className="button ghost-alert" disabled={busy} onClick={()=>act('delete')}><Trash2 size={15}/>Delete this report</button></div>}
    {notice&&<p className="inc-notice ok" role="status">{notice}</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <p className="inc-notice">{demo?'Demo responses stay in this browser and simulate one viewer. Nothing is sent anywhere.':'Reports are student accounts in the moment, not official information. Corroborating means you can personally see this; clearing means you are there and it has ended. Stay away from danger and follow instructions from UCL Security or the emergency services.'} Emergency: {EMERGENCY_CONTACTS.emergency.number} · UCL Security {EMERGENCY_CONTACTS.bloomsbury.number}.</p>
    <div className="inc-links"><ShareCampusLink target={{kind:'pin',id:incident.id,mode:demo?'demo':'live'}} label={incident.title}/><button type="button" onClick={onFlag}><Flag size={12}/>Flag this report</button></div>
  </div>;
}
