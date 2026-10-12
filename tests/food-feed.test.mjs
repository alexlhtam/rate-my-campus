import test from 'node:test';
import assert from 'node:assert/strict';
import {readFoodPages} from '../lib/food-feed.ts';

const alerts=(start,count)=>Array.from({length:count},(_,index)=>({id:`food-${start+index}`,title:`Pickup ${start+index}`}));
function loaderFor(rows,calls=[]) {
  return async offset=>{calls.push(offset);return {posts:rows.slice(offset,offset+40),total:rows.length,nextOffset:offset+40<rows.length?offset+40:null};};
}

test('refresh re-reads the whole displayed range without losing loaded pages or retaining removed alerts',async()=>{
  const original=alerts(0,160);
  const before=await readFoodPages(loaderFor(original),120);
  assert.equal(before.posts.length,120);assert.equal(before.nextOffset,120);
  const fresh=[...alerts(200,3),...original.filter(row=>!['food-0','food-45','food-90'].includes(row.id))];
  const calls=[];
  const after=await readFoodPages(loaderFor(fresh,calls),120);
  assert.deepEqual(calls,[0,40,80]);assert.equal(after.posts.length,120);assert.equal(after.nextOffset,120);
  assert.deepEqual(after.posts,fresh.slice(0,120));
  for(const removed of ['food-0','food-45','food-90'])assert.equal(after.posts.some(row=>row.id===removed),false);
  assert.ok(after.posts.some(row=>row.id==='food-119'));
  assert.equal(before.posts.length,120);assert.equal(before.posts[0].id,'food-0');
});

test('overlapping pages contain each alert once and preserve feed ordering',async()=>{
  const calls=[];
  const result=await readFoodPages(async offset=>{
    calls.push(offset);
    return offset===0?{posts:[{id:'a'},{id:'b'}],total:3,nextOffset:2}:{posts:[{id:'b'},{id:'c'},{id:'c'}],total:3,nextOffset:null};
  },4);
  assert.deepEqual(calls,[0,2]);assert.deepEqual(result.posts.map(row=>row.id),['a','b','c']);
  assert.equal(result.total,3);assert.equal(result.nextOffset,null);
});

test('a shrinking or empty feed replaces the old range and stops when pagination ends',async()=>{
  const calls=[];
  const short=await readFoodPages(loaderFor(alerts(50,53),calls),160);
  assert.deepEqual(calls,[0,40]);assert.equal(short.posts.length,53);assert.equal(short.total,53);assert.equal(short.nextOffset,null);
  const emptyCalls=[];
  assert.deepEqual(await readFoodPages(loaderFor([],emptyCalls),160),{posts:[],total:0,nextOffset:null});
  assert.deepEqual(emptyCalls,[0]);
});

test('a feed shrinking between page requests uses the latest total and terminal cursor',async()=>{
  const first=alerts(0,40),last={id:'last-food'};
  const result=await readFoodPages(async offset=>offset===0?{posts:first,total:95,nextOffset:40}:{posts:[last],total:41,nextOffset:null},120);
  assert.equal(result.posts.length,41);assert.equal(result.total,41);assert.equal(result.nextOffset,null);
  assert.equal(result.posts.at(-1).id,'last-food');
});

test('a later page failure rejects the entire refresh instead of returning partial success',async()=>{
  const failure=new Error('The second page failed');
  const previous={posts:alerts(100,80),total:80,nextOffset:null};
  let displayed=previous;
  const calls=[];
  const refresh=async()=>{displayed=await readFoodPages(async offset=>{calls.push(offset);if(offset===40)throw failure;return {posts:alerts(0,40),total:80,nextOffset:40};},80);};
  await assert.rejects(refresh,error=>error===failure);
  assert.deepEqual(calls,[0,40]);assert.equal(displayed,previous);assert.equal(displayed.posts[0].id,'food-100');
});

test('malformed page data is rejected before it can replace the displayed feed',async()=>{
  const valid={posts:[{id:'a'}],total:1,nextOffset:null};
  for(const malformed of [null,{}, {...valid,posts:{}},{...valid,posts:[{id:7}]},{...valid,posts:[null]},...[-1,1.5,NaN,Infinity,'1'].map(total=>({...valid,total})),...[-1,0,0.5,NaN,Infinity,undefined,'40'].map(nextOffset=>({...valid,nextOffset}))]) {
    await assert.rejects(readFoodPages(async()=>malformed));
  }
});

test('repeated and regressive cursors reject without looping or exposing partial pages',async()=>{
  for(const nextOffset of [0,20,40]) {
    const calls=[];
    await assert.rejects(readFoodPages(async offset=>{calls.push(offset);return offset===0?{posts:alerts(0,40),total:100,nextOffset:40}:{posts:alerts(40,40),total:100,nextOffset};},120),/could not be refreshed/);
    assert.deepEqual(calls,[0,40]);
  }
});
