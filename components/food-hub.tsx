'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Clock,MapPin,Plus,RefreshCw,Utensils} from 'lucide-react';
import {readFoodPages} from '@/lib/food-feed';
import {FOOD_DIETARY,foodAvailability,foodMatches,foodQuantity,foodUpdatedLabel,readFoodDetails} from '@/lib/food';
type Row=Record<string,any>;
export function useFoodFeed(demo:boolean,signedIn=false) {
  const [posts,setPosts]=useState<Row[]>([]),[total,setTotal]=useState(0),[nextOffset,setNextOffset]=useState<number|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[updatedAt,setUpdatedAt]=useState<number|null>(null);
  const generation=useRef(0),mounted=useRef(true),mode=useRef(demo),displayed=useRef(40),inFlight=useRef(false),controller=useRef<AbortController|null>(null);mode.current=demo;
  const refresh=useCallback(async(offset=0)=>{
    if(demo||mode.current)return;
    const revision=++generation.current,desired=Math.max(displayed.current,offset+40);
    controller.current?.abort();const request=new AbortController();controller.current=request;inFlight.current=true;setLoading(true);
    const timeout=setTimeout(()=>request.abort(),30000);
    try {
      const body=await readFoodPages(async pageOffset=>{
        const response=await fetch(`/api/community/food?offset=${pageOffset}`,{cache:'no-store',signal:request.signal});
        const page=await response.json();if(!response.ok)throw new Error(page.error||'Food alerts could not be refreshed.');return page;
      },desired);
      if(!mounted.current||revision!==generation.current||mode.current)return;
      displayed.current=desired;setPosts(body.posts);setTotal(body.total);setNextOffset(body.nextOffset);setError('');setUpdatedAt(Date.now());
    }catch(failure){if(mounted.current&&revision===generation.current&&!mode.current)setError((failure as Error).name==='AbortError'?'Food alerts took too long to refresh. Please try again.':(failure as Error).message)}finally{clearTimeout(timeout);if(revision===generation.current){inFlight.current=false;if(mounted.current)setLoading(false)}}
  },[demo]);
  useEffect(()=>{mounted.current=true;generation.current++;displayed.current=40;setPosts([]);setError('');setTotal(0);setNextOffset(null);setUpdatedAt(null);setLoading(false);if(!demo)void refresh();const check=()=>{if(!demo&&!inFlight.current&&document.visibilityState==='visible')void refresh()};const timer=setInterval(check,15000);document.addEventListener('visibilitychange',check);return()=>{mounted.current=false;generation.current++;inFlight.current=false;controller.current?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',check)}},[demo,signedIn,refresh]);
  return {posts,total,nextOffset,loading,error,updatedAt,refresh};
}
export default function FoodHub({posts,demo,clock,distance,originLabel,loading,error,updatedAt,total,loadedCount,hasMore,onMore,onRefresh,onOpen,onShare,onContributions,onMap,onRestartDemo}:{posts:Row[];demo:boolean;clock:number;distance:(row:Row)=>number;originLabel:string;loading:boolean;error:string;updatedAt:number|null;total:number;loadedCount:number;hasMore:boolean;onMore:()=>void;onRefresh:()=>void;onOpen:(id:string)=>void;onShare:()=>void;onContributions:()=>void;onMap:()=>void;onRestartDemo:()=>void}) {
  const [query,setQuery]=useState(''),[dietary,setDietary]=useState('all'),[range,setRange]=useState(0),[order,setOrder]=useState('ending'),[ending,setEnding]=useState(false);
  const shown=posts.filter(row=>row.type==='food'&&foodMatches(row,{query,dietary,maxDistance:range,distance,endingSoon:ending},clock)).sort((a,b)=>order==='nearest'?distance(a)-distance(b):Date.parse(a.expiresAt)-Date.parse(b.expiresAt));
  const available=posts.filter(row=>row.type==='food'&&foodAvailability(row,clock).available).length;
  return <section className="food-hub" aria-label="Leftover food">
    <div className="food-heading"><span className="food-symbol"><Utensils size={25}/></span><div><div className="eyebrow">GOOD FOOD, SHARED</div><h2>Food for the taking.</h2><p>Find a nearby pickup before the leftovers are gone.</p></div></div>
    <div className="food-mode-note">{demo?'Private demo · sample alerts and your own browser-only posts.':'Community alerts · first come, first served. Quantities are estimates.'}</div>
    <div className="food-actions"><button className="button dark" onClick={onShare}><Plus size={16}/>Share leftover food</button><button className="button light" onClick={onMap}><MapPin size={15}/>Show food on map</button><button className="text-link" onClick={onContributions}>Manage my food</button></div>
    <div className="food-filter-grid"><label>Find food<input aria-label="Search leftover food" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pizza, sandwiches, a building…"/></label><label>Dietary claim<select value={dietary} onChange={e=>setDietary(e.target.value)}><option value="all">Any / unknown</option>{FOOD_DIETARY.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>Distance<select value={range} onChange={e=>setRange(Number(e.target.value))}><option value={0}>Anywhere</option><option value={.5}>Within 500 m</option><option value={1}>Within 1 km</option><option value={2}>Within 2 km</option></select></label><label>Sort<select value={order} onChange={e=>setOrder(e.target.value)}><option value="ending">Ending soonest</option><option value="nearest">Nearest first</option></select></label></div>
    <div className="food-feed-meta"><label className="food-check"><input type="checkbox" checked={ending} onChange={e=>setEnding(e.target.checked)}/>Ending in 10 minutes</label><button className="text-link" disabled={loading} onClick={onRefresh}><RefreshCw size={13}/>Refresh</button></div>
    <p className="fineprint">Straight-line distances from {originLabel}. Dietary tags are the sharer’s claims; check ingredients and allergens at pickup.</p>
    {error&&<p role="alert" className="form-error">{error} {available?'Showing the last received alerts; refresh before travelling.':''}</p>}
    {!demo&&updatedAt&&<p className="fineprint">Refreshed {Math.max(0,Math.floor((clock-updatedAt)/1000))} seconds ago · checks every 15 seconds while this page is visible.</p>}
    <div className="food-feed-meta"><strong>{shown.length} {shown.length===1?'pickup':'pickups'}{!demo&&hasMore?` from ${loadedCount} loaded of ${total}`:''}</strong>{loading&&<span role="status">Refreshing…</span>}</div>
    <div className="food-card-list">{shown.map(post=>{const status=foodAvailability(post,clock),details=readFoodDetails(post.foodDetails),km=distance(post);return <button className="food-card" key={post.id} onClick={()=>onOpen(post.id)}>
      {post.image?<img src={post.image} alt={post.demo?'Illustrative demo food':'Food shared by the poster'}/>:<span className="food-card-art"><Utensils size={26}/></span>}
      <span className="food-card-body"><span className={`food-badge ${status.endingSoon?'urgent':''}`}><Clock size={12}/>{status.label}</span><strong>{post.title}</strong><span><MapPin size={12}/>{post.location}</span><span>{foodQuantity(post)} · {Number.isFinite(km)?km<1?`${Math.round(km*1000)} m`:`${km.toFixed(1)} km`:'Distance unknown'}</span><small>{details.allergenStatus==='unknown'?'Allergen information unknown':'Allergen information supplied · check details'}</small><small>{foodUpdatedLabel(post,clock)}</small></span>
    </button>})}</div>
    {!loading&&!shown.length&&<div className="food-empty"><Utensils size={30}/><h3>{available?'No pickups match these filters.':'No food available right now.'}</h3><p>{available?'Try a wider distance or another dietary filter.':'Food alerts disappear when collection ends. Check back later or share leftovers from your event.'}</p>{available?<button className="button light" onClick={()=>{setQuery('');setDietary('all');setRange(0);setEnding(false)}}>Clear food filters</button>:demo?<button className="button light" onClick={onRestartDemo}>Restart sample food alerts</button>:null}</div>}
    {!demo&&hasMore&&<button className="button light full" disabled={loading} onClick={onMore}>Load more food alerts</button>}
    <p className="food-safety-note">The countdown shows the collection window, not a guarantee of food safety. Check ingredients, storage and condition with the sharer before taking food.</p>
  </section>;
}
