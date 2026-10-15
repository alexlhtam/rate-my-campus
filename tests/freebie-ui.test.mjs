import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadFreebie} from './freebies/load.mjs';
const {FreebieCard,FreebieFacts,FreebieTimeFilter}=await loadFreebie('components/freebie-events.tsx');
const {canConfirmEventVenue,eventFeedStatus}=await loadFreebie('lib/freebies/view.ts');
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

const feedNow=Date.parse('2026-10-15T12:00:00Z');
const readyFeed={importReady:true,importStatus:'ready',lastScan:{start_date:'2026-10-15',end_date:'2026-10-29',updated_at:'2026-10-15T11:55:00Z',status:'complete',exhausted:1,coverageComplete:true}};
test('feed status separates unstarted imports from an empty completed import',()=>{
 const pending=eventFeedStatus({...readyFeed,lastScan:null},0,feedNow);
 assert.equal(pending.state,'not_started');assert.match(pending.detail,/first import still needs to run/);assert.equal(pending.lastChecked,null);
 const empty=eventFeedStatus(readyFeed,0,feedNow);
 assert.equal(empty.state,'empty');assert.match(empty.title,/No published Union events/);assert.match(empty.detail,/latest import has finished/);
});
test('feed status keeps published counts visible when updates are disabled or disconnected',()=>{
 const disabled=eventFeedStatus({...readyFeed,importReady:false,importStatus:'disabled'},4,feedNow);
 assert.equal(disabled.state,'disabled');assert.match(disabled.detail,/4 published Union events are available/);
 const setup=eventFeedStatus({...readyFeed,importReady:false,importStatus:'setup_required'},0,feedNow);
 assert.equal(setup.state,'setup_required');assert.match(setup.detail,/import service is not ready/);
});
test('feed status distinguishes progressing imports from interrupted or incomplete work',()=>{
 const running={...readyFeed,lastScan:{...readyFeed.lastScan,status:'running',coverageComplete:false}};
 assert.equal(eventFeedStatus(running,2,feedNow).state,'importing');
 assert.equal(eventFeedStatus({...running,lastScan:{...running.lastScan,updated_at:'2026-10-15T10:00:00Z'}},2,feedNow).state,'incomplete');
 for(const status of ['failed','partial','paused'])assert.equal(eventFeedStatus({...readyFeed,lastScan:{...readyFeed.lastScan,status,coverageComplete:false}},2,feedNow).state,'incomplete');
 assert.equal(eventFeedStatus({...readyFeed,lastScan:{...readyFeed.lastScan,coverageComplete:false}},2,feedNow).state,'incomplete');
});
test('a completed old import cannot claim coverage of the rolling London fortnight',()=>{
 const yesterday={...readyFeed,lastScan:{...readyFeed.lastScan,start_date:'2026-10-14',end_date:'2026-10-28'}};
 assert.equal(eventFeedStatus(yesterday,8,feedNow).state,'outdated');
 assert.equal(eventFeedStatus({...readyFeed,lastScan:{...readyFeed.lastScan,updated_at:'not-a-date'}},8,feedNow).state,'outdated');
 // London is already on 16 October here, even though UTC is still the 15th.
 assert.equal(eventFeedStatus(readyFeed,8,Date.parse('2026-10-15T23:30:00Z')).state,'outdated');
});
test('current feed explains list-only venues and labels the check in London time',()=>{
 const current=eventFeedStatus(readyFeed,1,feedNow);
 assert.equal(current.state,'current');assert.match(current.detail,/1 published Union event is available/);assert.match(current.detail,/online or unconfirmed venues stay in the list/);assert.match(current.lastChecked,/12:55/);
 // This fortnight crosses the end of British Summer Time; dates remain dates.
 const winter={...readyFeed,lastScan:{...readyFeed.lastScan,start_date:'2026-10-25',end_date:'2026-11-08',updated_at:'2026-10-25T12:00:00Z'}};
 assert.equal(eventFeedStatus(winter,7,Date.parse('2026-10-25T12:05:00Z')).state,'current');
});
