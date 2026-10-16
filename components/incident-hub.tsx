'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Construction,Droplets,ExternalLink,Flame,HeartPulse,MapPin,Megaphone,Phone,Plus,RefreshCw,ShieldAlert,Siren,Swords,TriangleAlert,Users,type LucideIcon} from 'lucide-react';
import {loadIncidentFeed,type IncidentFeed} from '@/lib/incidents/feed-client';
import {EMERGENCY_CONTACTS,INCIDENT_CATEGORIES,INCIDENT_SEVERITIES,categoryInfo,corroborationLabel,incidentMatches,incidentState,incidentTimeAgo,severityInfo,sortIncidents} from '@/lib/incidents/model';
type Row=Record<string,any>;
const icons:Record<string,LucideIcon>={violence:Swords,hazard:Droplets,fire:Flame,medical:HeartPulse,security:ShieldAlert,protest:Megaphone,disruption:Construction,other:TriangleAlert};
export const incidentIcon=(category:unknown):LucideIcon=>icons[String(category)]||TriangleAlert;
const empty:IncidentFeed={incidents:[],own:[],resolved:[],myVotes:{},total:0};

/** Live feed polling: every 15 seconds while visible, never in demo mode. A failed refresh keeps the last good list. */
export function useIncidentFeed(demo:boolean,signedIn=false) {
  const [feed,setFeed]=useState<IncidentFeed>(empty),[loading,setLoading]=useState(false),[error,setError]=useState(''),[updatedAt,setUpdatedAt]=useState<number|null>(null);
  const generation=useRef(0),mounted=useRef(true),mode=useRef(demo),inFlight=useRef(false),controller=useRef<AbortController|null>(null);mode.current=demo;
  const refresh=useCallback(async()=>{
    if(demo||mode.current)return;
    const revision=++generation.current;
    controller.current?.abort();const request=new AbortController();controller.current=request;inFlight.current=true;setLoading(true);
    const timeout=setTimeout(()=>request.abort(),30000);
    try{
      const result=await loadIncidentFeed({signal:request.signal});
      if(!mounted.current||revision!==generation.current||mode.current)return;
      setFeed(result);setError('');setUpdatedAt(Date.now());
    }catch(failure){if(mounted.current&&revision===generation.current&&!mode.current)setError((failure as Error).name==='AbortError'?'Incident alerts took too long to refresh. Please try again.':(failure as Error).message)}
    finally{clearTimeout(timeout);if(revision===generation.current){inFlight.current=false;if(mounted.current)setLoading(false)}}
  },[demo]);
  useEffect(()=>{mounted.current=true;generation.current++;setFeed(empty);setError('');setUpdatedAt(null);setLoading(false);if(!demo)void refresh();const check=()=>{if(!demo&&!inFlight.current&&document.visibilityState==='visible')void refresh()};const timer=setInterval(check,15000);document.addEventListener('visibilitychange',check);return()=>{mounted.current=false;generation.current++;inFlight.current=false;controller.current?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',check)}},[demo,signedIn,refresh]);
  return {...feed,loading,error,updatedAt,refresh};
}

export function EmergencyStrip({compact=false}:{compact?:boolean}) {
  const c=EMERGENCY_CONTACTS;
  return <div className={`inc-emergency ${compact?'compact':''}`} role="note" aria-label="Emergency contacts">
    <b><Phone size={14}/>Someone in danger? Contact help yourself.</b>
    <p>Rate Our Campus never calls, messages or contacts emergency services or UCL Security. These numbers are for reference only.</p>
    <div className="inc-numbers"><span className="inc-number">{c.emergency.number} emergency services</span><span className="inc-number secondary">UCL Security {c.bloomsbury.number}</span>{!compact&&<span className="inc-number secondary">UCL East {c.east.number}</span>}</div>
    {!compact&&<small>On a Bloomsbury campus phone dial {c.bloomsbury.extension}. UCL asks you to call Security first on campus so they can direct the emergency services. Numbers checked against <a href={c.sourceUrl} target="_blank" rel="noreferrer">UCL’s emergency contacts page</a> on 15 October 2026.</small>}
  </div>;
}

export function IncidentCard({incident,now,distanceLabel,onOpen}:{incident:Row;now:number;distanceLabel?:string;onOpen:()=>void}) {
  const Icon=incidentIcon(incident.category),state=incidentState(incident,now),who=corroborationLabel(Number(incident.confirmCount||0),Number(incident.clearCount||0));
  const ended=!state.live;
  return <button type="button" className={`inc-card ${incident.severity} ${ended?'ended':''}`} onClick={onOpen} aria-label={`${categoryInfo(incident.category).label}: ${incident.title}`}>
    <span className="inc-card-icon"><Icon size={20}/></span>
    <span className="inc-card-body">
      <span className="inc-card-top"><span className={`inc-badge ${incident.severity}`}>{severityInfo(incident.severity).label}</span><span className={`inc-badge state ${ended?'ended':''} ${state.state==='pending'?'pending':''}`}>{state.live&&<i className="inc-dot" aria-hidden="true"/>}{state.label}</span>{incident.demo&&<span className="inc-badge notice">Sample</span>}</span>
      <strong>{incident.title}</strong>
      <span><MapPin size={12}/>{incident.location}{distanceLabel?` · ${distanceLabel}`:''}</span>
      <span className={`inc-corroboration ${who.level}`}><Users size={12}/>{who.label}</span>
      <small>{categoryInfo(incident.category).label} · {incidentTimeAgo(incident.createdAt,now)}{incident.own?' · your report':''}</small>
    </span>
  </button>;
}

export default function IncidentHub({incidents,own,resolved,demo,clock,distance,originLabel,loading,error,updatedAt,onRefresh,onOpen,onReport,onMap}:{incidents:Row[];own:Row[];resolved:Row[];demo:boolean;clock:number;distance:(row:Row)=>number;originLabel:string;loading:boolean;error:string;updatedAt:number|null;onRefresh:()=>void;onOpen:(id:string)=>void;onReport:()=>void;onMap:()=>void}) {
  const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[severity,setSeverity]=useState('all');
  const live=incidents.filter(row=>incidentState(row,clock).live);
  const shown=sortIncidents(live.filter(row=>incidentMatches(row,{query,category,severity})));
  const urgent=live.filter(row=>row.severity==='urgent').length;
  const km=(row:Row)=>{const value=distance(row);return Number.isFinite(value)?value<1?`${Math.round(value*1000)} m`:`${value.toFixed(1)} km`:undefined};
  const counts=Object.fromEntries(INCIDENT_CATEGORIES.map(item=>[item.id,live.filter(row=>row.category===item.id).length]));
  return <section className="incident-hub" aria-label="Campus incidents">
    <div className="inc-tape" aria-hidden="true"/>
    <div className="inc-heading" style={{marginTop:18}}><span className="inc-symbol"><Siren size={26}/></span><div><div className="eyebrow"><i className="inc-dot" aria-hidden="true"/>CAMPUS INCIDENTS · {live.length?`${live.length} LIVE`:'ALL QUIET'}</div><h2>What’s happening right now.</h2><p>Student heads-ups about fights, spills, alarms, protests and disruption. Others corroborate what they can see, or clear it when it’s over.</p></div></div>
    <EmergencyStrip/>
    <div className="inc-mode-note">{demo?'Private demo · fictional sample alerts plus your own browser-only reports. Nothing here is happening.':'Community reports from signed-in UCL students. Checked automatically for personal details and abuse; not verified by UCL or Security. Corroboration counts other students, not officials.'}</div>
    <div className="inc-actions"><button className="button alert" onClick={onReport}><Plus size={16}/>Report an incident</button><button className="button ghost-alert" onClick={onMap}><MapPin size={15}/>Show on map</button><button className="text-link" disabled={loading} onClick={onRefresh}><RefreshCw size={13} className={loading?'spin':''}/>Refresh</button></div>
    <div className="inc-filters"><input aria-label="Search incidents" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by place, type or words in the report…"/><select aria-label="Severity" value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">Any severity</option>{INCIDENT_SEVERITIES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
    <div className="inc-chips" role="group" aria-label="Incident type"><button type="button" aria-pressed={category==='all'} onClick={()=>setCategory('all')}>All <b>{live.length}</b></button>{INCIDENT_CATEGORIES.filter(item=>counts[item.id]>0).map(item=>{const Icon=icons[item.id];return <button type="button" key={item.id} aria-pressed={category===item.id} onClick={()=>setCategory(category===item.id?'all':item.id)}><Icon size={11}/>{item.label} <b>{counts[item.id]}</b></button>})}</div>
    {error&&<p role="alert" className="form-error">{error} {live.length?'Showing the last received alerts.':''}</p>}
    <div className="inc-meta"><strong>{shown.length} live {shown.length===1?'alert':'alerts'}{urgent?` · ${urgent} urgent`:''}</strong><span>{loading?'Refreshing…':!demo&&updatedAt?`Refreshed ${Math.max(0,Math.floor((clock-updatedAt)/1000))}s ago · every 15s while open`:demo?'Demo · no live polling':''}</span></div>
    <p className="fineprint">Straight-line distances from {originLabel}. Red pulsing pins on the map are urgent reports.</p>
    <div className="inc-list">{shown.map(row=><IncidentCard key={row.id} incident={row} now={clock} distanceLabel={km(row)} onOpen={()=>onOpen(row.id)}/>)}</div>
    {!loading&&!shown.length&&<div className="inc-empty"><Siren size={30}/><h3>{live.length?'No alerts match these filters.':'Nothing reported right now.'}</h3><p>{live.length?'Try another type or clear the search.':'Quiet campus. If you see something others should know about, report it here. Alerts expire on their own and students can clear them early.'}</p>{live.length?<button className="button ghost-alert" onClick={()=>{setQuery('');setCategory('all');setSeverity('all')}}>Clear filters</button>:null}</div>}
    {own.length>0&&<div className="inc-section"><h3><ShieldAlert size={13}/>Your reports awaiting review</h3><div className="inc-list">{own.map(row=><IncidentCard key={row.id} incident={row} now={clock} onOpen={()=>onOpen(row.id)}/>)}</div></div>}
    {resolved.length>0&&<div className="inc-section"><h3>Recently cleared</h3><div className="inc-list">{resolved.slice(0,8).map(row=><IncidentCard key={row.id} incident={row} now={clock} onOpen={()=>onOpen(row.id)}/>)}</div></div>}
    <p className="inc-footnote">Reports are written by students in the moment and can be wrong. Three students saying “it’s over” (and outnumbering those who can still see it) clears an alert; three abuse flags hide one for moderators. Never include names, faces or anything that identifies a private individual. <a href={EMERGENCY_CONTACTS.sourceUrl} target="_blank" rel="noreferrer" style={{color:'inherit',textDecoration:'underline'}}>UCL emergency contacts <ExternalLink size={10} style={{display:'inline'}}/></a></p>
  </section>;
}
