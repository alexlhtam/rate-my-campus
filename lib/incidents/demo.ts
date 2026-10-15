import {INCIDENT_CATEGORIES,INCIDENT_CLEAR_QUORUM,INCIDENT_MAX_MINUTES,INCIDENT_SEVERITIES} from './model';

type Row=Record<string,any>;
export type DemoIncidentState={incidents:Row[];votes:Record<string,string>};
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);
const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const stamp=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const clip=(value:unknown,limit:number)=>typeof value==='string'?value.slice(0,limit):'';

/** Clearly fictional sample alerts at real, verified campus positions. */
export function demoIncidents(epoch:number):Row[] {
  const at=(minutesAgo:number)=>new Date(epoch-minutesAgo*60000).toISOString(),until=(minutes:number)=>new Date(epoch+minutes*60000).toISOString();
  return [
    {id:'demo-incident-spill',type:'incident',demo:true,category:'hazard',severity:'warning',title:'Example · chemical smell near a lab corridor',description:'Fictional sample alert: a strong solvent smell reported on a first-floor corridor. Illustrative only; nothing is happening here. Shows how a caution-level hazard looks.',location:'Christopher Ingold Building · example corridor',lat:51.5253,lng:-0.1323,status:'approved',createdAt:at(12),expiresAt:until(108),resolvedAt:null,resolution:null,confirmCount:2,clearCount:0,own:false},
    {id:'demo-incident-protest',type:'incident',demo:true,category:'protest',severity:'notice',title:'Example · demonstration gathering in the Main Quad',description:'Fictional heads-up: a peaceful demonstration with speeches is gathering. The Portico steps are busy; use the side entrances if you are in a hurry. No real event is taking place.',location:'UCL Main Quad',lat:51.52452,lng:-0.13402,status:'approved',createdAt:at(35),expiresAt:until(205),resolvedAt:null,resolution:null,confirmCount:4,clearCount:1,own:false},
    {id:'demo-incident-alarm',type:'incident',demo:true,category:'fire',severity:'urgent',title:'Example · fire alarm, building being evacuated',description:'Fictional urgent alert used to show the red pulse on the map. Everyone is leaving by the stairs. This is a demonstration, not a live evacuation.',location:'Student Centre · all floors',lat:51.5247529,lng:-0.1326144,status:'approved',createdAt:at(4),expiresAt:until(56),resolvedAt:null,resolution:null,confirmCount:0,clearCount:0,own:false},
    {id:'demo-incident-cleared',type:'incident',demo:true,category:'disruption',severity:'notice',title:'Example · lift out of order, now fixed',description:'Fictional cleared alert showing how a resolved heads-up appears in the recently cleared list.',location:'Wilkins Building · example lift',lat:51.5246607,lng:-0.1338349,status:'approved',createdAt:at(140),expiresAt:until(100),resolvedAt:at(20),resolution:'community',confirmCount:3,clearCount:3,own:false},
  ];
}

export function parseDemoIncidents(raw:string|null):DemoIncidentState {
  const result:DemoIncidentState={incidents:[],votes:{}};
  if(!raw||raw.length>4*1024*1024)return result;
  let value:unknown;try{value=JSON.parse(raw);}catch{return result;}
  if(!object(value))return result;
  const rows=Array.isArray(value.incidents)?value.incidents:[];
  result.incidents=rows.filter((row):row is Row=>object(row)&&id(row.id)&&INCIDENT_CATEGORIES.some(item=>item.id===row.category)&&INCIDENT_SEVERITIES.some(item=>item.id===row.severity)&&typeof row.title==='string'&&!!stamp(row.createdAt)&&!!stamp(row.expiresAt)&&typeof row.lat==='number'&&Number.isFinite(row.lat)&&Math.abs(row.lat)<=90&&typeof row.lng==='number'&&Number.isFinite(row.lng)&&Math.abs(row.lng)<=180).slice(0,200)
    .map(row=>({id:row.id,type:'incident',demo:true,own:true,category:row.category,severity:row.severity,title:clip(row.title,90),description:clip(row.description,1200),location:clip(row.location,150),lat:row.lat,lng:row.lng,status:'approved',createdAt:row.createdAt,expiresAt:row.expiresAt,resolvedAt:stamp(row.resolvedAt),resolution:['reporter','community','moderator'].includes(String(row.resolution))?row.resolution:null,confirmCount:0,clearCount:0,
      ...(typeof row.image==='string'&&/^data:image\/(?:png|jpe?g|webp);base64,/.test(row.image)&&row.image.length<=7*1024*1024?{image:row.image}:{})}));
  result.votes=Object.fromEntries(Object.entries(object(value.votes)?value.votes:{}).filter(([key,vote])=>id(key)&&(vote==='confirm'||vote==='clear')).slice(0,2000)) as Record<string,string>;
  return result;
}

/** Browser-only lifecycle for the private demo: one local viewer, no moderation, no other students. */
export function applyDemoIncidentAction(state:DemoIncidentState,action:Row,now=Date.now()):DemoIncidentState {
  if(action.action==='create'){
    const expiresAt=Date.parse(String(action.expiresAt));
    if(!INCIDENT_CATEGORIES.some(item=>item.id===action.category)||!INCIDENT_SEVERITIES.some(item=>item.id===action.severity))throw new Error('Choose an incident type and severity.');
    if(typeof action.title!=='string'||action.title.trim().length<4||typeof action.location!=='string'||action.location.trim().length<3)throw new Error('Add a short headline and a location.');
    if(!Number.isFinite(expiresAt)||expiresAt<=now||expiresAt>now+INCIDENT_MAX_MINUTES*60000)throw new Error('Incident reports stay live for at most 24 hours.');
    const row={id:String(action.id),type:'incident',demo:true,own:true,category:action.category,severity:action.severity,title:action.title.trim().slice(0,90),description:String(action.description||'').trim().slice(0,1200),location:action.location.trim().slice(0,150),lat:Number(action.lat),lng:Number(action.lng),status:'approved',createdAt:new Date(now).toISOString(),expiresAt:new Date(expiresAt).toISOString(),resolvedAt:null,resolution:null,confirmCount:0,clearCount:0,...(action.image?{image:action.image}:{})};
    return {...state,incidents:[row,...state.incidents]};
  }
  if(action.action==='vote'){
    if(action.kind!=='confirm'&&action.kind!=='clear')throw new Error('Choose a response.');
    return {...state,votes:{...state.votes,[String(action.id)]:action.kind}};
  }
  const target=state.incidents.find(row=>row.id===action.id);
  if(!target)throw new Error('This is not one of your demo reports.');
  if(action.action==='resolve')return {...state,incidents:state.incidents.map(row=>row.id===target.id?{...row,resolvedAt:row.resolvedAt||new Date(now).toISOString(),resolution:row.resolution||'reporter'}:row)};
  if(action.action==='delete')return {...state,incidents:state.incidents.filter(row=>row.id!==target.id),votes:Object.fromEntries(Object.entries(state.votes).filter(([key])=>key!==target.id))};
  throw new Error('Unknown demo incident action.');
}

/** Sample alerts fold in the local viewer's response so the demo shows the clear quorum at work. */
export function withDemoIncidentVote(row:Row,vote?:string):Row {
  if(!vote)return row;
  const confirmCount=Number(row.confirmCount||0)+(vote==='confirm'?1:0),clearCount=Number(row.clearCount||0)+(vote==='clear'?1:0);
  const cleared=!row.resolvedAt&&clearCount>=INCIDENT_CLEAR_QUORUM&&clearCount>confirmCount;
  return {...row,confirmCount,clearCount,...(cleared?{resolvedAt:new Date().toISOString(),resolution:'community'}:{})};
}
