import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022};
async function moduleURL(name,imports={}){
  let source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
  for(const [from,to] of Object.entries(imports))source=source.replaceAll(`'./${from}'`,`'${to}'`).replaceAll(`"./${from}"`,`"${to}"`);
  return 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:options}).outputText).toString('base64');
}
const foodURL=await moduleURL('food');
const validationURL=await moduleURL('community-validation',{food:foodURL});
const {demoFoodPost,updateDemoFood,demoFoodFeedback,withDemoFoodFeedback}=await import(await moduleURL('demo-food',{food:foodURL,'community-validation':validationURL}));
const {foodAvailability}=await import(foodURL);
const now=Date.parse('2026-10-12T12:00:00Z');
const draft={title:'Spare boxed lunches',description:'Left after our society talk.',location:'Student Centre foyer',lat:51.5246,lng:-.134,dietary:[],collectionInstructions:'Ask at the society table by reception.',portionsRemaining:8,foodDetails:{allergenStatus:'unknown'},foodSafetyAcknowledged:true,locationConfirmed:true,expiresAt:new Date(now+45*60000).toISOString()};
const create=(changes={})=>demoFoodPost({...draft,...changes},'demo-food-test',now);
const state=(changes={})=>({posts:[create(changes)],votes:{},foodFeedback:{}});

test('private food creation shares the live required confirmations and input validation',()=>{
  const post=create({image:'data:image/jpeg;base64,YQ=='});
  assert.equal(post.type,'food');assert.equal(post.own,true);assert.equal(post.demo,true);assert.equal(post.status,'approved');assert.equal(post.revision,0);assert.equal(post.portionsRemaining,8);assert.equal(post.image,'data:image/jpeg;base64,YQ==');
  for(const changes of [{locationConfirmed:false},{locationConfirmed:'true'},{foodSafetyAcknowledged:false},{collectionInstructions:''},{portionsRemaining:0},{portionsRemaining:'8'},{portionsRemaining:1.5},{lat:0},{expiresAt:new Date(now+7*3600000).toISOString()},{startsAt:new Date(now+60000).toISOString()}])assert.throws(()=>create(changes));
  assert.equal(create({portionsRemaining:null}).portionsRemaining,null);
});

test('availability edits require a numeric current revision and clear older feedback without extending expiry',()=>{
  const original=state();original.foodFeedback['demo-food-test']={kind:'gone',at:now};
  const updated=updateDemoFood(original,{action:'food-availability',targetId:'demo-food-test',revision:0,portionsRemaining:3},now+1000);
  const post=updated.posts[0];
  assert.equal(post.portionsRemaining,3);assert.equal(post.revision,1);assert.equal(post.expiresAt,draft.expiresAt);assert.equal(post.freshGoneCount,0);assert.equal(updated.foodFeedback['demo-food-test'],undefined);assert.equal(original.posts[0].portionsRemaining,8);
  for(const revision of [0,'1',null,1.5,-1])assert.throws(()=>updateDemoFood(updated,{action:'food-availability',targetId:post.id,revision,portionsRemaining:4},now+2000));
  const second=updateDemoFood(updated,{action:'food-availability',targetId:post.id,revision:1,portionsRemaining:null},now+2000);
  assert.equal(second.posts[0].portionsRemaining,null);assert.equal(second.posts[0].revision,2);
});

test('zero closes food and closed or expired pickups cannot be reopened with an availability update',()=>{
  const closed=updateDemoFood(state(),{action:'food-availability',targetId:'demo-food-test',revision:0,portionsRemaining:0},now+1000);
  assert.equal(closed.posts[0].closureReason,'collected');assert.equal(foodAvailability(closed.posts[0],now+1000).available,false);
  assert.throws(()=>updateDemoFood(closed,{action:'food-availability',targetId:'demo-food-test',revision:1,portionsRemaining:5},now+2000),/ended or changed/);
  assert.throws(()=>updateDemoFood(state(),{action:'food-availability',targetId:'demo-food-test',revision:0,portionsRemaining:5},now+46*60000),/ended or changed/);
  assert.throws(()=>updateDemoFood(state(),{action:'update-post',targetId:'demo-food-test',revision:0,collectionInstructions:'New pickup point',foodDetails:{},portionsRemaining:5},now+46*60000),/ended or changed/);
});

test('owner close is idempotent and non-owner demo posts cannot be edited',()=>{
  const closed=updateDemoFood(state(),{action:'close-post',targetId:'demo-food-test',reason:'withdrawn'},now+1000);
  const retried=updateDemoFood(closed,{action:'close-post',targetId:'demo-food-test',reason:'collected'},now+2000);
  assert.equal(retried,closed);assert.equal(retried.posts[0].closureReason,'withdrawn');assert.equal(retried.posts[0].revision,1);
  assert.throws(()=>updateDemoFood({posts:[{...create(),own:false}]},{action:'close-post',targetId:'demo-food-test',reason:'ended'},now),/not one of your/);
  assert.throws(()=>updateDemoFood(state(),{action:'close-post',targetId:'missing',reason:'ended'},now));
});

test('pickup detail edits validate instructions and allergen claims and preserve the collection deadline',()=>{
  const original=state();
  const changed=updateDemoFood(original,{action:'update-post',targetId:'demo-food-test',revision:0,collectionInstructions:'Collect from the main reception desk.',portionsRemaining:4,foodDetails:{allergenStatus:'provided',allergens:['milk'],pickupAccess:'ucl',bringContainer:true}},now+1000);
  assert.equal(changed.posts[0].foodDetails.allergens[0],'milk');assert.equal(changed.posts[0].collectionInstructions,'Collect from the main reception desk.');assert.equal(changed.posts[0].expiresAt,draft.expiresAt);
  assert.throws(()=>updateDemoFood(original,{action:'update-post',targetId:'demo-food-test',revision:0,collectionInstructions:'No',portionsRemaining:4},now+1000));
  assert.throws(()=>updateDemoFood(original,{action:'update-post',targetId:'demo-food-test',revision:0,collectionInstructions:'Collect from reception.',portionsRemaining:4,foodDetails:{allergenStatus:'unknown',allergens:['milk']}},now+1000));
});

test('pending owner details can be corrected without publishing the alert or enabling availability controls',()=>{
  const original=state();original.posts[0].status='pending';
  const changed=updateDemoFood(original,{action:'update-post',targetId:'demo-food-test',revision:0,foodDetails:{allergenStatus:'provided',allergens:['milk']}},now+1000);
  const post=changed.posts[0];
  assert.equal(post.status,'pending');assert.equal(foodAvailability(post,now+1000).available,false);
  assert.equal(post.revision,1);assert.deepEqual(post.foodDetails.allergens,['milk']);
  assert.equal(post.collectionInstructions,draft.collectionInstructions);assert.equal(post.portionsRemaining,8);assert.equal(post.expiresAt,draft.expiresAt);
  assert.throws(()=>updateDemoFood(changed,{action:'food-availability',targetId:post.id,revision:1,portionsRemaining:4},now+2000),/ended or changed/);
  assert.throws(()=>updateDemoFood(changed,{action:'update-post',targetId:post.id,revision:0,collectionInstructions:'Collect at reception.'},now+2000),/ended or changed/);
  assert.throws(()=>updateDemoFood(changed,{action:'update-post',targetId:post.id,revision:1,collectionInstructions:'Collect at reception.'},now+46*60000),/ended or changed/);
});

test('partial pickup detail edits preserve omitted values but explicit unknown quantity is respected',()=>{
  const original=state();
  const changed=updateDemoFood(original,{action:'update-post',targetId:'demo-food-test',revision:0,collectionInstructions:'Collect from the society table.'},now+1000);
  assert.equal(changed.posts[0].portionsRemaining,8);assert.equal(changed.posts[0].foodDetails.allergenStatus,'unknown');
  const unknown=updateDemoFood(changed,{action:'update-post',targetId:'demo-food-test',revision:1,portionsRemaining:null},now+2000);
  assert.equal(unknown.posts[0].portionsRemaining,null);assert.equal(unknown.posts[0].collectionInstructions,'Collect from the society table.');
  assert.throws(()=>updateDemoFood(original,{action:'food-availability',targetId:'demo-food-test',revision:0},now+1000),/quantity/);
  assert.equal(original.posts[0].portionsRemaining,8);
});

test('one demo participant can change their feedback but cannot create a gone quorum',()=>{
  const post={...create(),own:false};
  const once=demoFoodFeedback({posts:[],votes:{},foodFeedback:{}},post,'gone',now+1000);
  const twice=demoFoodFeedback(once,post,'gone',now+2000);
  const shown=withDemoFoodFeedback(post,twice.foodFeedback[post.id],now+2000);
  assert.equal(shown.freshGoneCount,1);assert.equal(shown.freshStillCount,0);assert.equal(foodAvailability(shown,now+2000).available,true);
  const corrected=demoFoodFeedback(twice,post,'still',now+3000);
  const correctedPost=withDemoFoodFeedback(post,corrected.foodFeedback[post.id],now+3000);
  assert.equal(correctedPost.freshStillCount,1);assert.equal(correctedPost.freshGoneCount,0);assert.equal(corrected.votes[post.id],'still');
  assert.throws(()=>demoFoodFeedback(once,{...post,own:true},'still',now+3000),/pickup controls/);
  assert.throws(()=>demoFoodFeedback(once,post,'helpful',now+3000));
  assert.throws(()=>demoFoodFeedback(once,{...post,closedAt:new Date(now).toISOString()},'still',now+3000),/no longer available/);
});

test('community feedback expires after thirty minutes and cannot survive an owner update or invalid timestamp',()=>{
  const post={...create(),own:false};
  const feedback={kind:'still',at:now};
  assert.equal(withDemoFoodFeedback(post,feedback,now+30*60000-1).freshStillCount,1);
  assert.equal(withDemoFoodFeedback(post,feedback,now+30*60000).freshStillCount,0);
  assert.equal(withDemoFoodFeedback({...post,availabilityUpdatedAt:new Date(now+1).toISOString()},feedback,now+1000).freshStillCount,0);
  for(const at of [NaN,Infinity,1e300,'2026-10-12',now+60000]){
    const result=withDemoFoodFeedback(post,{kind:'gone',at},now);
    assert.equal(result.freshGoneCount,0);assert.equal(result.lastAvailabilityFeedbackAt,null);
  }
});
