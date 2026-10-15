export type MapFocusRequest = {id:string;request:number};
type FocusItem = {id:string;lat:number;lng:number;locationProvider?:string};
type Provider = 'google'|'openstreetmap'|'unavailable';

// A focus request is consumed only after a matching, renderable item is ready.
// Provider/counter updates must not repeatedly pull the camera back after a pan.
export function mapFocusTarget<T extends FocusItem>(items:T[],focus:MapFocusRequest|undefined,previous:MapFocusRequest|undefined,provider:Provider):T|undefined {
  if(!focus||previous?.id===focus.id&&previous.request===focus.request||provider==='unavailable')return;
  const item=items.find(item=>item.id===focus.id);
  if(!item||!Number.isFinite(item.lat)||!Number.isFinite(item.lng)||Math.abs(item.lat)>=85||Math.abs(item.lng)>=180)return;
  if(item.locationProvider==='google'&&provider!=='google')return;
  return item;
}

export const MAP_FOCUS_ZOOM=18;
