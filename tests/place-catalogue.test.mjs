import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

async function load(name) {
  const url = new URL(`../lib/${name}.ts`, import.meta.url);
  const source = await readFile(url, 'utf8');
  const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const module = {exports:{}};
  new Function('require','module','exports',js)(createRequire(url),module,module.exports);
  return module.exports;
}
const [{places, buildingPlaceId, placesInBuilding, categoryCriterionKeys}, {hasCoordinates,distanceKm,matchesPlaceSearch}, hours] = await Promise.all([load('data'),load('place-search'),load('place-hours')]);
const directory = JSON.parse(await readFile(new URL('../public/data/campus-directory.json',import.meta.url),'utf8'));
const footprints = JSON.parse(await readFile(new URL('../public/data/campus-footprint-index.json',import.meta.url),'utf8'));
const originalIds = ['student-centre','main-library','senate-house','science-library','ssees-library','ioe-library','cruciform-lt1','gustave-tuck','logan-hall','ingold-auditorium','ramsay-hall','astor-college','john-adams-hall'];

test('every official directory entry has exactly one building review target, separate from rooms', () => {
  assert.equal(new Set(places.map(place=>place.id)).size,places.length);
  for (const id of originalIds) assert.ok(places.some(place=>place.id===id),`Preserve existing reviews: ${id}`);
  for (const building of directory.buildings) {
    const targets=placesInBuilding(building.id);
    assert.equal(targets.filter(place=>!place.parentPlaceId).length,1,building.id);
    assert.equal(targets[0].id,buildingPlaceId(building.id));
    for (const child of targets.filter(place=>place.parentPlaceId)) assert.equal(child.parentPlaceId,targets[0].id);
  }
  assert.deepEqual(placesInBuilding('ucl-wilkins-building').map(place=>place.id).sort(),['gustave-tuck','main-library','ucl-wilkins-building']);
  const garden=places.find(place=>place.id==='ucl-garden-halls');
  assert.equal(garden.category,'halls');
  assert.equal(garden.currentAccommodation,true);
  assert.match(garden.membershipNote,/Partner residence/);
});

test('directory membership cannot manufacture a map point, even for formerly approximate places', () => {
  const byId=new Map(footprints.buildings.map(building=>[building.buildingId,building]));
  for (const place of places.filter(place=>!place.demo)) {
    const building=directory.buildings.find(building=>building.id===place.campusBuildingId);
    const coordinate=byId.get(building.id)?.coordinates || building.coordinates;
    if (coordinate) {
      assert.ok(hasCoordinates(place),place.id);
      assert.equal(place.lat,coordinate.lat);assert.equal(place.lng,coordinate.lng);
    } else {
      assert.equal(place.lat,undefined,place.id);assert.equal(place.lng,undefined,place.id);
      assert.equal(place.locationStatus,'unlocated');
    }
  }
  assert.equal(hasCoordinates(places.find(place=>place.id==='john-adams-hall')),false);
  assert.equal(hasCoordinates({lat:NaN,lng:-.1}),false);
  assert.equal(hasCoordinates({lat:91,lng:-.1}),false);
});

test('academic buildings are not misrepresented as lecture rooms or supplied fake amenities', () => {
  const cruciform=places.find(place=>place.id==='ucl-cruciform-building');
  assert.equal(cruciform.category,'building');
  assert.deepEqual(categoryCriterionKeys.building,['comfort','wifi','accessibility']);
  assert.equal(places.find(place=>place.id==='cruciform-lt1').category,'lecture');
  assert.ok(!cruciform.tags.includes('Quiet'));
});

test('arrival guides remain attributed to specific spaces and preserve material access restrictions', () => {
  const guided=places.filter(place=>place.visitGuide?.length);
  assert.deepEqual(guided.map(place=>place.id).sort(),['ioe-library','main-library','science-library','ssees-library']);
  for (const place of guided) for (const guide of place.visitGuide) {
    assert.equal(new URL(guide.sourceUrl).hostname,'www.ucl.ac.uk');
    assert.match(guide.checkedAt,/^\d{4}-\d{2}-\d{2}$/);
    assert.ok(guide.text.length>30);
  }
  const ioe=guided.find(place=>place.id==='ioe-library').visitGuide.map(guide=>guide.text).join(' ');
  assert.match(ioe,/level 3 has no safe evacuation route/);
  assert.match(ioe,/Core B on level 4/);
  assert.equal(places.find(place=>place.id==='ucl-20-bedford-way').visitGuide,undefined,'Do not generalise a library guide to the whole IOE building');
});

test('unified search resolves official aliases, address words and space names', () => {
  assert.ok(matchesPlaceSearch(places.find(place=>place.id==='ucl-garden-halls'),'garden hall'));
  assert.ok(matchesPlaceSearch(places.find(place=>place.id==='main-library'),'Wilkins library'));
  assert.ok(matchesPlaceSearch(places.find(place=>place.id==='ssees-library'),'sockets'));
  assert.ok(matchesPlaceSearch(places.find(place=>place.id==='ucl-cruciform-building'),'cruciform'));
  assert.equal(matchesPlaceSearch(places.find(place=>place.id==='ucl-cruciform-building'),'free pizza'),false);
});

test('distance depends on the selected origin and unknown locations remain unknown', () => {
  const west={lat:51.5,lng:-.1}, east={lat:51.5,lng:0};
  assert.equal(distanceKm(west,west),0);
  assert.ok(distanceKm(west,east)>6 && distanceKm(west,east)<8);
  assert.equal(distanceKm(west,{}),null);
  assert.equal(distanceKm(west,{lat:Infinity,lng:0}),null);
});

const schedule={timeZone:'Europe/London',sourceUrl:'https://example.org/hours',checkedAt:'2026-01-01',validFrom:'2026-01-01',validThrough:'2026-12-31',weekly:{mon:[{open:'09:00',close:'17:00'}],tue:[{open:'09:00',close:'17:00'}],wed:[],thu:[],fri:[{open:'22:00',close:'02:00'}],sat:[],sun:[]}};
test('opening hours use London clock across BST/GMT with exclusive closing boundaries', () => {
  assert.equal(hours.evaluateOpeningHours(schedule,Date.parse('2026-10-12T08:00:00Z')).status,'open');
  assert.equal(hours.evaluateOpeningHours(schedule,Date.parse('2026-10-12T16:00:00Z')).status,'closed');
  assert.equal(hours.evaluateOpeningHours(schedule,Date.parse('2026-12-07T08:59:00Z')).status,'closed');
  assert.equal(hours.evaluateOpeningHours(schedule,Date.parse('2026-12-07T09:00:00Z')).status,'open');
});
test('overnight opening carries to the next day but full-date exceptions take priority', () => {
  assert.equal(hours.evaluateOpeningHours(schedule,Date.parse('2026-10-16T22:00:00Z')).status,'open');
  assert.equal(hours.evaluateOpeningHours(schedule,Date.parse('2026-10-17T00:30:00Z')).status,'open');
  assert.equal(hours.evaluateOpeningHours(schedule,Date.parse('2026-10-17T01:00:00Z')).status,'closed');
  assert.equal(hours.evaluateOpeningHours({...schedule,exceptions:{'2026-10-17':[]}},Date.parse('2026-10-17T00:30:00Z')).status,'closed');
  assert.equal(hours.evaluateOpeningHours({...schedule,exceptions:{'2026-10-17':null}},Date.parse('2026-10-17T00:30:00Z')).status,'unknown');
});
test('missing, stale, partial and invalid schedules never claim a place is open', () => {
  assert.equal(hours.openingStatus({id:'ucl-cruciform-building'},Date.parse('2026-10-12T10:00Z')).status,'unknown');
  assert.equal(hours.evaluateOpeningHours(schedule,Date.parse('2027-01-01T10:00Z')).reason,'stale');
  assert.equal(hours.evaluateOpeningHours({...schedule,weekly:{mon:[{open:'09:00',close:'17:00'}]}},Date.parse('2026-10-13T10:00Z')).status,'unknown');
  assert.equal(hours.evaluateOpeningHours({...schedule,weekly:{...schedule.weekly,mon:[{open:'29:00',close:'17:00'}]}},Date.parse('2026-10-12T10:00Z')).status,'unknown');
});
test('verified study schedules expire rather than silently persisting indefinitely', () => {
  assert.equal(hours.openingStatus({id:'student-centre'},Date.parse('2026-10-12T01:00Z')).status,'open');
  assert.equal(hours.openingStatus({id:'senate-house'},Date.parse('2026-10-12T21:59Z')).status,'open');
  assert.equal(hours.openingStatus({id:'senate-house'},Date.parse('2026-10-12T22:00Z')).status,'closed');
  assert.equal(hours.isOpenLate({id:'student-centre'},Date.parse('2026-10-12T10:00Z')),true);
  assert.equal(hours.isOpenLate({id:'senate-house'},Date.parse('2026-10-17T10:00Z')),false);
  assert.equal(hours.isOpenLate({id:'main-library'},Date.parse('2026-10-12T10:00Z')),false);
  assert.equal(hours.openingStatus({id:'student-centre'},Date.parse('2026-11-12T01:00Z')).reason,'stale');
  assert.equal(hours.isOpenLate({id:'student-centre'},Date.parse('2026-11-12T01:00Z')),false);
});
