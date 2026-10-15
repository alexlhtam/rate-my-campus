'use client';
import {memo,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {Map as GLMap,GeoJSONSource,StyleSpecification,ErrorEvent as MapErrorEvent} from 'maplibre-gl';
import {MapPin,Plus,Minus,LocateFixed,Star,Gift,CalendarDays,Utensils,Tag,Search,X,Building2,ChevronDown,ExternalLink,Compass,Layers,Info} from 'lucide-react';
import FlatCampusMap from './campus-flat-map';
import {placesInBuilding} from '@/lib/data';
import {positionMapOverlays,mapOverlayPosition,updateBuildingHover,layoutOverlayGroups,type MapOverlay,type OverlayGroupLayout} from '@/lib/campus-map-overlays';
import {CAMPUS_VIEWS,prepareCampusGeometry,mapBuildings,geometryBounds,searchBuildings,isSafeSource,type CampusBuilding,type CampusDirectory,type CampusGeometry,type CampusFootprintIndex} from '@/lib/campus-map-model';

export type MapPosition={lat:number;lng:number};
export type MapProvider='google'|'openstreetmap'|'unavailable';
export type MapItem=MapPosition & {id:string;name?:string;title?:string;type?:string;score?:string;timeLabel?:string;eventState?:string;locationProvider?:string;campusBuildingId?:string};
type Props={items:MapItem[];onSelect:(id:string)=>void;selected?:string;confirm?:boolean;initialPosition?:MapPosition;requireGoogle?:boolean;onPosition?:(position:MapPosition)=>void;onProviderChange?:(provider:MapProvider)=>void};
type Coverage={north:number;south:number;east:number;west:number;zooms:number[];copyright:string};
type CampusAudit={unmatchedBuildings:{buildingId:string;reason:string}[]};
const icons:Record<string,typeof Star>={rated:Star,food:Utensils,freebie:Gift,event:CalendarDays,deal:Tag};
const occupation:Record<string,string>={'building':'Listed by UCL as a campus building.','facility':'UCL facility; access may be restricted.','part-of-building':'UCL uses part of this building.','shared-site':'Shared site; UCL is one of the users.','unconfirmed-extent':'UCL use is confirmed; the extent of occupation is not.'};
const emptyGeometry:CampusGeometry={type:'FeatureCollection',features:[]};
const emptyDirectory:CampusDirectory={datasetDate:'',buildings:[]};
const valid=(point?:MapPosition)=>point&&Number.isFinite(point.lat)&&Number.isFinite(point.lng)&&Math.abs(point.lat)<85&&Math.abs(point.lng)<180;
async function json<T>(url:string,signal?:AbortSignal):Promise<T>{const response=await fetch(url,{signal});if(!response.ok)throw new Error('Map service unavailable');return await response.json() as T;}
const osmStyle=(enabled:boolean):StyleSpecification=>({version:8,sources:{streets:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19}},layers:[{id:'paper',type:'background',paint:{'background-color':'#fafbf9'}},{id:'streets',type:'raster',source:'streets',paint:{'raster-opacity':enabled?.52:0,'raster-opacity-transition':{duration:0,delay:0},'raster-saturation':-1,'raster-contrast':.06,'raster-brightness-min':.12}}]});

// Keep this list exhaustive when MapItem gains another displayed field. Place
// records contain other data that the map does not use and may safely ignore.
const mapItemFields=Object.keys({id:true,lat:true,lng:true,name:true,title:true,type:true,score:true,timeLabel:true,eventState:true,locationProvider:true,campusBuildingId:true} satisfies Record<keyof MapItem,boolean>) as (keyof MapItem)[];
export function areCampusMapPropsEqual(previous:Props,next:Props):boolean {
 if(previous.onSelect!==next.onSelect||previous.onPosition!==next.onPosition||previous.onProviderChange!==next.onProviderChange||previous.selected!==next.selected||previous.confirm!==next.confirm||previous.requireGoogle!==next.requireGoogle||!Object.is(previous.initialPosition?.lat,next.initialPosition?.lat)||!Object.is(previous.initialPosition?.lng,next.initialPosition?.lng))return false;
 return previous.items===next.items||previous.items.length===next.items.length&&previous.items.every((item,index)=>mapItemFields.every(field=>Object.is(item[field],next.items[index][field])));
}

function CampusMap(props:Props){
 const {items,selected,confirm=false,initialPosition,requireGoogle=false}=props;
 const container=useRef<HTMLDivElement>(null),mapRef=useRef<GLMap|null>(null),callbacks=useRef(props);callbacks.current=props;
 const overlayRefs=useRef(new Map<string,MapOverlay>());
 const groupLayoutRef=useRef<OverlayGroupLayout<MapItem>|null>(null);
 const registerOverlay=(key:string,point:MapPosition)=>(element:HTMLButtonElement|null)=>{if(element)overlayRefs.current.set(key,{element,point});else overlayRefs.current.delete(key)};
 // Parent updates can change contents while the camera is moving. Correct their
 // initial positions before paint as well as on the map's own render frame.
 useLayoutEffect(()=>{if(mapRef.current)positionMapOverlays(mapRef.current,overlayRefs.current.values())});
 const [ready,setReady]=useState(false),[fallback,setFallback]=useState(false),[revision,setRevision]=useState(0),[threeD,setThreeD]=useState(!confirm),[labels,setLabels]=useState(true);
 const [provider,setProvider]=useState<MapProvider>(requireGoogle?'unavailable':'openstreetmap'),[connection,setConnection]=useState<'checking'|'google'|'openstreetmap'>('checking'),[session,setSession]=useState(''),[copyright,setCopyright]=useState('');
 const [geometry,setGeometry]=useState<CampusGeometry>(emptyGeometry),[directory,setDirectory]=useState<CampusDirectory>(emptyDirectory),[dataError,setDataError]=useState('');
 const [flatFocus,setFlatFocus]=useState<{position:MapPosition;zoom:number}>();
 const [footprintIndex,setFootprintIndex]=useState<CampusFootprintIndex>({buildings:[]});
 const [audit,setAudit]=useState<CampusAudit>({unmatchedBuildings:[]}),[coverageFilter,setCoverageFilter]=useState<'all'|'mapped'|'unmapped'>('all');
 const [campus,setCampus]=useState<keyof typeof CAMPUS_VIEWS>('bloomsbury'),[directoryOpen,setDirectoryOpen]=useState(false),[buildingQuery,setBuildingQuery]=useState(''),[directoryCampus,setDirectoryCampus]=useState('all'),[activeBuilding,setActiveBuilding]=useState<CampusBuilding|null>(null),[pinGroup,setPinGroup]=useState<MapItem[]|null>(null),[showInfo,setShowInfo]=useState(false);
 const buildings=useMemo(()=>mapBuildings(directory,geometry,footprintIndex),[directory,geometry,footprintIndex]);
 const mappedIds=useMemo(()=>new Set(geometry.features.filter(feature=>!feature.properties.isOutline).map(feature=>feature.properties.buildingId)),[geometry]);
 const mappedCount=buildings.filter(building=>mappedIds.has(building.id)).length;
 const gapReasons=useMemo(()=>new Map(audit.unmatchedBuildings.map(building=>[building.buildingId,building.reason])),[audit]);
 const buildingRef=useRef(buildings);buildingRef.current=buildings;

 useEffect(()=>{
  const controller=new AbortController();
  if(!confirm) Promise.all([json<CampusGeometry>('/data/campus-buildings.geojson',controller.signal),json<CampusDirectory>('/data/campus-directory.json',controller.signal),json<CampusFootprintIndex>('/data/campus-footprint-index.json',controller.signal)]).then(([footprints,catalog,index])=>{setGeometry(prepareCampusGeometry(footprints));setDirectory(catalog);setFootprintIndex(index)}).catch(error=>{if(error.name!=='AbortError')setDataError('The building directory could not load. Refresh to try again.')});
  if(!confirm) json<CampusAudit>('/data/campus-building-quality.json',controller.signal).then(setAudit).catch(()=>{/* The map remains usable if the optional coverage report is unavailable. */});
  (async()=>{try{const result=await json<{provider:string}>('/api/map/provider',controller.signal);if(result.provider==='google'){const token=await json<{session:string}>('/api/map/session',controller.signal);if(!token.session)throw new Error('No map session');setSession(token.session);setConnection('google')}else setConnection('openstreetmap')}catch(error){if((error as Error).name!=='AbortError')setConnection('openstreetmap')}})();
  return()=>controller.abort();
 },[confirm]);

 useEffect(()=>{
  if(!container.current||fallback)return;
  let disposed=false,map:GLMap|undefined,observer:ResizeObserver|undefined;
  (async()=>{
   try{
    const gl=await import('maplibre-gl');if(disposed||!container.current)return;
    // Served unchanged from the installed package, including its licence.
    gl.setWorkerUrl(`/vendor/maplibre-worker-${gl.getVersion()}.mjs`);
    const start=valid(initialPosition)?[initialPosition!.lng,initialPosition!.lat] as [number,number]:CAMPUS_VIEWS.bloomsbury.center;
    map=new gl.Map({container:container.current,style:osmStyle(!requireGoogle),center:start,zoom:confirm?17:16.65,pitch:confirm?0:42,bearing:0,minZoom:10,maxZoom:20,maxPitch:60,attributionControl:false,renderWorldCopies:false,canvasContextAttributes:{antialias:true},dragRotate:!confirm,touchPitch:!confirm,fadeDuration:100});
    mapRef.current=map;
    map.getCanvas().setAttribute('aria-label',confirm?'Confirm location: drag the map or use arrow keys':'UCL campus map: drag to pan, scroll or pinch to zoom, right-drag to rotate');
    // Keep marker anchors fixed throughout a gesture. Rebuilding collision groups
    // during a drag changes their representative place and makes bubbles slide.
    // Their positions update synchronously with the canvas, outside React state.
    const update=()=>{if(!disposed)setRevision(value=>value+1)};
    map.on('render',()=>{if(!disposed&&map)positionMapOverlays(map,overlayRefs.current.values())});
    map.on('resize',update);
    map.on('moveend',()=>{update();if(confirm){const center=map!.getCenter();callbacks.current.onPosition?.({lat:center.lat,lng:center.lng})}});
    map.on('load',()=>{if(!disposed){setReady(true);update()}});
    map.on('error',event=>{if(/WebGL|context|GPU/i.test(event.error.message)&&!disposed)setFallback(true)});
    map.on('click',event=>{
      if(confirm||!map?.getLayer('campus-buildings'))return;
      const id=map.queryRenderedFeatures(event.point,{layers:['campus-buildings','campus-ground']})[0]?.properties?.buildingId;
      setActiveBuilding(id?buildingRef.current.find(item=>item.id===id)||null:null);setPinGroup(null);
    });
    map.on('mousemove',event=>{if(map)updateBuildingHover(map,[event.point.x,event.point.y])});
    observer=new ResizeObserver(()=>map?.resize());observer.observe(container.current);
   }catch{if(!disposed)setFallback(true)}
  })();
  return()=>{disposed=true;observer?.disconnect();map?.remove();mapRef.current=null;overlayRefs.current.clear()};
 // Form coordinate changes update the existing map in the effect below.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[confirm,fallback]);
 useEffect(()=>{const map=mapRef.current;if(!ready||!map||!valid(initialPosition))return;const current=map.getCenter();if(Math.abs(current.lat-initialPosition!.lat)>1e-7||Math.abs(current.lng-initialPosition!.lng)>1e-7)map.jumpTo({center:[initialPosition!.lng,initialPosition!.lat]})},[initialPosition?.lat,initialPosition?.lng,ready]);

 useEffect(()=>{
  const map=mapRef.current;if(!ready||!map||confirm)return;
  if(!map.getSource('campus')){
   map.addSource('campus',{type:'geojson',data:geometry});
   map.addLayer({id:'campus-ground',type:'fill',source:'campus',paint:{'fill-color':'#d5c7e7','fill-opacity':.8,'fill-outline-color':'#a88ec2'}});
   map.addLayer({id:'campus-buildings',type:'fill-extrusion',source:'campus',minzoom:14,filter:['!=',['get','isOutline'],true],paint:{'fill-extrusion-color':'#c6b5de','fill-extrusion-height':['get','renderHeight'],'fill-extrusion-base':['get','renderBase'],'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':true}});
   map.setLight({anchor:'viewport',color:'#ffffff',intensity:.38,position:[1.2,200,40]});
  }else (map.getSource('campus') as GeoJSONSource).setData(geometry);
 },[geometry,ready,confirm]);
 useEffect(()=>{const map=mapRef.current;if(!map?.getLayer('campus-buildings'))return;map.setPaintProperty('campus-buildings','fill-extrusion-color',['case',['==',['get','buildingId'],activeBuilding?.id||''],'#ad91ce','#c6b5de']);map.setPaintProperty('campus-ground','fill-color',['case',['==',['get','buildingId'],activeBuilding?.id||''],'#bea7d8','#d5c7e7'])},[activeBuilding,ready,geometry]);
 useEffect(()=>{const map=mapRef.current;if(!ready||!map)return;if(map.getLayer('campus-buildings'))map.setLayoutProperty('campus-buildings','visibility',threeD?'visible':'none');map.easeTo({pitch:threeD?42:0,bearing:threeD?map.getBearing():0,duration:450})},[threeD,ready,geometry]);

 useEffect(()=>{
  const map=mapRef.current;if(!ready||!map||fallback)return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,coverage:Coverage|null=null;
  const publish=(next:MapProvider)=>{if(!cancelled)setProvider(next)};
  const opacity=(layer:string,value:number)=>{if(map.getPaintProperty(layer,'raster-opacity')!==value)map.setPaintProperty(layer,'raster-opacity',value)};
  if(connection!=='google'||!session){opacity('streets',requireGoogle?0:.52);publish(requireGoogle?'unavailable':'openstreetmap');return;}
  if(map.getLayer('google-streets'))map.removeLayer('google-streets');if(map.getSource('google-streets'))map.removeSource('google-streets');
  map.addSource('google-streets',{type:'raster',tiles:[`${window.location.origin}/api/map/tile/{z}/{x}/{y}?session=${encodeURIComponent(session)}`],tileSize:256,maxzoom:22});
  map.addLayer({id:'google-streets',type:'raster',source:'google-streets',paint:{'raster-opacity':0,'raster-opacity-transition':{duration:0,delay:0},'raster-fade-duration':0}},map.getLayer('campus-ground')?'campus-ground':undefined);
  // Pitched raster maps can show several tile levels. Attribute each actual level.
  const tileZooms=()=>[...new Set(map.coveringTiles({tileSize:256,minzoom:0,maxzoom:22,roundZoom:true}).map(tile=>tile.canonical.z))];
  const covered=()=>{const b=map.getBounds(),zooms=tileZooms();return Boolean(coverage&&zooms.length&&zooms.every(zoom=>coverage!.zooms.includes(zoom))&&b.getNorth()<=coverage.north&&b.getSouth()>=coverage.south&&b.getWest()>=coverage.west&&b.getEast()<=coverage.east)};
  const update=()=>{
   if(cancelled)return;
   if(covered()){const loaded=map.isSourceLoaded('google-streets');opacity('google-streets',loaded?1:0);opacity('streets',loaded||requireGoogle?0:.52);publish(loaded?'google':requireGoogle?'unavailable':'openstreetmap');return;}
   opacity('google-streets',0);opacity('streets',requireGoogle?0:.52);publish(requireGoogle?'unavailable':'openstreetmap');clearTimeout(timer);controller?.abort();
   timer=setTimeout(async()=>{
    const b=map.getBounds(),dy=(b.getNorth()-b.getSouth())*.7,dx=(b.getEast()-b.getWest())*.7;
    const next={north:Math.min(85,b.getNorth()+dy),south:Math.max(-85,b.getSouth()-dy),east:Math.min(179.9,b.getEast()+dx),west:Math.max(-179.9,b.getWest()-dx)},zooms=tileZooms();controller=new AbortController();
    try{if(!zooms.length)return;const responses=await Promise.all(zooms.map(zoom=>{const query=new URLSearchParams({session,zoom:String(zoom),...Object.fromEntries(Object.entries(next).map(([key,value])=>[key,String(value)]))});return json<{copyright:string}>(`/api/map/viewport?${query}`,controller!.signal)}));if(cancelled)return;if(responses.some(response=>!response.copyright))throw new Error('Missing attribution');const credit=[...new Set(responses.map(response=>response.copyright))].join(' · ');coverage={...next,zooms,copyright:credit};setCopyright(credit);update()}
    catch(error){if(!cancelled&&(error as Error).name!=='AbortError')setConnection('openstreetmap')}
   },150);
  };
  const tileError=(event:MapErrorEvent)=>{if((event as MapErrorEvent&{sourceId?:string}).sourceId==='google-streets')setConnection('openstreetmap')};
  map.on('move',update);map.on('resize',update);map.on('idle',update);map.on('error',tileError);update();
  return()=>{cancelled=true;clearTimeout(timer);controller?.abort();map.off('move',update);map.off('resize',update);map.off('idle',update);map.off('error',tileError);if(map.getLayer('google-streets'))opacity('google-streets',0)};
 },[connection,session,ready,requireGoogle,fallback]);
 useEffect(()=>{if(!fallback)callbacks.current.onProviderChange?.(provider)},[provider,fallback]);

 function focusBuilding(building:CampusBuilding){
  setActiveBuilding(building);setPinGroup(null);setDirectoryOpen(false);
  if(building.coordinates){setCampus(building.campus==='east'?'east':building.campus==='bloomsbury'?'bloomsbury':'london');setFlatFocus({position:building.coordinates,zoom:17});}
  const map=mapRef.current;if(!map)return;
  const bounds=geometryBounds(geometry,building.id);
  if(bounds){
   const canvas=map.getContainer(),wide=canvas.clientWidth>680;
   const padding=wide?{top:85,bottom:Math.min(145,canvas.clientHeight*.25),left:360,right:65}:{top:75,bottom:Math.min(390,canvas.clientHeight*.62),left:35,right:55};
   map.fitBounds(bounds,{padding,maxZoom:18,duration:800});
  }else if(building.coordinates)map.flyTo({center:[building.coordinates.lng,building.coordinates.lat],zoom:17,pitch:threeD?42:0,duration:850});
 }
 function changeCampus(next:keyof typeof CAMPUS_VIEWS){
  setCampus(next);setActiveBuilding(null);setPinGroup(null);
  const view=CAMPUS_VIEWS[next],map=mapRef.current;setFlatFocus({position:{lng:view.center[0],lat:view.center[1]},zoom:view.zoom});if(!map)return;
  if(next==='east'){
   const extents=buildings.filter(building=>building.campus==='east').map(building=>geometryBounds(geometry,building.id)).filter((value):value is [[number,number],[number,number]]=>Boolean(value));
   if(extents.length){map.fitBounds([[Math.min(...extents.map(b=>b[0][0])),Math.min(...extents.map(b=>b[0][1]))],[Math.max(...extents.map(b=>b[1][0])),Math.max(...extents.map(b=>b[1][1]))]],{padding:{top:105,bottom:Math.min(170,map.getContainer().clientHeight*.25),left:40,right:60},maxZoom:16.5,pitch:threeD?42:0,duration:900});return;}
  }
  map.flyTo({center:view.center,zoom:view.zoom,pitch:threeD&&next!=='london'?42:0,duration:900});
 }
 const map=mapRef.current,bounds=map?.getBounds(),width=container.current?.clientWidth||0,height=container.current?.clientHeight||0;
 // Keep off-screen markers mounted so a pan reveals them in that very frame.
 // The map container clips them; no React render is needed to enter the viewport.
 const projected=!fallback&&ready&&map&&!confirm?items.filter(item=>valid(item)&&(item.locationProvider!=='google'||provider==='google')).map(item=>{const p=map.project([item.lng,item.lat]);return {item,x:p.x,y:p.y}}):[];
 const groupLayout=layoutOverlayGroups(projected,groupLayoutRef.current,Boolean(map?.isMoving()),{zoom:map?.getZoom()??16.65,selected});groupLayoutRef.current=groupLayout;
 const groups=groupLayout.groups;
 const labelCandidates=!fallback&&ready&&map&&labels&&!confirm&&map.getZoom()>=15.4?buildings.filter(building=>building.coordinates&&bounds?.contains([building.coordinates.lng,building.coordinates.lat])).map(building=>{const p=map.project([building.coordinates!.lng,building.coordinates!.lat]);return {building,x:p.x,y:p.y}}):[];
 const visibleLabels:typeof labelCandidates=[];
 for(const label of labelCandidates){if(label.y<90||label.y>height-130||label.x<40||label.x>width-40||visibleLabels.some(other=>Math.abs(other.x-label.x)<125&&Math.abs(other.y-label.y)<46)||groups.some(pin=>Math.abs(pin.x-label.x)<55&&Math.abs(pin.y-label.y)<30))continue;visibleLabels.push(label);if(visibleLabels.length>=18)break;}
 const searchResults=searchBuildings(buildings,buildingQuery,directoryCampus).filter(building=>coverageFilter==='all'||mappedIds.has(building.id)===(coverageFilter==='mapped')),currentFeature=geometry.features.find(feature=>feature.properties.buildingId===activeBuilding?.id&&!feature.properties.isOutline),zoom=map?.getZoom()||16.65;
 const visibleCount=buildings.filter(building=>mappedIds.has(building.id)&&building.coordinates&&bounds?.contains([building.coordinates.lng,building.coordinates.lat])).length;
 const buildingReviewPlaces=activeBuilding?placesInBuilding(activeBuilding.id):[];

 const currentPinGroup=(pinGroup||[]).flatMap(previous=>{const current=items.find(item=>item.id===previous.id);return current?[current]:[]});
 return <div className={`campus-map atlas ${confirm?'confirm-map':''} ${fallback?'atlas-fallback':''}`} style={{overflow:'clip'}} data-map-engine={fallback?'flat':'maplibre'} data-revision={revision}>
  <div ref={container} className="atlas-canvas">{fallback&&<FlatCampusMap {...props} focusView={flatFocus} directoryOverlay onRecenter={()=>changeCampus(campus)}/>}</div>
  {fallback&&!confirm&&<div className="atlas-fallback-note">2D map · 3D isn’t available in this browser</div>}
  {!fallback&&(!ready||requireGoogle&&provider!=='google')&&<div className="atlas-loading" role="status">{!ready||connection==='checking'||connection==='google'?'Loading the map…':'Google Maps is unavailable. Reset to a manual campus location to continue.'}</div>}
  {confirm?!fallback&&provider!=='unavailable'&&ready&&<div className="confirm-cross" aria-hidden="true"><MapPin fill="#e96548" size={42}/></div>:<>
   <div className="atlas-toolbar"><div className="atlas-location"><MapPin size={17}/><label><span>Explore UCL</span><select aria-label="Campus area" value={campus} onChange={e=>changeCampus(e.target.value as keyof typeof CAMPUS_VIEWS)}>{Object.entries(CAMPUS_VIEWS).map(([id,view])=><option key={id} value={id}>{view.name}</option>)}</select></label><ChevronDown size={13}/></div><button type="button" className="atlas-search-toggle" aria-label="Find a UCL building" aria-expanded={directoryOpen} onClick={()=>{setDirectoryOpen(value=>!value);setShowInfo(false)}}><Search size={17}/><span>Find a building</span></button></div>
   {directoryOpen&&<section className="atlas-directory" aria-label="UCL building directory">
    <div className="atlas-directory-head"><b>Know your campus.</b><button type="button" aria-label="Close building directory" onClick={()=>setDirectoryOpen(false)}><X size={17}/></button></div>
    <p className="atlas-coverage-summary">{mappedCount} of {buildings.length} listed locations have mapped footprints</p>
    <label className="atlas-building-search"><Search size={16}/><input autoFocus aria-label="Search UCL buildings" placeholder="Cruciform, Bartlett, halls…" value={buildingQuery} onChange={e=>setBuildingQuery(e.target.value)}/></label>
    <div className="atlas-coverage-filter" role="group" aria-label="Filter footprint coverage">{(['all','mapped','unmapped'] as const).map(value=><button type="button" key={value} aria-pressed={coverageFilter===value} onClick={()=>setCoverageFilter(value)}>{value==='all'?'All locations':value==='mapped'?'Mapped':'Not yet mapped'}</button>)}</div>
    <div className="atlas-directory-filter"><span>{searchResults.length} locations</span><select aria-label="Filter building campus" value={directoryCampus} onChange={e=>setDirectoryCampus(e.target.value)}><option value="all">All UCL locations</option><option value="bloomsbury">Bloomsbury</option><option value="east">UCL East</option><option value="other">Other locations</option></select></div>
    <div className="atlas-directory-results">{searchResults.map(building=><button type="button" key={building.id} onClick={()=>focusBuilding(building)}><span className="atlas-building-icon"><Building2 size={16}/></span><span><b>{building.name}</b><small>{building.address||building.use||'Listed by UCL'}</small>{building.membership?.status==='ucl-partner'&&<small>Partner residence{building.accommodation?.operator?` · ${building.accommodation.operator}`:''}</small>}{!mappedIds.has(building.id)&&<em>Footprint not yet mapped</em>}</span><ChevronDown size={13} className="atlas-go"/></button>)}{!searchResults.length&&<p>No UCL locations match these filters.</p>}</div>
    <p className="atlas-directory-credit">UCL buildings and verified partner residences. A listing does not mean public access. Coverage is still being expanded.</p>
   </section>}
   {visibleLabels.map(({building,x,y})=><button type="button" className={`atlas-building-label ${activeBuilding?.id===building.id?'active':''}`} key={building.id} ref={registerOverlay(`label:${building.id}`,building.coordinates!)} data-map-overlay="label" style={mapOverlayPosition(x,y)} onClick={()=>focusBuilding(building)} aria-label={`About ${building.name}`}>{building.name}</button>)}
   {groups.map(group=>{const first=group.items[0],rated=!first.type||first.type==='rated',cluster=group.items.length>1,mixed=new Set(group.items.map(item=>item.type||'rated')).size>1,layer=mixed?'mixed':first.type||'rated',Icon=mixed?Layers:rated&&cluster?Building2:icons[layer]||Star,description=cluster?`${group.items.length} ${mixed?'events and finds':rated?'places to review':`${first.type} alerts`} nearby`:first.name||first.title;return <button type="button" key={group.items.map(item=>item.id).join('-')} className={`map-pin atlas-pin ${layer} ${group.items.every(item=>item.eventState==='upcoming')?'upcoming':group.items.some(item=>item.eventState==='live')?'live':''} ${first.id===selected?'selected':''}`} ref={registerOverlay(`pin:${group.items.map(item=>item.id).join('-')}`,first)} data-map-overlay="pin" data-map-layer={layer} style={{...mapOverlayPosition(group.x,group.y),transitionProperty:'background-color,box-shadow',transformOrigin:'center bottom',zIndex:first.id===selected?7:rated?4:5}} aria-label={cluster?description:`View ${description}`} aria-pressed={first.id===selected} onClick={()=>{setActiveBuilding(null);if(cluster)setPinGroup(group.items);else callbacks.current.onSelect(first.id)}}><Icon size={14}/>{first.timeLabel&&!cluster&&<span className="freebie-pin-time">{first.timeLabel}</span>}{rated&&<b>{cluster?group.items.length:first.score||'—'}</b>}{!rated&&cluster&&<span className="atlas-pin-count">{group.items.length}</span>}<span className="pin-tooltip">{description}</span></button>})}
   {currentPinGroup.length>0&&<section className="atlas-building-card" aria-label="Places at this location"><button type="button" className="atlas-card-close" aria-label="Close places" onClick={()=>setPinGroup(null)}><X size={17}/></button><p className="atlas-eyebrow">A little closer</p><h3>{currentPinGroup.length} spots here</h3><button type="button" className="atlas-show-gaps" onClick={()=>{const pins=currentPinGroup;setPinGroup(null);map?.fitBounds([[Math.min(...pins.map(pin=>pin.lng)),Math.min(...pins.map(pin=>pin.lat))],[Math.max(...pins.map(pin=>pin.lng)),Math.max(...pins.map(pin=>pin.lat))]],{padding:90,maxZoom:19,duration:500})}}>Zoom into these places →</button><div className="atlas-group-list">{currentPinGroup.map(item=>{const Icon=icons[item.type||'rated']||Star;return <button type="button" key={item.id} onClick={()=>{setPinGroup(null);callbacks.current.onSelect(item.id)}}><Icon size={14} aria-hidden="true"/><span>{item.name||item.title}</span><b>{item.score||'View'} →</b></button>})}</div></section>}
   {activeBuilding&&<section className="atlas-building-card" aria-label={`${activeBuilding.name} building information`}><button type="button" className="atlas-card-close" aria-label="Close building information" onClick={()=>setActiveBuilding(null)}><X size={17}/></button><p className="atlas-eyebrow"><Building2 size={12}/> UCL building directory</p><h3>{activeBuilding.name}</h3><p>{activeBuilding.address}</p>{activeBuilding.use&&<p>{activeBuilding.use}</p>}<div className="atlas-building-tags"><span>{activeBuilding.campus==='east'?'UCL East':activeBuilding.campus==='bloomsbury'?'Bloomsbury':'UCL location'}</span>{currentFeature?<span>Mapped footprint</span>:<span>Footprint not yet mapped</span>}{activeBuilding.membership?.status==='ucl-partner'&&<span>Partner residence</span>}</div>{activeBuilding.membership?.status==='ucl-partner'?<p className="atlas-source-note">Partner residence{activeBuilding.accommodation?.operator?` operated by ${activeBuilding.accommodation.operator}`:''}, listed by UCL Accommodation. This does not imply UCL owns or occupies the whole building.</p>:activeBuilding.membership?.scope&&<p className="atlas-source-note">{occupation[activeBuilding.membership.scope]||activeBuilding.membership.scope}</p>}{buildingReviewPlaces.length>0&&<div className="atlas-group-list">{buildingReviewPlaces.map(place=><button type="button" key={place.id} onClick={()=>{setActiveBuilding(null);callbacks.current.onSelect(place.id)}}><span>{place.name}<small>{place.parentPlaceId?'Room or space reviews':'Building reviews and discussion'}</small></span><b>{items.find(item=>item.id===place.id)?.score||'View'} →</b></button>)}</div>}<div className="atlas-source-links">{activeBuilding.officialSourceUrls?.filter(isSafeSource).slice(0,1).map(url=><a key={url} href={url} target="_blank" rel="noreferrer">UCL information <ExternalLink size={12}/></a>)}{isSafeSource(currentFeature?.properties.sourceUrl)&&<a href={currentFeature!.properties.sourceUrl} target="_blank" rel="noreferrer">Footprint source <ExternalLink size={12}/></a>}</div>{currentFeature&&<p className="atlas-source-note">3D height: {String(currentFeature.properties.visualHeightStatus||'illustrative estimate').replaceAll('-',' ')}. Building positions do not indicate an entrance.</p>}{!currentFeature&&<p className="atlas-coverage-gap">{gapReasons.get(activeBuilding.id)||'The address is listed by UCL; a building footprint has not yet been verified.'}</p>}</section>}
   <div className="atlas-legend"><span><i/>Campus footprint</span><b>{fallback?`${mappedCount} mapped locations`:`${visibleCount} nearby buildings`}</b><button type="button" aria-label="About the campus map data" onClick={()=>{setShowInfo(value=>!value);setDirectoryOpen(false)}}><Info size={14}/></button></div>
   {showInfo&&<section className="atlas-info"><b>{mappedCount} of {buildings.length} locations mapped</b><p>Review bubbles show places with ratings at campus scale. Zoom in for unrated places, or choose any building through the map, directory or results list. Grouped bubbles show a building icon and a count of places, not a rating.</p><p>Includes UCL buildings and partner residences in the published directory. OpenStreetMap supplies the outlines and building sections. Courtyards stay open; neighbouring buildings stay flat.</p><p>Some listed addresses still need a verified footprint. Heights use mapped values or estimates; this is not a measured architectural model.</p><button type="button" className="atlas-show-gaps" onClick={()=>{setCoverageFilter('unmapped');setDirectoryCampus('all');setBuildingQuery('');setShowInfo(false);setDirectoryOpen(true)}}>See {buildings.length-mappedCount} unmapped locations →</button><a href="https://www.ucl.ac.uk/estates/our-services/area-facilities-management" target="_blank" rel="noreferrer">UCL Estates building list ↗</a>{directory.datasetDate&&<small>Source check: {directory.datasetDate}</small>}</section>}
   {dataError&&<div className="atlas-data-error" role="status">{dataError}</div>}
  </>}
  {!fallback&&<div className="map-controls atlas-controls">
   {!confirm&&<button type="button" aria-label="Raised campus buildings" title={threeD?'Switch to flat map':'Raise UCL buildings'} aria-pressed={threeD} onClick={()=>setThreeD(value=>!value)} className={threeD?'active':''}>{threeD?'3D':'2D'}</button>}
   {!confirm&&<button type="button" aria-label="Building labels" title="Toggle building names" aria-pressed={labels} onClick={()=>setLabels(value=>!value)}><Layers size={17}/></button>}
   <button type="button" aria-label="Zoom in" disabled={zoom>=20} onClick={()=>map?.zoomIn()}><Plus size={19}/></button><button type="button" aria-label="Zoom out" disabled={zoom<=10} onClick={()=>map?.zoomOut()}><Minus size={19}/></button>
   {!confirm&&<button type="button" aria-label="Point map north" title="Reset rotation" onClick={()=>map?.easeTo({bearing:0,duration:350})}><Compass size={18} style={{transform:`rotate(${-(map?.getBearing()||0)}deg)`}}/></button>}
   <button type="button" aria-label="Back to UCL" onClick={()=>confirm?map?.easeTo({center:CAMPUS_VIEWS.bloomsbury.center,zoom:17,pitch:0}):changeCampus(campus)}><LocateFixed size={18}/></button>
  </div>}
  {!fallback&&<div className="map-attribution atlas-attribution">{provider==='google'?<><b>Google Maps</b> · {copyright}</>:(!requireGoogle&&<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>)}{!confirm&&<> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Campus footprint data © OSM</a><span> · 3D heights are indicative</span></>}</div>}
 </div>;
}

export default memo(CampusMap,areCampusMapPropsEqual);
