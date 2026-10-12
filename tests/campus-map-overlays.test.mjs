import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const model=compile(await readFile(new URL('../lib/campus-map-model.ts',import.meta.url),'utf8'));
const source=(await readFile(new URL('../lib/campus-map-overlays.ts',import.meta.url),'utf8')).replace("'./campus-map-model'",`'data:text/javascript;base64,${Buffer.from(model).toString('base64')}'`);
const {positionMapOverlays,layoutOverlayGroups,reviewPinSpacing,UNRATED_PIN_ZOOM}=await import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`);

test('markers and labels use the current canvas projection before the render callback returns',()=>{
  const pin={point:{lat:51.524,lng:-.133},element:{style:{left:'0px',top:'0px',visibility:''}}};
  const label={point:{lat:51.522,lng:-.136},element:{style:{left:'0px',top:'0px',visibility:''}}};
  const camera={panX:0,panY:0,zoom:1,pitch:.6};
  const map={project:([lng,lat])=>({x:lng*1000*camera.zoom+camera.panX,y:lat*100*camera.zoom*camera.pitch+camera.panY})};
  for (const frame of [{panX:0,panY:0,zoom:1,pitch:.6},{panX:180,panY:-90,zoom:1,pitch:.6},{panX:-45,panY:60,zoom:2,pitch:.35}]) {
    Object.assign(camera,frame);
    positionMapOverlays(map,[pin,label]);
    for (const overlay of [pin,label]) {
      const actual=map.project([overlay.point.lng,overlay.point.lat]);
      assert.equal(overlay.element.style.left,`${actual.x}px`,'No queued animation/React frame may leave an old x position');
      assert.equal(overlay.element.style.top,`${actual.y}px`,'Zoom and pitch must use the same projection as the canvas');
    }
  }
});
test('invalid projected positions hide an overlay and a valid later frame restores it',()=>{
  const overlay={point:{lat:51,lng:0},element:{style:{left:'0px',top:'0px',visibility:''}}};
  positionMapOverlays({project:()=>({x:Infinity,y:NaN})},[overlay]);
  assert.equal(overlay.element.style.visibility,'hidden');
  positionMapOverlays({project:()=>({x:12.25,y:40.5})},[overlay]);
  assert.equal(overlay.element.style.visibility,'');assert.equal(overlay.element.style.left,'12.25px');
});
test('offscreen pins enter the viewport in the same render without a React update',()=>{
  const overlay={point:{lat:51,lng:0},element:{style:{left:'0px',top:'0px',visibility:''}}};
  let x=1500;
  const map={getContainer:()=>({clientWidth:800,clientHeight:600}),project:()=>({x,y:200})};
  positionMapOverlays(map,[overlay]);assert.equal(overlay.element.style.visibility,'hidden');
  x=400;positionMapOverlays(map,[overlay]);
  assert.equal(overlay.element.style.left,'400px');assert.equal(overlay.element.style.visibility,'');
});
const pin=(id,x,score='4')=>({x,y:50,item:{id,lat:51+Number(id)/100,lng:0,score}});
test('zooming and parent countdown renders cannot change a cluster anchor mid-gesture',()=>{
  const initial=layoutOverlayGroups([pin('1',10),pin('2',20)],null,false);
  assert.equal(initial.groups.length,1);
  const moving=layoutOverlayGroups([pin('1',100,'5'),pin('2',200)],initial,true);
  assert.equal(moving.groups.length,1,'Keep group membership until motion ends');
  assert.equal(moving.groups[0].items[0].id,'1');assert.equal(moving.groups[0].x,100);
  assert.equal(moving.groups[0].items[0].score,'5','Content updates remain current while the anchor is stable');
  const settled=layoutOverlayGroups([pin('1',100),pin('2',200)],moving,false);
  assert.equal(settled.groups.length,2,'Recluster for the new zoom when motion ends');
});
test('expired pins are removed immediately even during a gesture',()=>{
  const initial=layoutOverlayGroups([pin('1',10),pin('2',20)],null,false);
  const moving=layoutOverlayGroups([pin('2',100)],initial,true);
  assert.deepEqual(moving.groups.flatMap(group=>group.items.map(item=>item.id)),['2']);
});

test('campus zoom prioritises actual ratings without hiding a selected unrated place or food',()=>{
  const pins=[...Array.from({length:190},(_,index)=>pin(String(index),index*10,'—')),pin('reviewed',150,'4.7'),{...pin('food',5,'—'),item:{id:'food',type:'food',lat:51.5,lng:0}}];
  const initial=layoutOverlayGroups(pins,null,false,{zoom:16.65,selected:'120'});
  const shown=initial.groups.flatMap(group=>group.items.map(item=>item.id));
  assert.deepEqual(new Set(shown),new Set(['reviewed','120','food']));
  assert.equal(initial.groups.find(group=>group.items.some(item=>item.id==='120')).items.length,1,'Selection has a dedicated marker');
  for(const score of [undefined,'—','', '0','NaN','6']){
    const candidate=pin('unrated',1);candidate.item.score=score;
    assert.equal(layoutOverlayGroups([candidate],null,false,{zoom:16.65}).groups.length,0);
  }
});

test('zooming closer reveals unrated places once the gesture settles and preserves every selectable item',()=>{
  const pins=[pin('1',10,'—'),pin('2',20,'4.0'),pin('3',200,'—')];
  const initial=layoutOverlayGroups(pins,null,false,{zoom:UNRATED_PIN_ZOOM-.01});
  assert.deepEqual(initial.groups.flatMap(group=>group.items.map(item=>item.id)),['2']);
  const moving=layoutOverlayGroups(pins,initial,true,{zoom:UNRATED_PIN_ZOOM});
  assert.deepEqual(moving.groups.flatMap(group=>group.items.map(item=>item.id)),['2'],'No threshold pop or changing anchor during a gesture');
  const settled=layoutOverlayGroups(pins,moving,false,{zoom:UNRATED_PIN_ZOOM});
  assert.deepEqual(settled.groups.flatMap(group=>group.items.map(item=>item.id)).sort(),['1','2','3']);
  assert.equal(settled.groups[0].items.length,2,'Overlapping rooms still share a selectable list');
});

test('dense review grids produce spaced groups rather than a bubble per place',()=>{
  const pins=Array.from({length:200},(_,index)=>({...pin(String(index),index%20*30),y:Math.floor(index/20)*24}));
  const campus=layoutOverlayGroups(pins,null,false,{zoom:16.65});
  assert.ok(campus.groups.length<=25,`${campus.groups.length} clusters should fit a dense 600 by 240px area`);
  assert.equal(campus.groups.flatMap(group=>group.items).length,200);
  for(let index=0;index<campus.groups.length;index++)for(const other of campus.groups.slice(index+1))assert.ok(Math.hypot(campus.groups[index].x-other.x,campus.groups[index].y-other.y)>=reviewPinSpacing(16.65));
  const close=layoutOverlayGroups(pins,null,false,{zoom:19});
  assert.ok(close.groups.length>campus.groups.length,'Closer zoom allows more separate review bubbles');
});

test('alert layers cannot be buried inside a review group and selection is independently accessible',()=>{
  const pins=[pin('review-a',100),pin('review-b',110),{...pin('food-a',100),item:{id:'food-a',type:'food',lat:51.5,lng:0}},{...pin('deal-a',100),item:{id:'deal-a',type:'deal',lat:51.5,lng:0}}];
  const result=layoutOverlayGroups(pins,null,false,{zoom:16.65,selected:'review-b'});
  assert.equal(result.groups.length,3,'The selected review remains; the obscured nonselected review is suppressed');
  assert.equal(result.groups.filter(group=>group.items[0].type==='food').length,1);
  assert.equal(result.groups.find(group=>group.items[0].id==='review-b').items.length,1);
  const changed=layoutOverlayGroups(pins,result,true,{zoom:16.65,selected:'food-a'});
  assert.equal(changed.groups.find(group=>group.items[0].id==='food-a').items.length,1);
});

test('food reserves a clear click target without moving markers away from their actual anchors',()=>{
  const food={...pin('food',100),item:{id:'food',type:'food',lat:51.5,lng:0}};
  const pins=[pin('1',100),pin('2',110),food];
  const rest=layoutOverlayGroups(pins,null,false,{zoom:16.65});
  assert.deepEqual(rest.groups.flatMap(group=>group.items.map(item=>item.id)),['food'],'An underlying review cluster must not remain an obscured click target');
  assert.equal(rest.groups[0].x,100);assert.equal(rest.groups[0].y,food.y);
  const selected=layoutOverlayGroups(pins,rest,false,{zoom:16.65,selected:'1'});
  assert.ok(selected.groups.some(group=>group.items.length===1&&group.items[0].id==='1'),'Explicitly selected reviews are always accessible');
  for(const [gap,reviewVisible] of [[64,false],[65,true],[100,true]]){
    const spaced=layoutOverlayGroups([pin('1',100+gap),food],null,false,{zoom:19});
    assert.equal(spaced.groups.some(group=>group.items[0].id==='1'),reviewVisible);
  }
  const expired=layoutOverlayGroups(pins.filter(pin=>pin.item.id!=='food'),rest,false,{zoom:16.65});
  assert.deepEqual(expired.groups.flatMap(group=>group.items.map(item=>item.id)),['1','2'],'Reviews return when the alert leaves the feed');
});
