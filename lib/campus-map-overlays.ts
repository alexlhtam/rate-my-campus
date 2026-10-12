import {groupScreenPins,type ScreenPin} from './campus-map-model';

export type MapOverlay = {point: {lat:number;lng:number}; element: Pick<HTMLElement,'style'>};
type Projector = {project(point: [number,number]): {x:number;y:number};getContainer?:()=>Pick<HTMLElement,'clientWidth'|'clientHeight'>};
type LocatedItem = {id:string;lat:number;lng:number};
export type OverlayGroupLayout<T> = {key:string;groups:{x:number;y:number;items:T[]}[]};

/** Preserve a group's geographic representative throughout camera motion, even
 * when a parent re-renders for countdowns. Changed/expired pins take effect immediately.
 */
export function layoutOverlayGroups<T extends LocatedItem>(pins: ScreenPin<T>[], previous: OverlayGroupLayout<T> | null, moving: boolean): OverlayGroupLayout<T> {
  const key=JSON.stringify(pins.map(({item})=>[item.id,item.lat,item.lng]));
  if (!moving || previous?.key!==key) return {key,groups:groupScreenPins(pins)};
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
