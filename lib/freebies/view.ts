import {addDays,londonDate,londonMidnight} from './ucl';
import type {Extraction} from './types';

export type FreebieTime = 'now'|'today'|'week'|'fortnight';
export const freebieTimes: {id:FreebieTime;label:string}[] = [
  {id:'now',label:'Now'},{id:'today',label:'Today'},{id:'week',label:'This week'},{id:'fortnight',label:'2 weeks'},
];
export type EventPin = {
  id:string;title:string;location:string;description?:string;organizer?:string;lat?:number|null;lng?:number|null;
  startsAt?:string|null;expiresAt:string;sourceUrl?:string|null;dietary?:string[];
  freebie?:(Extraction&{locationProvider?:string})|null;demo?:boolean;
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
