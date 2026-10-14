'use client';
import {Bookmark,Clock,ExternalLink,Gift,MapPin} from 'lucide-react';
import {admissionLabel,eventBadge,eventLocated,eventTime,freebieTimes,type EventPin,type FreebieTime} from '@/lib/freebies/view';
import './freebie-events.css';

export function FreebieTimeFilter({value,onChange}:{value:FreebieTime;onChange:(value:FreebieTime)=>void}){
  return <fieldset className="freebie-time"><legend>Society freebies</legend><div>{freebieTimes.map(time=><button type="button" key={time.id} aria-pressed={value===time.id} onClick={()=>onChange(time.id)}>{time.label}</button>)}</div></fieldset>;
}
export function FreebieFacts({pin,expanded=false}:{pin:EventPin;expanded?:boolean}){
  const details=pin.freebie,located=eventLocated(pin);
  return <div className="freebie-facts">
    <p className="freebie-society">{details?.society?.name||(pin.demo?pin.organizer:null)||'Society not stated'}{pin.demo?' · Sample event':''}</p>
    <p><Clock size={14}/><span>{eventTime(pin.startsAt)}{details&&' – '+eventTime(pin.expiresAt)} <small>London time</small></span></p>
    <p><MapPin size={14}/><span>{located?pin.location:'Location TBC'}{!located&&<small>{details?.attendance==='online'?'Online event':pin.location||'Venue not confirmed'}</small>}</span></p>
    {details?.locationProvider==='google'&&<p className="google-venue-attribution" translate="no">Venue position · Google Maps</p>}
    {details?.freebies?.length?<ul className="freebie-items">{details.freebies.map((item,index)=><li key={index}><Gift size={13}/><span>{item.item}{item.certainty==='possible'&&<small>Cost unclear — check listing</small>}</span></li>)}</ul>:<p className="fineprint">{pin.description||'See the listing for what is included.'}</p>}
    <p className="freebie-admission">{admissionLabel(details)}</p>
    {details?.priceDetails&&<p>{details.priceDetails}</p>}
    {details?.eligibility?<p><b>Who can join:</b> {details.eligibility}</p>:<p className="fineprint">Membership requirements not stated.</p>}
    <div className="freebie-tags">{pin.dietary?.length?pin.dietary.map(tag=><span key={tag}>{tag}</span>):<small>Dietary information not stated</small>}</div>
    {expanded&&details&&<><p className="fineprint">Dietary tags describe the listing. Confirm ingredients and allergens with the organiser.</p>{details.conditions.length>0&&<ul className="freebie-conditions">{details.conditions.map((condition,index)=><li key={index}>{condition}</li>)}</ul>}<details className="freebie-evidence"><summary>What the listing says</summary>{details.freebies.map((item,index)=><blockquote key={index}>“{item.evidence}”</blockquote>)}{details.society&&<p>Organiser: “{details.society.evidence}”</p>}{details.dietary?.map(item=><p key={item.tag}>{item.tag}: “{item.evidence}”</p>)}</details>{details.bookingUrl&&<a className="source-link" href={details.bookingUrl} target="_blank" rel="noreferrer">Booking / tickets <ExternalLink size={12}/></a>}</>}
  </div>;
}
export function FreebieCard({pin,now,saved,onOpen,onSave}:{pin:EventPin;now:number;saved:boolean;onOpen:()=>void;onSave:()=>void}){
  const badge=eventBadge(pin,now);
  return <article className={'freebie-card '+badge.state}>
    <div className="freebie-card-top"><span className={'freebie-badge '+badge.state}><Clock size={12}/>{badge.state==='live'?'Live · ':''}{badge.label}</span><button className={'bookmark '+(saved?'saved':'')} aria-label={saved?'Unsave '+pin.title:'Save '+pin.title} onClick={onSave}><Bookmark size={17} fill={saved?'currentColor':'none'}/></button></div>
    <h3><button onClick={onOpen}>{pin.title}</button></h3>
    <FreebieFacts pin={pin}/>
    <div className="freebie-card-actions"><button onClick={onOpen}>{eventLocated(pin)?'View event & map':'View event'}</button>{pin.sourceUrl&&<a href={pin.sourceUrl} target="_blank" rel="noreferrer">Union listing <ExternalLink size={12}/></a>}</div>
  </article>;
}
