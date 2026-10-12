import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

export type CampusProperties = {
  buildingId?: string; name?: string; campus?: string; affiliationVerified?: boolean;
  sourceUrl?: string; affiliationSourceUrl?: string; geometrySourceDate?: string;
  height?: number | null; heightMeters?: number | null; heightStatus?: string;
  minHeight?: number | null; min_height?: number | null; levels?: number | null;
  visualHeight?: number; visualMinHeight?: number; visualHeightStatus?: string; role?: string; geometryRole?: string; [key: string]: unknown;
};
export type CampusGeometry = FeatureCollection<Polygon | MultiPolygon, CampusProperties>;
export type CampusBuilding = {
  id: string; name: string; officialName?: string; aliases?: string[]; address?: string;
  campus: string; type?: string; use?: string; officialSourceUrls?: string[];
  coordinates?: {lat: number; lng: number; sourceUrl?: string} | null;
  membership?: {status?: string; scope?: string; evidence?: unknown};
  accommodation?: {current: boolean; academicYear?: string; operator?: string | null; relationship?: string};
};
export type CampusDirectory = {datasetDate: string; buildings: CampusBuilding[]; primaryReferences?: unknown[]};
export type CampusFootprintIndex = {buildings: {buildingId: string; coordinates?: CampusBuilding['coordinates']}[]};
export const CAMPUS_VIEWS = {
  bloomsbury: {name:'Bloomsbury',center:[-0.1342,51.5247] as [number,number],zoom:16.65},
  east: {name:'UCL East',center:[-0.0115,51.5380] as [number,number],zoom:16.0},
  london: {name:'Across London',center:[-0.09,51.525] as [number,number],zoom:11.7},
};

/** Keep exact rings/parts. Membership is an evidence-backed property, not a box. */
export function prepareCampusGeometry(data: CampusGeometry): CampusGeometry {
  return {type:'FeatureCollection',features:data.features.filter(feature =>
    feature.properties?.affiliationVerified === true && ['Polygon','MultiPolygon'].includes(feature.geometry?.type)
  ).map((feature,index) => {
    const p=feature.properties;
    const number=(value: unknown): number|undefined => {
      if(value == null || typeof value==='boolean' || typeof value==='string'&&!value.trim()) return undefined;
      const parsed=Number(value); return Number.isFinite(parsed)?parsed:undefined;
    };
    const positive=(values: unknown[])=>values.map(number).find(value=>value!==undefined&&value>0);
    const actual=positive([p.height,p.heightMeters]);
    const levels=positive([p.levels]);
    const visual=positive([p.visualHeight,levels===undefined?undefined:levels*3])??12;
    const height=Math.max(2,Math.min(180,actual??visual));
    const base=[p.minHeight,p.min_height,p.visualMinHeight].map(number).find(value=>value!==undefined)??0;
    return {...feature,id:index,properties:{...p,renderHeight:height,renderBase:Math.max(0,Math.min(base,height-1)),isOutline:p.role==='outline'||p.geometryRole==='outline'}};
  })};
}

export function geometryBounds(data: CampusGeometry, buildingId: string): [[number,number],[number,number]] | null {
  let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
  for(const feature of data.features) {
    if(feature.properties.buildingId!==buildingId) continue;
    const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    for(const polygon of polygons) for(const ring of polygon) for(const [lng,lat] of ring) {
      west=Math.min(west,lng);east=Math.max(east,lng);south=Math.min(south,lat);north=Math.max(north,lat);
    }
  }
  return Number.isFinite(west)?[[west,south],[east,north]]:null;
}

export function mapBuildings(directory: CampusDirectory, data: CampusGeometry, index?: CampusFootprintIndex): CampusBuilding[] {
  const byId=new Map(directory.buildings.map(building=>[building.id,{...building}]));
  const labelPoints=new Map((index?.buildings??[]).filter(building=>{
    const point=building.coordinates;
    return point&&Number.isFinite(point.lat)&&Number.isFinite(point.lng)&&Math.abs(point.lat)<=85&&Math.abs(point.lng)<=180;
  }).map(building=>[building.buildingId,building.coordinates!]));
  for(const feature of data.features) {
    if(feature.properties.affiliationVerified!==true) continue;
    const id=feature.properties.buildingId;
    if(!id) continue;
    if(!byId.has(id)) byId.set(id,{id,name:feature.properties.name||'UCL building',campus:feature.properties.campus||'bloomsbury',officialSourceUrls:feature.properties.affiliationSourceUrl?[feature.properties.affiliationSourceUrl]:[]});
    const building=byId.get(id)!;
    if(!building.coordinates) {
      const labelPoint=labelPoints.get(id);
      if(labelPoint) building.coordinates={...labelPoint};
      else {
        const bounds=geometryBounds(data,id);
        if(bounds) building.coordinates={lng:(bounds[0][0]+bounds[1][0])/2,lat:(bounds[0][1]+bounds[1][1])/2,sourceUrl:feature.properties.sourceUrl};
      }
    }
  }
  return [...byId.values()];
}

export function searchBuildings(buildings: CampusBuilding[], query: string, campus='all') {
  const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return buildings.filter(building=>(campus==='all'||building.campus===campus)&&words.every(word=>[building.name,building.officialName,building.address,...(building.aliases||[])].join(' ').toLowerCase().includes(word)))
    .sort((a,b)=>Number(Boolean(b.coordinates))-Number(Boolean(a.coordinates))||a.name.localeCompare(b.name));
}

export type ScreenPin<T> = {x:number;y:number;item:T};
/** Collision groups preserve every item; selection opens the group's exact list. */
export function groupScreenPins<T>(pins: ScreenPin<T>[], radius=35): {x:number;y:number;items:T[]}[] {
  const groups:{x:number;y:number;items:T[]}[]=[];
  for(const pin of pins) {
    const group=groups.find(group=>Math.hypot(group.x-pin.x,group.y-pin.y)<radius);
    if(group) group.items.push(pin.item);
    else groups.push({x:pin.x,y:pin.y,items:[pin.item]});
  }
  return groups;
}

export function isSafeSource(url?: string) {
  if(!url) return false;
  try {const parsed=new URL(url);return parsed.protocol==='https:'&&(/(^|\.)ucl\.ac\.uk$/.test(parsed.hostname)||/(^|\.)openstreetmap\.org$/.test(parsed.hostname));}catch{return false;}
}
