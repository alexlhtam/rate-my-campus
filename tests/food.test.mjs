import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/food.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {FOOD_ALLERGENS,emptyFoodDetails,readFoodDetails,foodAvailability,foodMatches,foodQuantity,foodUpdatedLabel}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const now=Date.parse('2026-10-12T12:00:00Z');
const pickup={title:'Vegetarian pizza',description:'Left after the talk',location:'Student Centre',status:'approved',expiresAt:new Date(now+30*60000).toISOString(),createdAt:new Date(now-5*60000).toISOString(),dietary:['vegetarian'],foodDetails:{sourceLabel:'Chess Society'}};

test('the public food lifecycle excludes pending, hidden, upcoming, closed and expired alerts',()=>{
  assert.equal(foodAvailability(pickup,now).available,true);
  for(const [changes,state] of [[{status:'pending'},'pending'],[{status:'hidden'},'unavailable'],[{startsAt:new Date(now+60000).toISOString()},'upcoming'],[{closedAt:new Date(now).toISOString()},'closed'],[{closureReason:'withdrawn'},'closed'],[{portionsRemaining:0},'closed'],[{status:'gone'},'closed'],[{expiresAt:new Date(now).toISOString()},'expired'],[{expiresAt:'invalid'},'expired']]){
    const status=foodAvailability({...pickup,...changes},now);
    assert.equal(status.state,state);
    assert.equal(status.available,false);
    assert.equal(foodMatches({...pickup,...changes},{},now),false);
  }
  assert.equal(foodAvailability({...pickup,status:'pending',closureReason:'withdrawn'},now).label,'Withdrawn');
  assert.equal(foodAvailability({...pickup,status:'pending',expiresAt:new Date(now).toISOString()},now).label,'Collection ended');
});

test('countdowns close at the exact deadline and mark only available food as ending soon',()=>{
  const exact={...pickup,expiresAt:new Date(now+10*60000).toISOString()};
  assert.equal(foodAvailability(exact,now).label,'10:00 left');
  assert.equal(foodAvailability(exact,now).endingSoon,true);
  assert.equal(foodAvailability(exact,now-1).endingSoon,false);
  assert.equal(foodAvailability(exact,now+10*60000).state,'expired');
  assert.equal(foodAvailability({...exact,status:'pending'},now).endingSoon,false);
  assert.equal(foodAvailability({...pickup,expiresAt:new Date(now+90*60000).toISOString()},now).label,'1h 30m left');
});

test('allergen decoding keeps uncertainty explicit and accepts only the fourteen known keys',()=>{
  assert.equal(FOOD_ALLERGENS.length,14);
  assert.equal(new Set(FOOD_ALLERGENS.map(row=>row.id)).size,14);
  for(const input of [undefined,null,[],{},'provided',{allergenStatus:'provided',allergens:[],ingredients:'  '},{allergenStatus:'provided',allergens:['wheat','nuts']}])assert.equal(readFoodDetails(input).allergenStatus,'unknown');
  const supplied=readFoodDetails({allergenStatus:'provided',allergens:['milk','milk','cereals-gluten','invented'],ingredients:' wheat, milk ',pickupAccess:'public',bringContainer:true});
  assert.deepEqual(supplied.allergens,['milk','cereals-gluten']);
  assert.equal(supplied.ingredients,'wheat, milk');
  assert.equal(supplied.allergenStatus,'provided');
  assert.equal(supplied.pickupAccess,'public');
  assert.equal(readFoodDetails({allergenStatus:'provided',ingredients:'Sealed fruit bag'}).allergenStatus,'provided');
  assert.deepEqual(readFoodDetails({allergenStatus:'unknown',allergens:['milk']}).allergens,[]);
  const malformed=readFoodDetails({sourceLabel:{},handling:'a'.repeat(500),ingredients:'b'.repeat(600),pickupAccess:'all',bringContainer:'true'});
  assert.equal(malformed.handling.length,300);assert.equal(malformed.ingredients.length,500);assert.equal(malformed.sourceLabel,'');assert.equal(malformed.pickupAccess,'ask');assert.equal(malformed.bringContainer,false);
  const blank=emptyFoodDetails();blank.allergens.push('milk');assert.deepEqual(emptyFoodDetails().allergens,[]);
});

test('food filters combine every search term, declared dietary claim, distance and expiry',()=>{
  assert.equal(foodMatches(pickup,{query:'pizza chess centre',dietary:'vegetarian',maxDistance:1,distance:()=>.5},now),true);
  assert.equal(foodMatches(pickup,{query:'pizza chess library'},now),false);
  assert.equal(foodMatches(pickup,{dietary:'vegan'},now),false);
  assert.equal(foodMatches({...pickup,dietary:['Vegetarian']},{dietary:'vegetarian'},now),true);
  assert.equal(foodMatches({...pickup,dietary:'vegan'},{dietary:'vegan'},now),false);
  assert.equal(foodMatches(pickup,{endingSoon:true},now),false);
  assert.equal(foodMatches({...pickup,expiresAt:new Date(now+60000).toISOString()},{endingSoon:true},now),true);
  for(const distance of [undefined,NaN,Infinity,-1,1.01])assert.equal(foodMatches(pickup,{maxDistance:1,distance:distance===undefined?undefined:()=>distance},now),false);
  assert.equal(foodMatches(pickup,{maxDistance:1,distance:()=>1},now),true);
});

test('quantity and freshness labels do not invent missing estimates',()=>{
  assert.equal(foodQuantity({portionsRemaining:1}),'About 1 portion');
  assert.equal(foodQuantity({portionsRemaining:0}),'About 0 portions');
  for(const portionsRemaining of [undefined,null,'4',NaN,-1,1.5])assert.equal(foodQuantity({portionsRemaining}),'Quantity not specified');
  assert.equal(foodUpdatedLabel({},now),'Availability not recently confirmed');
  assert.equal(foodUpdatedLabel(pickup,now),'Sharer updated 5 min ago');
  assert.equal(foodUpdatedLabel({...pickup,availabilityUpdatedAt:new Date(now-20000).toISOString()},now),'Sharer updated just now');
});
