/** Shared incident vocabulary and view helpers. Safe for the browser and the server. */
export const INCIDENT_CATEGORIES = [
  {id:'violence',label:'Fight or assault',hint:'Physical violence, threats or a brawl',defaultSeverity:'urgent'},
  {id:'hazard',label:'Spill or hazard',hint:'Chemical spill, gas smell, broken glass, flooding',defaultSeverity:'warning'},
  {id:'fire',label:'Fire or alarm',hint:'Smoke, fire or a building evacuation',defaultSeverity:'urgent'},
  {id:'medical',label:'Medical emergency',hint:'Someone collapsed or seriously hurt',defaultSeverity:'urgent'},
  {id:'security',label:'Security incident',hint:'Theft, intruder, suspicious package, lockdown',defaultSeverity:'warning'},
  {id:'protest',label:'Protest or crowd',hint:'Demonstration, blocked entrance, large crowd',defaultSeverity:'notice'},
  {id:'disruption',label:'Disruption',hint:'Power cut, lift failure, closed route, transport problem',defaultSeverity:'notice'},
  {id:'other',label:'Something else',hint:'Anything others nearby should know about now',defaultSeverity:'notice'},
] as const;
export type IncidentCategory = typeof INCIDENT_CATEGORIES[number]['id'];
export const INCIDENT_SEVERITIES = [
  {id:'notice',label:'Heads-up',hint:'Worth knowing; no immediate danger'},
  {id:'warning',label:'Caution',hint:'Avoid the area or take care'},
  {id:'urgent',label:'Urgent',hint:'Danger to people right now'},
] as const;
export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number]['id'];
export const INCIDENT_DURATIONS = [{minutes:30,label:'30 minutes'},{minutes:60,label:'1 hour'},{minutes:120,label:'2 hours'},{minutes:240,label:'4 hours'},{minutes:480,label:'8 hours'},{minutes:1440,label:'24 hours'}] as const;
export const INCIDENT_MAX_MINUTES = 1440;
export const INCIDENT_CLEAR_QUORUM = 3;
/** Verified against UCL's emergency-contacts page on 15 October 2026. */
export const EMERGENCY_CONTACTS = {
  emergency:{label:'Emergency services',number:'999',dial:'999'},
  bloomsbury:{label:'UCL Security · Bloomsbury (24h)',number:'020 7679 2222',dial:'+442076792222',extension:'ext. 222'},
  east:{label:'UCL Security · UCL East',number:'0208 016 0555',dial:'+442080160555'},
  sourceUrl:'https://www.ucl.ac.uk/students/support-and-wellbeing-services/emergency-contacts',
} as const;
export const severityRank:Record<IncidentSeverity,number>={urgent:0,warning:1,notice:2};
export function categoryInfo(id:unknown){return INCIDENT_CATEGORIES.find(item=>item.id===id)||INCIDENT_CATEGORIES[INCIDENT_CATEGORIES.length-1];}
export function severityInfo(id:unknown){return INCIDENT_SEVERITIES.find(item=>item.id===id)||INCIDENT_SEVERITIES[0];}

type Row=Record<string,any>;
export type IncidentState='live'|'pending'|'hidden'|'resolved'|'expired';
export function incidentState(row:Row,now=Date.now()):{state:IncidentState;label:string;remainingMs:number;countdown:string;live:boolean;endingSoon:boolean} {
  const end=Date.parse(row.expiresAt),remainingMs=Number.isFinite(end)?Math.max(0,end-now):0;
  const state:IncidentState=row.resolvedAt?'resolved':row.status==='hidden'?'hidden':row.status==='pending'?'pending':!remainingMs?'expired':'live';
  const seconds=Math.floor(remainingMs/1000);
  const countdown=seconds>=3600?`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  const label=state==='resolved'?(row.resolution==='community'?'Cleared by students':row.resolution==='moderator'?'Cleared by a moderator':'Marked over by the reporter'):state==='hidden'?'Hidden pending review':state==='pending'?'Awaiting moderation':state==='expired'?'Expired':`Live · ${countdown} left`;
  return {state,label,remainingMs,countdown,live:state==='live',endingSoon:state==='live'&&remainingMs<=15*60000};
}
export function corroborationLabel(confirms:number,clears:number):{label:string;level:'single'|'corroborated'|'widely'|'disputed'} {
  if(clears>confirms&&clears>0)return {label:`Disputed · ${clears} say it’s over`,level:'disputed'};
  if(confirms>=INCIDENT_CLEAR_QUORUM)return {label:`Widely reported · ${confirms+1} people`,level:'widely'};
  if(confirms>0)return {label:`Corroborated by ${confirms} other${confirms===1?'':'s'}`,level:'corroborated'};
  return {label:'Single report · not yet corroborated',level:'single'};
}
export function incidentMatches(row:Row,filters:{query?:string;category?:string;severity?:string}):boolean {
  if(filters.category&&filters.category!=='all'&&row.category!==filters.category)return false;
  if(filters.severity&&filters.severity!=='all'&&row.severity!==filters.severity)return false;
  const words=(filters.query||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text=[row.title,row.description,row.location,categoryInfo(row.category).label].join(' ').toLowerCase();
  return words.every(word=>text.includes(word));
}
/** Urgent first, then most corroborated, then newest. */
export function sortIncidents<T extends Row>(rows:T[]):T[] {
  return [...rows].sort((a,b)=>(severityRank[a.severity as IncidentSeverity]??3)-(severityRank[b.severity as IncidentSeverity]??3)||Number(b.confirmCount||0)-Number(a.confirmCount||0)||Date.parse(b.createdAt)-Date.parse(a.createdAt));
}
export function incidentTimeAgo(iso:string,now=Date.now()):string {
  const time=Date.parse(iso);if(!Number.isFinite(time))return '';
  const minutes=Math.max(0,Math.floor((now-time)/60000));
  return minutes<1?'Reported just now':minutes<60?`Reported ${minutes} min ago`:`Reported ${Math.floor(minutes/60)}h ${minutes%60}m ago`;
}
