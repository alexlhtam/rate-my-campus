import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadFreebie} from './freebies/load.mjs';
const {FreebieCard,FreebieFacts,FreebieTimeFilter}=await loadFreebie('components/freebie-events.tsx');
const {canConfirmEventVenue}=await loadFreebie('lib/freebies/view.ts');
const pin={id:'fixture',title:'Example event',startsAt:'2026-10-12T18:00:00Z',expiresAt:'2026-10-12T20:00:00Z',location:'Wilkins Building',lat:51.5246,lng:-.1338,sourceUrl:'https://studentsunionucl.org/whats-on/clubs-societies/example',dietary:['Vegan'],freebie:{hasFreebies:true,freebies:[{item:'pizza',category:'food',evidence:'Free pizza for members',certainty:'confirmed'}],society:{name:'Example Society',evidence:'Example Society'},admission:'paid',priceDetails:'£5 ticket',bookingRequired:true,eligibility:'Society members',conditions:['While stocks last']}};
test('event cards display explicit items, society, ticket restrictions, dietary information and the source',()=>{
 const html=renderToStaticMarkup(React.createElement(FreebieCard,{pin,now:Date.parse('2026-10-12T12:00:00Z'),saved:false,onOpen(){},onSave(){}}));
 for(const value of ['upcoming','Example Society','pizza','Vegan','£5 ticket','Booking required','Society members','Union listing','London time'])assert.ok(html.includes(value),value);
 assert.ok(html.includes(pin.sourceUrl));
});
test('online events remain location TBC even if stale coordinates were supplied',()=>{
 const html=renderToStaticMarkup(React.createElement(FreebieFacts,{pin:{...pin,freebie:{...pin.freebie,attendance:'online'}},expanded:true}));
 assert.ok(html.includes('Location TBC'));assert.ok(html.includes('Online event'));assert.ok(!html.includes('Get directions'));
});

test('venue confirmation respects the original online flag when extraction is incomplete',()=>{
 const imported={publishedPostId:'published-event',extraction:{attendance:'unknown'}};
 assert.equal(canConfirmEventVenue(imported),true);
 assert.equal(canConfirmEventVenue({...imported,sourceOnline:true}),false);
 assert.equal(canConfirmEventVenue({...imported,sourceOnline:false,extraction:{attendance:'online'}}),false);
 assert.equal(canConfirmEventVenue({...imported,publishedPostId:null}),false);
});
test('unknown society, dietary and prices are labelled rather than inferred',()=>{
 const html=renderToStaticMarkup(React.createElement(FreebieFacts,{pin:{...pin,dietary:[],freebie:null}}));
 for(const value of ['Organiser not stated','Dietary information not stated','requirements not stated'])assert.ok(html.includes(value));
});

test('regular Union events are visually distinguished and do not imply food or freebies',()=>{
 const html=renderToStaticMarkup(React.createElement(FreebieCard,{pin:{...pin,type:'event',dietary:[],description:'Example film screening',freebie:{...pin.freebie,hasFreebies:false,freebies:[],admission:'free',priceDetails:null}},now:Date.parse('2026-10-12T12:00:00Z'),saved:false,onOpen(){},onSave(){}}));
 for(const value of ['Campus event','Example film screening','Free entry','Union listing'])assert.ok(html.includes(value),value);
 for(const value of ['Includes freebies','Dietary information not stated','pizza'])assert.ok(!html.includes(value),value);
});

test('event facts display the actual source end even when pin visibility is capped earlier',()=>{
 const html=renderToStaticMarkup(React.createElement(FreebieFacts,{pin:{...pin,freebie:{...pin.freebie,eventEnd:'2026-10-29T20:00:00Z'}},expanded:true}));
 assert.ok(html.includes('29 Oct'));
});
test('time filter exposes Today as selected and offers all four time windows',()=>{
 const html=renderToStaticMarkup(React.createElement(FreebieTimeFilter,{value:'today',onChange(){}}));
 assert.match(html,/aria-pressed="true">Today/);
 for(const value of ['Now','Today','This week','2 weeks'])assert.ok(html.includes(value));
});
