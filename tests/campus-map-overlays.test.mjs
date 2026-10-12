import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const model=compile(await readFile(new URL('../lib/campus-map-model.ts',import.meta.url),'utf8'));
const source=(await readFile(new URL('../lib/campus-map-overlays.ts',import.meta.url),'utf8')).replace("'./campus-map-model'",`'data:text/javascript;base64,${Buffer.from(model).toString('base64')}'`);
const {positionMapOverlays,layoutOverlayGroups}=await import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`);

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
