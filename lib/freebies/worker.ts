import type {Database} from '../db';
import {actOnScan,type Publication} from './pipeline';
import type {ProviderConfig} from './providers';
import type {RunRow} from './store';

/** One bounded worker invocation. All stages survive process restarts. */
export async function workFreebies(db:Database,config:ProviderConfig,publish:Publication,options:{budgetMs?:number;sleep?:(ms:number)=>Promise<void>;now?:()=>number}={}){
  const now=options.now||Date.now,sleep=options.sleep||((ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)));
  const token=crypto.randomUUID(),begin=now();
  const lock=await db.prepare("UPDATE freebie_worker SET lock_token=?,lock_until=? WHERE id='union' AND lock_until < ? RETURNING id").bind(token,begin+360000,begin).first();
  if(!lock)return {busy:true,more:false};
  try{
    // Delete expired Google coordinates, retaining only place IDs for identity.
    await db.prepare('UPDATE freebie_venues SET lat=NULL,lng=NULL WHERE expires_at<=? AND lat IS NOT NULL').bind(now()).run();
    await db.prepare("UPDATE posts SET lat=NULL,lng=NULL WHERE freebie_json IS NOT NULL AND freebie_json::jsonb->>'locationProvider'='google' AND COALESCE((freebie_json::jsonb->>'locationValidUntil')::bigint,0)<=?").bind(now()).run();
    await db.prepare("UPDATE freebie_tasks SET page_json=NULL WHERE id IN (SELECT t.id FROM freebie_tasks t JOIN freebie_scans s ON t.run_id=s.id WHERE s.active_slot IS NULL AND s.updated_at < ? AND t.status IN ('found','no_freebies','out_of_window') AND t.page_json IS NOT NULL LIMIT 250)").bind(new Date(now()-30*86400000).toISOString()).run();
    let run=await db.prepare("SELECT * FROM freebie_scans WHERE active_slot=1 OR (status IN ('failed','partial','paused') AND auto_retries<2) ORDER BY (active_slot=1) DESC NULLS LAST,ordinal DESC LIMIT 1").first<RunRow&{auto_retries:number}>();
    if(!run)return {busy:false,more:false};
    const id=run.id;
    // Never resurrect older partial scans once a later import has superseded them.
    if(run.active_slot!==1){
      const newer=await db.prepare('SELECT id FROM freebie_scans WHERE ordinal > (SELECT ordinal FROM freebie_scans WHERE id=?) LIMIT 1').bind(id).first();
      if(newer)return {busy:false,more:false};
    }
    for(let step=0;step<80&&now()-begin<(options.budgetMs??65000);step++){
      if(['failed','partial','paused'].includes(run.status)){
        if(run.auto_retries>=2)break;
        await db.prepare('UPDATE freebie_scans SET auto_retries=auto_retries+1 WHERE id=?').bind(id).run();
        await sleep(1000);
        await actOnScan(db,config,{action:'retry',runId:id},publish);
      }else if(run.status==='complete')break;
      await actOnScan(db,config,{action:'step',runId:id},publish);
      run=(await db.prepare('SELECT * FROM freebie_scans WHERE id=?').bind(id).first<typeof run>())!;
      if(run.status==='complete')break;
      await sleep(1000); // At most one batch of three public pages each second.
    }
    const more=['running','discovering'].includes(run.status)||(['failed','partial','paused'].includes(run.status)&&run.auto_retries<2);
    return {busy:false,more,runId:id,status:run.status};
  }finally{
    await db.prepare("UPDATE freebie_worker SET lock_token=NULL,lock_until=0 WHERE id='union' AND lock_token=?").bind(token).run();
  }
}
