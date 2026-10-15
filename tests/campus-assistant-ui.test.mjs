import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFreebie} from './freebies/load.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const {readSearchResponse}=await loadFreebie('lib/campus-search.ts');
const {withAssistantPins,directoryAnswer}=await loadFreebie('lib/campus-assistant-view.ts');
const {default:Results,AssistantAnswer,AssistantSuggestionCard}=await loadFreebie('components/campus-assistant-results.tsx');
const source={id:'s1',title:'Official UCL library page',url:'https://www.ucl.ac.uk/library'};
const place={id:'campus:archaeology-library',placeId:'archaeology-library',name:'Archaeology Library',description:'On the fifth floor.',address:'31–34 Gordon Square',lat:51.5257,lng:-.1321,locationProvider:'campus',sourceIds:['s1']};
const result={answer:'The library is in the Institute of Archaeology. [s1]',sources:[source],suggestions:[place]};

test('a researched answer retains sources and registered suggestions without invented filters',async()=>{
 const data=await readSearchResponse(Response.json(result));assert.equal(data.message,result.answer);assert.equal(data.filters,null);assert.deepEqual(data.assistant,result);
});

test('unsafe citations, malformed coordinates and unknown source references fail closed',async()=>{
 for(const data of [
  {...result,sources:[{...source,url:'javascript:alert(1)'}]},
  {...result,suggestions:[{...place,lat:100}]},
  {...result,suggestions:[{...place,lat:undefined}]},
  {...result,suggestions:[{...place,sourceIds:['invented']}]},
  {...result,suggestions:[{...place,mapUrl:'http://example.com'}]},
  {...result,suggestions:[place,place]},
 ])await assert.rejects(readSearchResponse(Response.json(data)),/incomplete/);
});

test('a private search pin replaces its rated duplicate but preserves other map items',()=>{
 const items=[{id:'archaeology-library',lat:place.lat,lng:place.lng,score:'4.5'},{id:'another-place',lat:51.5,lng:-.13}];
 const pins=withAssistantPins(items,[place,{...place,id:'unknown',placeId:'unknown',lat:undefined,lng:undefined}]);
 assert.equal(pins.length,2);assert.equal(pins[0].id,'another-place');assert.equal(pins[1].id,'assistant:campus:archaeology-library');assert.equal(pins[1].type,'assistant');assert.equal(pins[1].score,undefined);
 assert.deepEqual(withAssistantPins(items,[]),items);
});

test('sources are clickable and HTML from model text remains inert',()=>{
 const html=renderToStaticMarkup(createElement(AssistantAnswer,{answer:'<img src=x onerror=alert(1)> [s1]',sources:[source]}));
 assert.match(html,/&lt;img/);assert.match(html,/href="https:\/\/www.ucl.ac.uk\/library"/);assert.doesNotMatch(html,/<img/);
});

test('unlocated suggestions offer source information without a map button',()=>{
 const html=renderToStaticMarkup(createElement(Results,{result:{...result,suggestions:[{...place,lat:undefined,lng:undefined}]},onFocus(){},onOpenPlace(){},googleAvailable:false}));
 assert.match(html,/hasn’t been confirmed/);assert.doesNotMatch(html,/Show on map/);assert.match(html,/Sources/);
});

test('Google suggestions retain an external map link while an OSM map is in use',()=>{
 const props={item:{...place,placeId:undefined,locationProvider:'google',mapUrl:'https://www.google.com/maps/search/?api=1&query=Library'},sources:[source],onFocus(){},onOpenPlace(){}};
 const fallback=renderToStaticMarkup(createElement(AssistantSuggestionCard,{...props,googleAvailable:false}));
 assert.doesNotMatch(fallback,/Show on map/);assert.match(fallback,/Google Maps/);
 const connected=renderToStaticMarkup(createElement(AssistantSuggestionCard,{...props,googleAvailable:true}));assert.match(connected,/Show on map/);
});

test('an exact catalogue match uses its existing building point and visiting source',()=>{
 const answer=directoryAnswer({id:'library',name:'Library',address:'Gordon Square',description:'Fifth floor',lat:51.5,lng:-.13,sourceUrl:source.url,visitGuide:[{text:'Use the main entrance.',sourceUrl:source.url}]});
 assert.equal(answer.sources.length,1);assert.equal(answer.suggestions[0].placeId,'library');assert.equal(answer.suggestions[0].lat,51.5);assert.match(answer.suggestions[0].description,/Use the main entrance/);assert.match(answer.answer,/building is marked/);
});
