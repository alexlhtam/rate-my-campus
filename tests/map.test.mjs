import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Server rendering does not run effects, so neither the GPU renderer nor its
// worker is loaded. Compile the real local dependencies, not a component stub.
const names = ['data', 'model', 'overlays', 'buildings', 'flat', 'main', 'fallback', 'garden', 'wilkins', 'mixedMain', 'mixedFlat'];
const modules = Object.fromEntries(names.map(name => [name, new URL(`.map-${name}-under-test-${process.pid}.mjs`, import.meta.url)]));
const paths = { data: '../lib/data.ts', model: '../lib/campus-map-model.ts', overlays: '../lib/campus-map-overlays.ts', buildings: '../components/campus-buildings.tsx', flat: '../components/campus-flat-map.tsx', main: '../components/campus-map.tsx', fallback: '../components/campus-map.tsx', garden: '../components/campus-map.tsx', wilkins: '../components/campus-map.tsx', mixedMain:'../components/campus-map.tsx', mixedFlat:'../components/campus-flat-map.tsx' };
const mixedItems=[['event','Campus talk'],['freebie','Society giveaway'],['food','Leftover lunch'],['deal','Student discount']].map(([type,title])=>({id:type,type,title,lat:51.525,lng:-.134,eventState:'upcoming',timeLabel:'Tomorrow'}));
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
let CampusMap, FlatCampusMap, FallbackCampusMap, GardenCampusMap, WilkinsCampusMap, MixedMainMap, MixedFlatMap, areCampusMapPropsEqual;
try {
  for (const name of names) {
    let source = (await fs.readFile(new URL(paths[name], import.meta.url), 'utf8'))
      .replace(/from\s+(['"])\.\/campus-buildings\1/g, `from '${modules.buildings.href}'`)
      .replace(/from\s+(['"])\.\/campus-flat-map\1/g, `from '${modules.flat.href}'`)
      .replace(/from\s+(['"])@\/lib\/campus-map-model\1/g, `from '${modules.model.href}'`)
      .replace(/from\s+(['"])\.\/campus-map-model\1/g, `from '${modules.model.href}'`)
      .replace(/from\s+(['"])@\/lib\/campus-map-overlays\1/g, `from '${modules.overlays.href}'`)
      .replace(/from\s+(['"])@\/lib\/data\1/g, `from '${modules.data.href}'`);
    if (name === 'data') {
      // Use the real catalogue/index without asking Node to resolve TS paths.
      source = source.replace(/from\s+(['"])\.\.\/public\/data\/([^'"]+\.json)\1/g, (_, _quote, file) => `from '${new URL(`../public/data/${file}`, import.meta.url).href}' with {type:'json'}`);
    }
    if(name==='mixedMain'||name==='mixedFlat'){
      // Seed only the picker-open state; both renderers still execute their real
      // content, filtering, icon and accessibility code with current props.
      const before='useState<MapItem[]|null>(null)';
      assert.equal(source.split(before).length,2);
      source=source.replace(before,`useState<MapItem[]|null>(${JSON.stringify(mixedItems)})`);
    }
    if (name === 'garden' || name === 'wilkins') {
      const directory = JSON.parse(await fs.readFile(new URL('../public/data/campus-directory.json', import.meta.url), 'utf8'));
      const building = directory.buildings.find(item => item.id === (name === 'garden' ? 'ucl-garden-halls' : 'ucl-wilkins-building'));
      const before = 'useState<CampusBuilding|null>(null)';
      assert.equal(source.split(before).length, 2, 'Seed the selected-building state explicitly');
      source = source.replace(before, `useState<CampusBuilding|null>(${JSON.stringify(building)})`);
    }
    if (name === 'fallback') {
      // Render the same component after its GPU-failure/data-load state updates.
      // SSR cannot run those effects, so seed only those hook initialisers in
      // this test copy; production code receives no test-only props or branches.
      const directory = { datasetDate: 'fixture', buildings: [
        { id: 'ucl-fixture-partner', name: 'Mapped partner hall', campus: 'bloomsbury', membership: { status: 'ucl-partner', scope: 'shared-site' }, accommodation: { current: true, operator: 'Example operator' } },
        { id: 'ucl-fixture-unmapped', name: 'Unmapped campus room', campus: 'bloomsbury', coordinates: null, membership: { status: 'ucl-used', scope: 'part-of-building' } },
      ] };
      const geometry = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { buildingId: 'ucl-fixture-partner', affiliationVerified: true, isOutline: false }, geometry: { type: 'Polygon', coordinates: [[[-0.134, 51.524], [-0.133, 51.524], [-0.133, 51.525], [-0.134, 51.524]]] } }] };
      for (const [before, after] of [
        ['[fallback,setFallback]=useState(false)', '[fallback,setFallback]=useState(true)'],
        ['[directoryOpen,setDirectoryOpen]=useState(false)', '[directoryOpen,setDirectoryOpen]=useState(true)'],
        ['useState<CampusDirectory>(emptyDirectory)', `useState<CampusDirectory>(${JSON.stringify(directory)})`],
        ['useState<CampusGeometry>(emptyGeometry)', `useState<CampusGeometry>(${JSON.stringify(geometry)})`],
      ]) {
        assert.equal(source.split(before).length, 2, `Keep the fallback test state injection explicit: ${before}`);
        source = source.replace(before, after);
      }
    }
    await fs.writeFile(modules[name], compile(source));
  }
  const mainModule = await import(modules.main.href);
  CampusMap = mainModule.default;
  areCampusMapPropsEqual = mainModule.areCampusMapPropsEqual;
  FlatCampusMap = (await import(modules.flat.href)).default;
  FallbackCampusMap = (await import(modules.fallback.href)).default;
  GardenCampusMap = (await import(modules.garden.href)).default;
  WilkinsCampusMap = (await import(modules.wilkins.href)).default;
  MixedMainMap = (await import(modules.mixedMain.href)).default;
  MixedFlatMap = (await import(modules.mixedFlat.href)).default;
} finally { await Promise.all(Object.values(modules).map(file => fs.unlink(file).catch(() => {}))); }

test('map memo skips equivalent parent countdown props but updates every displayed item field', () => {
  assert.equal(CampusMap.compare,areCampusMapPropsEqual,'The rendered map uses this comparison');
  const item={id:'talk',lat:51.525,lng:-.134,name:'Lecture room',title:'Evening talk',type:'event',score:'4.0',timeLabel:'Thu 19:00',eventState:'upcoming',locationProvider:'manual',campusBuildingId:'ucl-test'};
  const props={items:[item],onSelect(){},initialPosition:{lat:51.525,lng:-.134}};
  assert.equal(areCampusMapPropsEqual(props,{...props,items:[{...item,description:'Unrelated sidebar text'}],initialPosition:{...props.initialPosition}}),true);
  for(const [field,value] of Object.entries({id:'new-id',lat:51.526,lng:-.135,name:'New room',title:'Updated talk',type:'freebie',score:'4.1',timeLabel:'Live',eventState:'live',locationProvider:'google',campusBuildingId:'ucl-another'})) {
    assert.equal(areCampusMapPropsEqual(props,{...props,items:[{...item,[field]:value}]}),false,field+' must remain live');
  }
  assert.equal(areCampusMapPropsEqual(props,{...props,items:[]}),false,'Expired/filtered pins disappear');
  assert.equal(areCampusMapPropsEqual({...props,items:[item,{...item,id:'other'}]},{...props,items:[{...item,id:'other'},item]}),false,'Order affects the chosen cluster representative');
});

test('map memo never retains stale callbacks, selection or confirmation settings', () => {
  const props={items:[],onSelect(){},onPosition(){},onProviderChange(){},selected:'a',confirm:false,requireGoogle:false,initialPosition:{lat:51.525,lng:-.134}};
  for(const field of ['onSelect','onPosition','onProviderChange'])assert.equal(areCampusMapPropsEqual(props,{...props,[field]:()=>{}}),false,field);
  for(const [field,value] of Object.entries({selected:'b',confirm:true,requireGoogle:true,initialPosition:{lat:51.526,lng:-.134}}))assert.equal(areCampusMapPropsEqual(props,{...props,[field]:value}),false,field);
  assert.equal(areCampusMapPropsEqual(props,{...props,initialPosition:{lat:51.525,lng:-.135}}),false,'Longitude changes must update a confirmed position');
});

test('general events retain calendar icons, time labels, accessible targets and live/upcoming state',()=>{
  for(const [eventState,timeLabel] of [['upcoming','Thu 19:00'],['live','Live']]){
    const markup=renderToStaticMarkup(React.createElement(FlatCampusMap,{items:[{id:'talk',title:'Campus talk',type:'event',lat:51.525,lng:-.134,eventState,timeLabel}],onSelect(){}}));
    assert.match(markup,/lucide-calendar-days/);
    assert.match(markup,new RegExp(`map-pin event ${eventState}`));
    assert.ok(markup.includes(timeLabel));
    assert.match(markup,/aria-label="View Campus talk"/);
    assert.match(markup,/translate:/,'Screen coordinates preserve the CSS anchor and selected/hover scale');
  }
});

test('one mixed alert target leads to every co-located event and find with its own icon',()=>{
  const markup=renderToStaticMarkup(React.createElement(FlatCampusMap,{items:mixedItems,onSelect(){}}));
  assert.equal(markup.split('data-map-layer="mixed"').length-1,1);
  assert.match(markup,/aria-label="4 events and finds nearby"/);
  assert.match(markup,/lucide-layers/);
  for(const Component of [MixedMainMap,MixedFlatMap]){
    const html=renderToStaticMarkup(React.createElement(Component,{items:mixedItems,onSelect(){}}));
    const picker=html.split('aria-label="Places at this location"')[1]?.split('</section>')[0];
    assert.ok(picker,'The mixed target opens a picker');
    for(const item of mixedItems)assert.ok(picker.includes(item.title),item.title+' remains selectable');
    for(const icon of ['calendar-days','gift','utensils','tag'])assert.ok(picker.includes('lucide-'+icon),icon);
    assert.equal((picker.match(/<button\b/g)||[]).length,6,'Close, zoom and four individual item buttons');
  }
});

test('open mixed pickers refresh current content and remove expired/filtered alerts',()=>{
  const remaining=mixedItems.filter(item=>item.id!=='food').map(item=>item.id==='event'?{...item,title:'Updated campus talk',eventState:'live'}:item);
  for(const Component of [MixedMainMap,MixedFlatMap]){
    const html=renderToStaticMarkup(React.createElement(Component,{items:remaining,onSelect(){}}));
    const picker=html.split('aria-label="Places at this location"')[1]?.split('</section>')[0];
    assert.ok(picker.includes('Updated campus talk'));
    assert.ok(!picker.includes('Leftover lunch'),'An expired pickup cannot remain in a stale picker snapshot');
    const empty=renderToStaticMarkup(React.createElement(Component,{items:[],onSelect(){}}));
    assert.ok(!empty.includes('aria-label="Places at this location"'),'No empty picker or invalid zoom bounds');
  }
});

test('Google-derived location stays hidden until its attributed Google map is ready', () => {
  for (const Component of [CampusMap, FlatCampusMap]) {
    const markup = renderToStaticMarkup(React.createElement(Component, { items: [], onSelect() {}, confirm: true, requireGoogle: true, initialPosition: { lat: 51.525, lng: -0.135 } }));
    assert.doesNotMatch(markup, /OpenStreetMap|tile\.openstreetmap|\/api\/map\/tile/);
    assert.match(markup, /Loading the map/);
    assert.doesNotMatch(markup, /class="confirm-cross"/);
  }
});

test('both confirmation renderers have three controls which cannot submit the posting form', () => {
  for (const Component of [CampusMap, FlatCampusMap]) {
    const markup = renderToStaticMarkup(React.createElement(Component, { items: [], onSelect() {}, confirm: true }));
    const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
    assert.equal(buttons.length, 3);
    assert.ok(buttons.every(button => button.includes('type="button"')));
    for (const label of ['Zoom in', 'Zoom out', 'Back to UCL']) assert.ok(markup.includes(`aria-label="${label}"`));
  }
});

test('MapLibre initial HTML exposes map controls without fabricating canvas placement or Google attribution', () => {
  const markup = renderToStaticMarkup(React.createElement(CampusMap, { items: [{ id: 'library', name: 'Library', lat: 51.525, lng: -0.134 }], selected: 'library', onSelect() {} }));
  assert.match(markup, /data-map-engine="maplibre"/);
  for (const label of ['Campus area', 'Find a UCL building', 'Raised campus buildings', 'Building labels', 'Point map north']) assert.ok(markup.includes(`aria-label="${label}"`));
  assert.match(markup, /OpenStreetMap contributors/);
  assert.doesNotMatch(markup, />Google Maps</);
  assert.doesNotMatch(markup, /aria-label="View Library"/, 'Screen pins need a ready map projection');
  const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
  assert.ok(buttons.every(button => button.includes('type="button"')));
});

test('flat fallback preserves selectable pins and explicit attribution without a false 3D control', () => {
  const markup = renderToStaticMarkup(React.createElement(FlatCampusMap, { items: [{ id: 'library', name: 'Library', lat: 51.525, lng: -0.134 }], selected: 'library', onSelect() {} }));
  assert.match(markup, /OpenStreetMap contributors/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /aria-label="View Library"/);
  assert.doesNotMatch(markup, /Raised campus buildings|Campus 3D|estimated heights|>3D<|>Google Maps</);
});

test('GPU fallback retains searchable building coverage and partner information above one set of flat controls', () => {
  const markup = renderToStaticMarkup(React.createElement(FallbackCampusMap, { items: [], onSelect() {} }));
  assert.match(markup, /data-map-engine="flat"/);
  for (const label of ['Campus area', 'Find a UCL building', 'UCL building directory', 'Search UCL buildings', 'Filter footprint coverage', 'Filter building campus']) assert.ok(markup.includes(`aria-label="${label}"`), label);
  assert.match(markup, /1 of 2 listed locations have mapped footprints/);
  assert.match(markup, /Mapped partner hall/);
  assert.match(markup, /Partner residence.*Example operator/);
  assert.match(markup, /Unmapped campus room/);
  assert.match(markup, /Footprint not yet mapped/);
  for (const label of ['Zoom in', 'Zoom out', 'Back to UCL']) assert.equal(markup.split(`aria-label="${label}"`).length - 1, 1, `One ${label} control`);
  assert.doesNotMatch(markup, /Raised campus buildings|Building labels|YOUR UCL NEIGHBOURHOOD|A little local knowledge goes a long way/);
  assert.match(markup, /OpenStreetMap contributors/);
});

test('an unrated live campus does not fill the map with empty review bubbles or hide food alerts', () => {
  const items = [{id:'unrated-library',name:'Unrated library',lat:51.525,lng:-.134,score:'—'}, {id:'live-food',title:'Society lunch',type:'food',lat:51.525,lng:-.134}];
  const flat = renderToStaticMarkup(React.createElement(FlatCampusMap,{items,onSelect(){}}));
  assert.doesNotMatch(flat,/aria-label="View Unrated library"/);
  assert.match(flat,/aria-label="View Society lunch"/);
  const map = renderToStaticMarkup(React.createElement(CampusMap,{items,onSelect(){}}));
  assert.match(map,/aria-label="Find a UCL building"/);
  assert.doesNotMatch(map,/aria-label="View Unrated library"/);
});

test('building cards offer review pages even when every rated pin is filtered out', () => {
  const garden = renderToStaticMarkup(React.createElement(GardenCampusMap, {items:[],onSelect(){}}));
  assert.match(garden,/Garden Halls/);
  assert.match(garden,/Building reviews and discussion/);
  assert.match(garden,/Partner residence/);
  const wilkins = renderToStaticMarkup(React.createElement(WilkinsCampusMap, {items:[],onSelect(){}}));
  assert.match(wilkins,/Building reviews and discussion/);
  assert.match(wilkins,/UCL Main Library/);
  assert.match(wilkins,/Gustave Tuck Lecture Theatre/);
  assert.equal(wilkins.split('Room or space reviews').length-1,2,'Rooms remain separate from building reviews');
});
