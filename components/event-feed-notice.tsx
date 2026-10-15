'use client';

import {eventFeedStatus,type EventFeedMetadata} from '@/lib/freebies/view';

export default function EventFeedNotice({metadata,count,locatedCount,now,loading,error,admin,onRefresh,onManage,onShowEvents}:{
 metadata:EventFeedMetadata|null;count:number;now:number;loading:boolean;error:boolean;admin:boolean;
 onRefresh:()=>void;onManage:()=>void;onShowEvents?:()=>void;locatedCount?:number;
}){
 const status=metadata?eventFeedStatus(metadata,count,now):null;
 return <section className="event-feed-status" aria-label="Union event updates">
  <div role="status">
   <strong>{error?'Union events couldn’t refresh.':status?.title||'Checking Union events…'}</strong>
   <p>{error?(metadata?'Previously loaded listings are still shown. Try refreshing again.':'The event service is unavailable right now. Try again or browse the Union calendar below.'):status?.detail||'Loading published listings for the next two weeks.'}</p>
   {status?.lastChecked&&<small>Last import update: {status.lastChecked} · London time</small>}
   {count>0&&locatedCount!==undefined&&<p>{locatedCount} with map locations · {Math.max(0,count-locatedCount)} online or awaiting a confirmed venue. All are available in the event list.</p>}
  </div>
  <div className="event-feed-actions">
   {count>0&&onShowEvents&&<button onClick={onShowEvents}>Show {count} published {count===1?'event':'events'}</button>}
   <button onClick={onRefresh} disabled={loading}>{loading?'Refreshing…':'Refresh'}</button>
   <a href="https://studentsunionucl.org/whats-on" target="_blank" rel="noreferrer">Union calendar ↗</a>
   {admin&&<button onClick={onManage}>Manage imports</button>}
  </div>
 </section>;
}
