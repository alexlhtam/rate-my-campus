import {addDays,londonDate,londonMidnight} from './ucl';
import type {EventRecord,Extraction} from './types';
import type {PinType} from '../data';

export type FreebieTime = 'now'|'today'|'week'|'fortnight';
export const freebieTimes: {id:FreebieTime;label:string}[] = [
  {id:'now',label:'Now'},{id:'today',label:'Today'},{id:'week',label:'This week'},{id:'fortnight',label:'2 weeks'},
];
export type EventPin = {
  id:string;type?:PinType;title:string;location:string;description?:string;organizer?:string;lat?:number|null;lng?:number|null;
  startsAt?:string|null;expiresAt:string;sourceUrl?:string|null;dietary?:string[];
  freebie?:(Extraction&{locationProvider?:string;eventEnd?:string|null})|null;demo?:boolean;
};
export function eventWindow(filter:FreebieTime,now:number) {
  const today=londonDate(new Date(now));
  const weekday=(new Date(today+'T12:00:00Z').getUTCDay()+6)%7;
  return {start:now,end:filter==='now'?now: londonMidnight(addDays(today,filter==='today'?1:filter==='week'?7-weekday:14)).getTime()};
}
export function inFreebieWindow(pin:Pick<EventPin,'startsAt'|'expiresAt'>,filter:FreebieTime,now:number) {
  const start=pin.startsAt?Date.parse(pin.startsAt):now,end=Date.parse(pin.expiresAt),window=eventWindow(filter,now);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=now)return false;
  return filter==='now'?start<=now:start<window.end;
}
const dayTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
export function eventTime(value?:string|null){return value&&Number.isFinite(Date.parse(value))?dayTime.format(new Date(value)):'Time not stated';}
export type EventFeedMetadata = {
  importReady:boolean;
  importStatus:'ready'|'disabled'|'setup_required';
  lastScan:{start_date:string;end_date:string;updated_at:string;status:string;exhausted:number;coverageComplete:boolean}|null;
};
export type EventFeedStatus = {
  state:'disabled'|'setup_required'|'not_started'|'importing'|'incomplete'|'outdated'|'empty'|'current';
  title:string;
  detail:string;
  lastChecked:string|null;
};
/** Counts describe published records, never the size of the Union calendar. */
export function eventFeedStatus(meta:EventFeedMetadata,count:number,now:number):EventFeedStatus {
  const total=Number.isFinite(count)?Math.max(0,Math.floor(count)):0;
  const countText=total?`${total} published Union ${total===1?'event is':'events are'} available.`:'No Union events have been published for the next two weeks.';
  const scan=meta.lastScan,updated=scan?Date.parse(scan.updated_at):NaN;
  const lastChecked=Number.isFinite(updated)?eventTime(scan!.updated_at):null;
  const result=(state:EventFeedStatus['state'],title:string,detail:string):EventFeedStatus=>({state,title,detail:countText+' '+detail,lastChecked});
  if(meta.importStatus==='disabled')return result('disabled','Union event updates are switched off.','Browse the Union calendar for current listings.');
  if(meta.importStatus==='setup_required'||!meta.importReady)return result('setup_required','Union event updates need connecting.','The import service is not ready yet. Browse the Union calendar for current listings.');
  if(!scan)return result('not_started','Union events have not been imported yet.','The first import still needs to run.');
  if(['running','discovering'].includes(scan.status)){
    // A saved running flag is not evidence that an interrupted worker continues.
    if(!Number.isFinite(updated)||now-updated>30*60000)return result('incomplete','The latest Union import has not finished.','Coverage is incomplete; the import needs checking.');
    return result('importing','Union events are being imported.','More listings may appear as the import finishes.');
  }
  if(!scan.coverageComplete||scan.status!=='complete')return result('incomplete','Some Union listings still need checking.','The latest import is incomplete. Browse the Union calendar for the full programme.');
  const today=londonDate(new Date(now)),windowEnd=addDays(today,14);
  if(!Number.isFinite(updated)||updated>now+5*60000||now-updated>24*60*60000||scan.start_date>today||scan.end_date<windowEnd)return result('outdated','Union listings need a fresh check.','The latest import does not cover the current two-week window.');
  return total?result('current','Union events for the next two weeks.','Events with confirmed venues appear on the map; online or unconfirmed venues stay in the list.')
    :result('empty','No published Union events in this window.','The latest import has finished. Check the Union calendar for unpublished or newly added listings.');
}
export function eventBadge(pin:Pick<EventPin,'startsAt'|'expiresAt'>,now:number) {
  const start=pin.startsAt?Date.parse(pin.startsAt):now,end=Date.parse(pin.expiresAt);
  if(!Number.isFinite(end)||end<=now)return {state:'ended',label:'Ended'};
  if(start>now)return {state:'upcoming',label:eventTime(pin.startsAt)};
  const seconds=Math.max(0,Math.ceil((end-now)/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
  return {state:'live',label:hours?hours+'h '+minutes+'m left':minutes+':'+String(seconds%60).padStart(2,'0')+' left'};
}
export function eventLocated(pin:Pick<EventPin,'lat'|'lng'|'freebie'>) {
  return pin.freebie?.attendance!=='online'&&typeof pin.lat==='number'&&Number.isFinite(pin.lat)&&typeof pin.lng==='number'&&Number.isFinite(pin.lng);
}
/** The calendar's explicit online flag wins over an incomplete extraction. */
export function canConfirmEventVenue(event:Pick<EventRecord,'publishedPostId'|'sourceOnline'|'extraction'>) {
  return Boolean(event.publishedPostId)&&event.sourceOnline!==true&&event.extraction?.attendance!=='online';
}
export function admissionLabel(details?:Extraction|null) {
  if(!details)return 'Ticket / membership requirements not stated';
  const label={free:'Free entry',paid:'Paid ticket required',mixed:'Ticket prices vary',unknown:'Entry price not stated'}[details.admission];
  return [label,details.bookingRequired===true?'Booking required':details.bookingRequired===false?'No booking required':null].filter(Boolean).join(' · ');
}
/** Spreadsheet exports cannot interpret source text as a formula. */
export function csvCell(value:unknown) {
  let text=String(value??'');
  if(/^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
