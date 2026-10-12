'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {Map as GLMap,GeoJSONSource,StyleSpecification,ErrorEvent as MapErrorEvent} from 'maplibre-gl';
import {MapPin,Plus,Minus,LocateFixed,Star,Gift,Utensils,Tag,Search,X,Building2,ChevronDown,ExternalLink,Compass,Layers,Info} from 'lucide-react';
import FlatCampusMap from './campus-flat-map';
import {CAMPUS_VIEWS,prepareCampusGeometry,mapBuildings,geometryBounds,searchBuildings,groupScreenPins,isSafeSource,type CampusBuilding,type CampusDirectory,type CampusGeometry,type CampusFootprintIndex} from '@/lib/campus-map-model';

export type MapPosition={lat:number;lng:number};
export type MapProvider='google'|'openstreetmap'|'unavailable';
export type MapItem=MapPosition & {id:string;name?:string;title?:string;type?:string;score?:string;campusBuildingId?:string};
type Props={items:MapItem[];onSelect:(id:string)=>void;selected?:string;confirm?:boolean;initialPosition?:MapPosition;requireGoogle?:boolean;onPosition?:(position:MapPosition)=>void;onProviderChange?:(provider:MapProvider)=>void};
type Coverage={north:number;south:number;east:number;west:number;zooms:number[];copyright:string};
const icons:Record<string,typeof Star>={rated:Star,food:Utensils,freebie:Gift,deal:Tag};
const occupation:Record<string,string>={'building':'Listed by UCL as a campus building.','facility':'UCL facility; access may be restricted.','part-of-building':'UCL uses part of this building.','shared-site':'Shared site; UCL is one of the users.','unconfirmed-extent':'UCL use is confirmed; the extent of occupation is not.'};
const emptyGeometry:CampusGeometry={type:'FeatureCollection',features:[]};
const emptyDirectory:CampusDirectory={datasetDate:'',buildings:[]};
const valid=(point?:MapPosition)=>point&&Number.isFinite(point.lat)&&Number.isFinite(point.lng)&&Math.abs(point.lat)<85&&Math.abs(point.lng)<180;
async function json<T>(url:string,signal?:AbortSignal):Promise<T>{const response=await fetch(url,{signal});if(!response.ok)throw new Error('Map service unavailable');return await response.json() as T;}
const osmStyle=(enabled:boolean):StyleSpecification=>({version:8,sources:{streets:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19}},layers:[{id:'paper',type:'background',paint:{'background-color':'#fafbf9'}},{id:'streets',type:'raster',source:'streets',paint:{'raster-opacity':enabled?.52:0,'raster-opacity-transition':{duration:0,delay:0},'raster-saturation':-1,'raster-contrast':.06,'raster-brightness-min':.12}}]});

export default function CampusMap(props:Props){
 const {items,selected,confirm=false,initialPosition,requireGoogle=false}=props;
 const container=useRef<HTMLDivElement>(null),mapRef=useRef<GLMap|null>(null),callbacks=useRef(props);callbacks.current=props;
 const [ready,setReady]=useState(false),[fallback,setFallback]=useState(false),[revision,setRevision]=useState(0),[threeD,setThreeD]=useState(!confirm),[labels,setLabels]=useState(true);
 const [provider,setProvider]=useState<MapProvider>(requireGoogle?'unavailable':'openstreetmap'),[connection,setConnection]=useState<'checking'|'google'|'openstreetmap'>('checking'),[session,setSession]=useState(''),[copyright,setCopyright]=useState('');
 const [geometry,setGeometry]=useState<CampusGeometry>(emptyGeometry),[directory,setDirectory]=useState<CampusDirectory>(emptyDirectory),[dataError,setDataError]=useState('');
 const [footprintIndex,setFootprintIndex]=useState<CampusFootprintIndex>({buildings:[]});
 const [campus,setCampus]=useState<keyof typeof CAMPUS_VIEWS>('bloomsbury'),[directoryOpen,setDirectoryOpen]=useState(false),[buildingQuery,setBuildingQuery]=useState(''),[directoryCampus,setDirectoryCampus]=useState('all'),[activeBuilding,setActiveBuilding]=useState<CampusBuilding|null>(null),[pinGroup,setPinGroup]=useState<MapItem[]|null>(null),[showInfo,setShowInfo]=useState(false);
 const buildings=useMemo(()=>mapBuildings(directory,geometry,footprintIndex),[directory,geometry,footprintIndex]);
 const buildingRef=useRef(buildings);buildingRef.current=buildings;

 useEffect(()=>{
  const controller=new AbortController();
  if(!confirm) Promise.all([json<CampusGeometry>('/data/campus-buildings.geojson',controller.signal),json<CampusDirectory>('/data/campus-directory.json',controller.signal),json<CampusFootprintIndex>('/data/campus-footprint-index.json',controller.signal)]).then(([footprints,catalog,index])=>{setGeometry(prepareCampusGeometry(footprints));setDirectory(catalog);setFootprintIndex(index)}).catch(error=>{if(error.name!=='AbortError')setDataError('The building directory could not load. Refresh to try again.')});
  (async()=>{try{const result=await json<{provider:string}>('/api/map/provider',controller.signal);if(result.provider==='google'){const token=await json<{session:string}>('/api/map/session',controller.signal);if(!token.session)throw new Error('No map session');setSession(token.session);setConnection('google')}else setConnection('openstreetmap')}catch(error){if((error as Error).name!=='AbortError')setConnection('openstreetmap')}})();
  return()=>controller.abort();
 },[confirm]);

 useEffect(()=>{
  if(!container.current||fallback)return;
  let disposed=false,map:GLMap|undefined,observer:ResizeObserver|undefined,frame=0;
  (async()=>{
   try{
    const gl=await import('maplibre-gl');if(disposed||!container.current)return;
    // Served unchanged from the installed package, including its licence.
    gl.setWorkerUrl(`/vendor/maplibre-worker-${gl.getVersion()}.mjs`);
    const start=valid(initialPosition)?[initialPosition!.lng,initialPosition!.lat] as [number,number]:CAMPUS_VIEWS.bloomsbury.center;
    map=new gl.Map({container:container.current,style:osmStyle(!requireGoogle),center:start,zoom:confirm?17:16.65,pitch:confirm?0:42,bearing:0,minZoom:10,maxZoom:20,maxPitch:60,attributionControl:false,renderWorldCopies:false,canvasContextAttributes:{antialias:true},dragRotate:!confirm,touchPitch:!confirm,fadeDuration:100});
    mapRef.current=map;
    map.getCanvas().setAttribute('aria-label',confirm?'Confirm location: drag the map or use arrow keys':'UCL campus map: drag to pan, scroll or pinch to zoom, right-drag to rotate');
    const update=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;if(!disposed)setRevision(value=>value+1)})};
    map.on('move',update);map.on('resize',update);
    map.on('moveend',()=>{update();if(confirm){const center=map!.getCenter();callbacks.current.onPosition?.({lat:center.lat,lng:center.lng})}});
    map.on('load',()=>{if(!disposed){setReady(true);update()}});
    map.on('error',event=>{if(/WebGL|context|GPU/i.test(event.error.message)&&!disposed)setFallback(true)});
    map.on('click',event=>{
      if(confirm||!map?.getLayer('campus-buildings'))return;
      const id=map.queryRenderedFeatures(event.point,{layers:['campus-buildings','campus-ground']})[0]?.properties?.buildingId;
      setActiveBuilding(id?buildingRef.current.find(item=>item.id===id)||null:null);setPinGroup(null);
    });
    map.on('mousemove',event=>{if(map?.getLayer('campus-buildings'))map.getCanvas().style.cursor=map.queryRenderedFeatures(event.point,{layers:['campus-buildings','campus-ground']}).length?'pointer':''});
    observer=new ResizeObserver(()=>map?.resize());observer.observe(container.current);
   }catch{if(!disposed)setFallback(true)}
  })();
  return()=>{disposed=true;cancelAnimationFrame(frame);observer?.disconnect();map?.remove();mapRef.current=null};
 // Form coordinate changes update the existing map in the effect below.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[confirm,fallback]);
 useEffect(()=>{const map=mapRef.current;if(!ready||!map||!valid(initialPosition))return;const current=map.getCenter();if(Math.abs(current.lat-initialPosition!.lat)>1e-7||Math.abs(current.lng-initialPosition!.lng)>1e-7)map.jumpTo({center:[initialPosition!.lng,initialPosition!.lat]})},[initialPosition?.lat,initialPosition?.lng,ready]);

 useEffect(()=>{
  const map=mapRef.current;if(!ready||!map||confirm)return;
  if(!map.getSource('campus')){
   map.addSource('campus',{type:'geojson',data:geometry});
   map.addLayer({id:'campus-ground',type:'fill',source:'campus',paint:{'fill-color':'#e5ebe5','fill-opacity':.8,'fill-outline-color':'#a9b9ad'}});
   map.addLayer({id:'campus-buildings',type:'fill-extrusion',source:'campus',minzoom:14,filter:['!=',['get','isOutline'],true],paint:{'fill-extrusion-color':'#f5f5ed','fill-extrusion-height':['get','renderHeight'],'fill-extrusion-base':['get','renderBase'],'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':true}});
   map.setLight({anchor:'viewport',color:'#ffffff',intensity:.38,position:[1.2,200,40]});
  }else (map.getSource('campus') as GeoJSONSource).setData(geometry);
 },[geometry,ready,confirm]);
 useEffect(()=>{const map=mapRef.current;if(!map?.getLayer('campus-buildings'))return;map.setPaintProperty('campus-buildings','fill-extrusion-color',['case',['==',['get','buildingId'],activeBuilding?.id||''],'#efaf97','#f5f5ed']);map.setPaintProperty('campus-ground','fill-color',['case',['==',['get','buildingId'],activeBuilding?.id||''],'#f4ae91','#e5ebe5'])},[activeBuilding,ready,geometry]);
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
  const map=mapRef.current;if(!map)return;
  const bounds=geometryBounds(geometry,building.id);
  if(building.coordinates)setCampus(building.campus==='east'?'east':building.campus==='bloomsbury'?'bloomsbury':'london');
  if(bounds){
   const canvas=map.getContainer(),wide=canvas.clientWidth>680;
   const padding=wide?{top:85,bottom:Math.min(145,canvas.clientHeight*.25),left:360,right:65}:{top:75,bottom:Math.min(390,canvas.clientHeight*.62),left:35,right:55};
   map.fitBounds(bounds,{padding,maxZoom:18,duration:800});
  }else if(building.coordinates)map.flyTo({center:[building.coordinates.lng,building.coordinates.lat],zoom:17,pitch:threeD?42:0,duration:850});
 }
 function changeCampus(next:keyof typeof CAMPUS_VIEWS){
  setCampus(next);setActiveBuilding(null);setPinGroup(null);
  const view=CAMPUS_VIEWS[next],map=mapRef.current;if(!map)return;
  if(next==='east'){
   const extents=buildings.filter(building=>building.campus==='east').map(building=>geometryBounds(geometry,building.id)).filter((value):value is [[number,number],[number,number]]=>Boolean(value));
   if(extents.length){map.fitBounds([[Math.min(...extents.map(b=>b[0][0])),Math.min(...extents.map(b=>b[0][1]))],[Math.max(...extents.map(b=>b[1][0])),Math.max(...extents.map(b=>b[1][1]))]],{padding:{top:105,bottom:Math.min(170,map.getContainer().clientHeight*.25),left:40,right:60},maxZoom:16.5,pitch:threeD?42:0,duration:900});return;}
  }
  map.flyTo({center:view.center,zoom:view.zoom,pitch:threeD&&next!=='london'?42:0,duration:900});
 }
 const map=mapRef.current,bounds=map?.getBounds(),width=container.current?.clientWidth||0,height=container.current?.clientHeight||0;
 const projected=ready&&map&&!confirm?items.filter(item=>valid(item)&&bounds?.contains([item.lng,item.lat])).map(item=>{const p=map.project([item.lng,item.lat]);return {item,x:p.x,y:p.y}}):[];
 const groups=groupScreenPins(projected).filter(group=>group.x>-20&&group.y>0&&group.x<width+20&&group.y<height);
 const labelCandidates=ready&&map&&labels&&!confirm&&map.getZoom()>=15.4?buildings.filter(building=>building.coordinates&&bounds?.contains([building.coordinates.lng,building.coordinates.lat])).map(building=>{const p=map.project([building.coordinates!.lng,building.coordinates!.lat]);return {building,x:p.x,y:p.y}}):[];
 const visibleLabels:typeof labelCandidates=[];
 for(const label of labelCandidates){if(label.y<90||label.y>height-130||label.x<40||label.x>width-40||visibleLabels.some(other=>Math.abs(other.x-label.x)<125&&Math.abs(other.y-label.y)<46)||groups.some(pin=>Math.abs(pin.x-label.x)<55&&Math.abs(pin.y-label.y)<30))continue;visibleLabels.push(label);if(visibleLabels.length>=18)break;}
 const searchResults=searchBuildings(buildings,buildingQuery,directoryCampus),currentFeature=geometry.features.find(feature=>feature.properties.buildingId===activeBuilding?.id&&!feature.properties.isOutline),zoom=map?.getZoom()||16.65;
 const visibleCount=buildings.filter(building=>building.coordinates&&bounds?.contains([building.coordinates.lng,building.coordinates.lat])).length;

 if(fallback)return <div className="atlas-fallback"><FlatCampusMap {...props}/><div className="atlas-fallback-note">2D map · 3D isn’t available in this browser</div></div>;
 return <div className={`campus-map atlas ${confirm?'confirm-map':''}`} data-map-engine="maplibre" data-revision={revision}>
  <div ref={container} className="atlas-canvas"/>
  {(!ready||requireGoogle&&provider!=='google')&&<div className="atlas-loading" role="status">{!ready||connection==='checking'||connection==='google'?'Loading the map…':'Google Maps is unavailable. Reset to a manual campus location to continue.'}</div>}
  {confirm?provider!=='unavailable'&&ready&&<div className="confirm-cross" aria-hidden="true"><MapPin fill="#e96548" size={42}/></div>:<>
   <div className="atlas-toolbar"><div className="atlas-location"><MapPin size={17}/><label><span>Explore UCL</span><select aria-label="Campus area" value={campus} onChange={e=>changeCampus(e.target.value as keyof typeof CAMPUS_VIEWS)}>{Object.entries(CAMPUS_VIEWS).map(([id,view])=><option key={id} value={id}>{view.name}</option>)}</select></label><ChevronDown size={13}/></div><button type="button" className="atlas-search-toggle" aria-label="Find a UCL building" aria-expanded={directoryOpen} onClick={()=>{setDirectoryOpen(value=>!value);setShowInfo(false)}}><Search size={17}/><span>Find a building</span></button></div>
   {directoryOpen&&<section className="atlas-directory" aria-label="UCL building directory"><div className="atlas-directory-head"><b>Know your campus.</b><button type="button" aria-label="Close building directory" onClick={()=>setDirectoryOpen(false)}><X size={17}/></button></div><label className="atlas-building-search"><Search size={16}/><input autoFocus aria-label="Search UCL buildings" placeholder="Cruciform, Bartlett, halls…" value={buildingQuery} onChange={e=>setBuildingQuery(e.target.value)}/></label><div className="atlas-directory-filter"><span>{searchResults.length} locations</span><select aria-label="Filter building campus" value={directoryCampus} onChange={e=>setDirectoryCampus(e.target.value)}><option value="all">All UCL locations</option><option value="bloomsbury">Bloomsbury</option><option value="east">UCL East</option><option value="other">Other locations</option></select></div><div className="atlas-directory-results">{searchResults.map(building=><button type="button" key={building.id} onClick={()=>focusBuilding(building)}><span className="atlas-building-icon"><Building2 size={16}/></span><span><b>{building.name}</b><small>{building.address||building.use||'Listed by UCL'}</small>{!building.coordinates&&<em>Address listed · map position unconfirmed</em>}</span><ChevronDown size={13} className="atlas-go"/></button>)}{!searchResults.length&&<p>No UCL locations match this search.</p>}</div><p className="atlas-directory-credit">Checked against UCL’s official building sources. A listing does not mean public access.</p></section>}
   {visibleLabels.map(({building,x,y})=><button type="button" className={`atlas-building-label ${activeBuilding?.id===building.id?'active':''}`} key={building.id} style={{left:x,top:y}} onClick={()=>focusBuilding(building)} aria-label={`About ${building.name}`}>{building.name}</button>)}
   {groups.map(group=>{const first=group.items[0],Icon=icons[first.type||'rated']||Star;return <button type="button" key={group.items.map(item=>item.id).join('-')} className={`map-pin atlas-pin ${first.type||'rated'} ${group.items.some(item=>item.id===selected)?'selected':''}`} style={{left:group.x,top:group.y}} aria-label={group.items.length>1?`${group.items.length} places and alerts here`:`View ${first.name||first.title}`} aria-pressed={group.items.some(item=>item.id===selected)} onClick={()=>{setActiveBuilding(null);if(group.items.length>1)setPinGroup(group.items);else callbacks.current.onSelect(first.id)}}><Icon size={14}/>{!first.type&&<b>{first.score||'—'}</b>}{group.items.length>1&&<span className="atlas-pin-count">{group.items.length}</span>}<span className="pin-tooltip">{group.items.length>1?`${group.items.length} spots here`:first.name||first.title}</span></button>})}
   {pinGroup&&<section className="atlas-building-card" aria-label="Places at this location"><button type="button" className="atlas-card-close" aria-label="Close places" onClick={()=>setPinGroup(null)}><X size={17}/></button><p className="atlas-eyebrow">A little closer</p><h3>{pinGroup.length} spots here</h3><div className="atlas-group-list">{pinGroup.map(item=><button type="button" key={item.id} onClick={()=>{setPinGroup(null);callbacks.current.onSelect(item.id)}}><span>{item.name||item.title}</span><b>{item.score||'View'} →</b></button>)}</div></section>}
   {activeBuilding&&<section className="atlas-building-card" aria-label={`${activeBuilding.name} building information`}><button type="button" className="atlas-card-close" aria-label="Close building information" onClick={()=>setActiveBuilding(null)}><X size={17}/></button><p className="atlas-eyebrow"><Building2 size={12}/> UCL building directory</p><h3>{activeBuilding.name}</h3><p>{activeBuilding.address}</p>{activeBuilding.use&&<p>{activeBuilding.use}</p>}<div className="atlas-building-tags"><span>{activeBuilding.campus==='east'?'UCL East':activeBuilding.campus==='bloomsbury'?'Bloomsbury':'UCL location'}</span>{currentFeature&&<span>Mapped footprint</span>}</div>{activeBuilding.membership?.scope&&<p className="atlas-source-note">{occupation[activeBuilding.membership.scope]||activeBuilding.membership.scope}</p>}{items.some(item=>item.campusBuildingId===activeBuilding.id)&&<div className="atlas-group-list">{items.filter(item=>item.campusBuildingId===activeBuilding.id).map(item=><button type="button" key={item.id} onClick={()=>{setActiveBuilding(null);callbacks.current.onSelect(item.id)}}><span>{item.name||item.title}</span><b>{item.score} ★ →</b></button>)}</div>}<div className="atlas-source-links">{activeBuilding.officialSourceUrls?.filter(isSafeSource).slice(0,1).map(url=><a key={url} href={url} target="_blank" rel="noreferrer">UCL information <ExternalLink size={12}/></a>)}{isSafeSource(currentFeature?.properties.sourceUrl)&&<a href={currentFeature!.properties.sourceUrl} target="_blank" rel="noreferrer">Footprint source <ExternalLink size={12}/></a>}</div>{currentFeature&&<p className="atlas-source-note">3D height: {String(currentFeature.properties.visualHeightStatus||'illustrative estimate').replaceAll('-',' ')}. Building positions do not indicate an entrance.</p>}{!activeBuilding.coordinates&&<p className="atlas-source-note">Verified address; map position not yet confirmed.</p>}</section>}
   <div className="atlas-legend"><span><i/>UCL footprint</span><b>{visibleCount} nearby buildings</b><button type="button" aria-label="About the campus map data" onClick={()=>{setShowInfo(value=>!value);setDirectoryOpen(false)}}><Info size={14}/></button></div>
   {showInfo&&<section className="atlas-info"><b>Real outlines. Clear provenance.</b><p>Building use is checked against UCL’s published directory. Footprints and building sections come from OpenStreetMap. Courtyards stay open; neighbouring buildings stay flat.</p><p>Heights use mapped values or estimates. This is a campus guide, not a measured architectural model.</p><a href="https://www.ucl.ac.uk/estates/our-services/area-facilities-management" target="_blank" rel="noreferrer">UCL Estates building list ↗</a>{directory.datasetDate&&<small>Source check: {directory.datasetDate}</small>}</section>}
   {dataError&&<div className="atlas-data-error" role="status">{dataError}</div>}
  </>}
  <div className="map-controls atlas-controls">
   {!confirm&&<button type="button" aria-label="Raised campus buildings" title={threeD?'Switch to flat map':'Raise UCL buildings'} aria-pressed={threeD} onClick={()=>setThreeD(value=>!value)} className={threeD?'active':''}>{threeD?'3D':'2D'}</button>}
   {!confirm&&<button type="button" aria-label="Building labels" title="Toggle building names" aria-pressed={labels} onClick={()=>setLabels(value=>!value)}><Layers size={17}/></button>}
   <button type="button" aria-label="Zoom in" disabled={zoom>=20} onClick={()=>map?.zoomIn()}><Plus size={19}/></button><button type="button" aria-label="Zoom out" disabled={zoom<=10} onClick={()=>map?.zoomOut()}><Minus size={19}/></button>
   {!confirm&&<button type="button" aria-label="Point map north" title="Reset rotation" onClick={()=>map?.easeTo({bearing:0,duration:350})}><Compass size={18} style={{transform:`rotate(${-(map?.getBearing()||0)}deg)`}}/></button>}
   <button type="button" aria-label="Back to UCL" onClick={()=>confirm?map?.easeTo({center:CAMPUS_VIEWS.bloomsbury.center,zoom:17,pitch:0}):changeCampus(campus)}><LocateFixed size={18}/></button>
  </div>
  <div className="map-attribution atlas-attribution">{provider==='google'?<><b>Google Maps</b> · {copyright}</>:(!requireGoogle&&<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>)}{!confirm&&<> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">UCL footprint data © OSM</a><span> · 3D heights are indicative</span></>}</div>
 </div>;
}
