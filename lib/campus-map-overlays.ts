import {groupScreenPins,type ScreenPin} from './campus-map-model';

export type MapOverlay = {point: {lat:number;lng:number}; element: Pick<HTMLElement,'style'>};
type Projector = {project(point: [number,number]): {x:number;y:number};getContainer?:()=>Pick<HTMLElement,'clientWidth'|'clientHeight'>};
type LocatedItem = {id:string;lat:number;lng:number;type?:string;score?:string};
export type OverlayGroupLayout<T> = {key:string;groups:{x:number;y:number;items:T[]}[]};
export type OverlayLayoutOptions = {zoom?:number;selected?:string};
export const UNRATED_PIN_ZOOM=18;
const layer=(item:LocatedItem)=>item.type||'rated';
/** At campus scale the footprints already identify unrated buildings. Avoid a
 * second layer of empty score bubbles; close zoom and selection reveal them. */
export function showReviewPin(item:LocatedItem,zoom:number,selected?:string):boolean {
  if(layer(item)!=='rated'||item.id===selected||zoom>=UNRATED_PIN_ZOOM)return true;
  const score=Number(item.score);return Number.isFinite(score)&&score>=1&&score<=5;
}
export function reviewPinSpacing(zoom:number):number {
  return zoom<15?120:zoom<17?96:zoom<18?84:72;
}

function groupVisiblePins<T extends LocatedItem>(pins:ScreenPin<T>[],options:OverlayLayoutOptions) {
  const zoom=options.zoom??16.65;
  const visible=pins.filter(pin=>showReviewPin(pin.item,zoom,options.selected));
  // An explicitly selected place always has its own accessible marker. Food and
  // other alert layers cannot disappear into a star/review cluster.
  const selected=visible.filter(pin=>pin.item.id===options.selected).map(pin=>({x:pin.x,y:pin.y,items:[pin.item]}));
  const rest=visible.filter(pin=>pin.item.id!==options.selected);
  const reviews=groupScreenPins(rest.filter(pin=>layer(pin.item)==='rated'),reviewPinSpacing(zoom));
  const alerts=[...new Set(rest.map(pin=>layer(pin.item)))].filter(kind=>kind!=='rated').flatMap(kind=>groupScreenPins(rest.filter(pin=>layer(pin.item)===kind),42));
  const alertSpace=[...alerts,...selected.filter(group=>layer(group.items[0])!=='rated')];
  // An alert drawn over a review bubble steals its click target. Keep their
  // real geographic anchors and reserve clear space for time-sensitive alerts;
  // suppressed places remain available through footprints, search and selection.
  const clearReviews=reviews.filter(review=>!alertSpace.some(alert=>Math.hypot(review.x-alert.x,review.y-alert.y)<65));
  return [...clearReviews,...alerts,...selected];
}

/** Preserve a group's geographic representative throughout camera motion, even
 * when a parent re-renders for countdowns. Changed/expired pins take effect immediately.
 */
export function layoutOverlayGroups<T extends LocatedItem>(pins: ScreenPin<T>[], previous: OverlayGroupLayout<T> | null, moving: boolean, options:OverlayLayoutOptions={}): OverlayGroupLayout<T> {
  // Camera zoom is intentionally not part of the key: reveal/recluster only once
  // a gesture settles, while fresh content and expired alerts still update.
  const key=JSON.stringify([options.selected,pins.map(({item})=>[item.id,item.lat,item.lng,layer(item),Number(item.score)>=1&&Number(item.score)<=5])]);
  if (!moving || previous?.key!==key) return {key,groups:groupVisiblePins(pins,options)};
  const current=new Map(pins.map(pin=>[pin.item.id,pin]));
  return {key,groups:previous.groups.map(group=>{
    const anchor=current.get(group.items[0].id)!;
    return {x:anchor.x,y:anchor.y,items:group.items.map(item=>current.get(item.id)!.item)};
  })};
}

/** Run inside the map's render event, before browser paint. React owns contents;
 * the map owns camera-dependent positions, with no extra frame or interpolation.
 */
export function positionMapOverlays(map: Projector, overlays: Iterable<MapOverlay>): void {
  const viewport=map.getContainer?.();
  for (const {point,element} of overlays) {
    const projected = map.project([point.lng,point.lat]);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      element.style.visibility = 'hidden';
      continue;
    }
    const left = `${projected.x}px`, top = `${projected.y}px`;
    if (element.style.left !== left) element.style.left = left;
    if (element.style.top !== top) element.style.top = top;
    // Keep off-screen elements mounted but out of keyboard/pointer interaction.
    // A small margin allows the bubble above an edge anchor to remain visible.
    const outside=viewport&&(projected.x < -80 || projected.x > viewport.clientWidth+80 || projected.y < -80 || projected.y > viewport.clientHeight+80);
    const visibility=outside?'hidden':'';
    if (element.style.visibility!==visibility) element.style.visibility=visibility;
  }
}
