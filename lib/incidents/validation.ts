import {HttpError,finiteNumber,privateInformationReason,textField} from '../community-validation';
import {INCIDENT_CATEGORIES,INCIDENT_MAX_MINUTES,INCIDENT_SEVERITIES} from './model';

export type IncidentInput={category:string;severity:string;title:string;description:string;location:string;lat:number;lng:number;expiresAt:number;photoKey:string|null};

/** A report describes what is happening at a public campus location, never who. */
export function incidentInput(body:Record<string,unknown>,now=Date.now()):IncidentInput {
  const category=textField(body.category,'Incident type',1,20);
  if(!INCIDENT_CATEGORIES.some(item=>item.id===category))throw new HttpError(400,'Choose an incident type.');
  const severity=textField(body.severity,'Severity',1,10);
  if(!INCIDENT_SEVERITIES.some(item=>item.id===severity))throw new HttpError(400,'Choose heads-up, caution or urgent.');
  const title=textField(body.title,'Headline',4,90);
  const description=textField(body.description??'','Details',0,1200);
  const location=textField(body.location,'Location',3,150);
  const privacy=privateInformationReason([title,description,location].join('\n'));
  if(privacy)throw new HttpError(400,privacy);
  if(body.locationConfirmed!==true)throw new HttpError(400,'Confirm the incident location on the map.');
  if(body.safetyAcknowledged!==true)throw new HttpError(400,'Confirm that you have contacted emergency services or UCL Security if anyone is in danger.');
  const expiresAt=typeof body.expiresAt==='number'?body.expiresAt:Date.parse(String(body.expiresAt));
  if(!Number.isFinite(expiresAt)||expiresAt<=now||expiresAt>now+INCIDENT_MAX_MINUTES*60000)throw new HttpError(400,'Incident reports stay live for at most 24 hours.');
  const photoKey=body.photoKey==null||body.photoKey===''?null:textField(body.photoKey,'Photo',1,150);
  if(photoKey&&!/^photos\/[a-f0-9-]+\.(jpg|png|webp)$/.test(photoKey))throw new HttpError(400,'Upload the photo again.');
  return {category,severity,title,description,location,lat:finiteNumber(body.lat,'Latitude',51.35,51.68),lng:finiteNumber(body.lng,'Longitude',-0.35,0.1),expiresAt:Math.floor(expiresAt),photoKey};
}

export function incidentVoteKind(value:unknown):'confirm'|'clear' {
  const kind=textField(value,'Response',1,10);
  if(kind!=='confirm'&&kind!=='clear')throw new HttpError(400,'Choose “I can see this too” or “It’s over”.');
  return kind;
}
