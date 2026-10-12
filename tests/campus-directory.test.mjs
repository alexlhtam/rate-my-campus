import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const catalog=JSON.parse(fs.readFileSync(new URL("../public/data/campus-directory.json",import.meta.url),"utf8"));
const ids=JSON.parse(fs.readFileSync(new URL("../work/campus-directory/official-building-ids.json",import.meta.url),"utf8"));
const byId=new Map(catalog.buildings.map(b=>[b.id,b]));
test("directory entries retain unique stable IDs and official provenance",()=>{
 assert.equal(byId.size,catalog.buildings.length);
 assert.ok(catalog.buildings.length>=150);
 for(const b of catalog.buildings){
  assert.match(b.id,/^ucl-[a-z0-9-]+$/);
  assert.ok(["bloomsbury","east","other"].includes(b.campus));
  assert.ok(b.name&&b.address&&b.membership.scope);
  assert.ok(b.officialSourceUrls.length);
  for(const url of b.officialSourceUrls)assert.ok(new URL(url).hostname==="www.ucl.ac.uk");
  assert.equal(b.coordinates,null,"No numeric official coordinates were established by this research.");
  for(const id of b.officialBuildingIds)assert.ok(ids.some(r=>r.id===id));
  assert.equal(b.officialBuildingId,b.officialBuildingIds.length===1?b.officialBuildingIds[0]:null);
 }
});
test("principal campus buildings carry verified UCL building IDs",()=>{
 for(const [id,official] of [["ucl-cruciform-building","212"],["ucl-wilkins-building","5"],["ucl-student-centre","51"],["ucl-marshgate","445"],["ucl-one-pool-street","444"]]){
  assert.equal(byId.get(id)?.officialBuildingId,official);
 }
 assert.deepEqual(catalog.buildings.filter(b=>b.campus==="east").map(b=>b.id).sort(),["ucl-marshgate","ucl-one-pool-street"]);
});
test("partner and partial sites do not imply exclusive UCL occupation",()=>{
 for(const id of ["ucl-garden-halls","ucl-college-hall","ucl-connaught-hall","ucl-international-hall","ucl-handel-mansions"]){
  assert.equal(byId.get(id)?.membership.status,"ucl-partner");
  assert.equal(byId.get(id)?.membership.scope,"shared-site");
 }
 assert.equal(byId.get("ucl-senate-house")?.membership.scope,"shared-site");
 assert.equal(byId.get("ucl-royal-free-hospital")?.membership.scope,"shared-site");
 assert.equal(byId.get("ucl-ucl-at-here-east")?.membership.scope,"part-of-building");
 assert.equal(byId.has("ucl-university-college-hospital"),false);
 assert.equal(byId.get("ucl-gower-street-115-117")?.relatedBuildingId,"ucl-arthur-tattersall-house");
});
