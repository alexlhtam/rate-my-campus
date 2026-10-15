import type { Database } from '../db';
import { ProviderError } from "./providers";
import {askClaudeBatch,selectBatch,reusableCheckpoint,readCheckpoint,extractionOnly,type ImportVerdict,type BatchItem} from './batch';
import type { ProviderConfig } from "./providers";
import type { EventPage, SourceEvent, Extraction } from "./types";
import { addDays, discoverPage, fetchEventPage, londonDate, londonMidnight } from "./ucl";
import { acquireLock, dashboard, getRun, insertEvents, releaseLock } from "./store";
import type { RunRow, TaskRow } from "./store";

export class ScanError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function safeError(error: unknown): string {
  // Provider bodies and request headers never enter the persistent audit log.
  const message = error instanceof Error ? error.message : "An unexpected event-processing error occurred.";
  return message.replace(/(?:sk-ant-|apikey_)[A-Za-z0-9_\\-]+/g, "[redacted]").slice(0, 500);
}

export function validateStart(input: unknown): string {
  const start = input === undefined ? londonDate() : input;
  if (typeof start !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(start)) throw new ScanError("Choose a valid start date.");
  const date = new Date(`${start}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start) throw new ScanError("Choose a valid start date.");
  return start;
}

async function startScan(db: Database, startDate: string) {
  const active = await db.prepare("SELECT * FROM freebie_scans WHERE active_slot = 1 LIMIT 1").first<RunRow>();
  if (active) {
    if (active.start_date !== startDate) throw new ScanError("A scan is already in progress. Finish it before starting a different date range.", 409);
    return active.id;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.prepare("INSERT INTO freebie_scans (id, start_date, end_date, status, created_at, updated_at, active_slot) VALUES (?, ?, ?, 'discovering', ?, ?, 1)")
      .bind(id, startDate, addDays(startDate, 14), now, now).run();
  } catch {
    const existing = await db.prepare("SELECT id FROM freebie_scans WHERE active_slot = 1").first<{ id: string }>();
    if (existing) throw new ScanError("Another scan was just started. Refresh to continue it.", 409);
    throw new ScanError("The scan could not be saved. Please try again.", 503);
  }
  return id;
}

async function discover(db: Database, run: RunRow) {
  if (run.next_page >= 150) throw new ScanError("The source kept returning pages without ending. Coverage is incomplete; inspect the calendar feed before retrying.");
  const result = await discoverPage(run.start_date, run.end_date, run.next_page);
  if (run.source_count + result.rawCount > 10000) throw new ScanError("The source exceeded 10,000 rows. Coverage is incomplete; narrow or inspect the source before retrying.");
  await insertEvents(db, run.id, result.events);
  const warnings = [...new Set([...(JSON.parse(run.warnings_json) as string[]), ...result.warnings])];
  await db.prepare("UPDATE freebie_scans SET next_page = next_page + 1, source_count = source_count + ?, exhausted = ?, status = ?, warnings_json = ?, updated_at = ?, error = NULL WHERE id = ?")
    .bind(result.rawCount, result.done ? 1 : 0, result.done ? "running" : "discovering", JSON.stringify(warnings), new Date().toISOString(), run.id).run();
}

export type Publication = (source: SourceEvent, extraction: Extraction | null, moderation?:ImportVerdict) => Promise<{id: string | null; state: string}>;

async function processEvent(db: Database, task: TaskRow, run: RunRow, config: ProviderConfig, publish?: Publication): Promise<ProviderError | null> {
  let stage: "fetch" | "jev" | "claude" | "publish" = "fetch";
  const checkedAt = () => new Date().toISOString();
  await db.prepare("UPDATE freebie_tasks SET attempts = attempts + 1, error = NULL, failed_stage = NULL WHERE id = ?").bind(task.id).run();
  try {
    const source = JSON.parse(task.source_json) as SourceEvent;
    let page: EventPage;
    if (task.page_json) page = JSON.parse(task.page_json);
    else {
      page = await fetchEventPage(source);
      await db.prepare("UPDATE freebie_tasks SET page_json = ? WHERE id = ?").bind(JSON.stringify(page), task.id).run();
      // Re-read public pages to detect edits, but reuse paid results only when
      // the full input, model and moderation policy are exactly unchanged.
      const prior=await db.prepare('SELECT extraction_json FROM freebie_tasks WHERE event_id=? AND id<>? AND extraction_json IS NOT NULL ORDER BY ordinal DESC LIMIT 3').bind(task.event_id,task.id).all<{extraction_json:string}>();
      for(const row of prior.results){
        const cached=reusableCheckpoint(JSON.parse(row.extraction_json),{id:task.id,source,page},config.claudeModel);
        if(cached){await db.prepare('UPDATE freebie_tasks SET extraction_json=?,claude_model=? WHERE id=?').bind(JSON.stringify(cached),config.claudeModel,task.id).run();break;}
      }
      return null; // One persisted stage per request keeps hosting deadlines bounded.
    }
    // The listing occurrence is authoritative for recurrence selection. A page's
    // generic parent-product date must not discard another listed occurrence.
    const start = Date.parse(source.start);
    const end = source.end ? Date.parse(source.end) : start;
    if (start >= londonMidnight(run.end_date).getTime() || end < londonMidnight(run.start_date).getTime()) {
      await db.prepare("UPDATE freebie_tasks SET status = 'out_of_window', checked_at = ? WHERE id = ?").bind(checkedAt(), task.id).run();
      return null;
    }
    // Every listing needs complete event details. A legacy Jev score only
    // estimates freebie likelihood and must not omit an ordinary event.
    stage = "claude";
    if (!task.extraction_json) throw new Error('The event is waiting for a batch extraction.');
    stage = "publish";
    const saved = JSON.parse(task.extraction_json);
    const extraction: Extraction = extractionOnly(saved);
    const checkpoint=readCheckpoint(saved);
    const publication = publish ? await publish(source, extraction,checkpoint?._processing.moderation) : {id:null,state:"not_connected"};
    const status = !extraction.hasFreebies ? "no_freebies" : extraction.freebies.some(item => item.certainty === "confirmed") ? "found" : "needs_review";
    await db.prepare("UPDATE freebie_tasks SET status = ?, checked_at = ?, published_post_id = ?, publication_state = ? WHERE id = ?")
      .bind(status, checkedAt(), publication.id, publication.state, task.id).run();
    return null;
  } catch (error) {
    await db.prepare("UPDATE freebie_tasks SET status = 'failed', error = ?, failed_stage = ?, checked_at = ? WHERE id = ?")
      .bind(safeError(error), stage, checkedAt(), task.id).run();
    return error instanceof ProviderError && error.fatal ? error : null;
  }
}

async function processBatch(db:Database,tasks:TaskRow[],config:ProviderConfig):Promise<ProviderError|null>{
  const items=selectBatch(tasks.map(task=>({id:task.id,source:JSON.parse(task.source_json),page:JSON.parse(task.page_json!),attempts:task.attempts} as BatchItem)));
  for(const item of items)await db.prepare('UPDATE freebie_tasks SET attempts=attempts+1,error=NULL,failed_stage=NULL WHERE id=?').bind(item.id).run();
  try{
    const result=await askClaudeBatch(items,config);
    for(const item of items){
      const row=result.get(item.id)!;
      if(row.checkpoint)await db.prepare('UPDATE freebie_tasks SET extraction_json=?,claude_model=? WHERE id=?').bind(JSON.stringify(row.checkpoint),config.claudeModel,item.id).run();
      else await db.prepare("UPDATE freebie_tasks SET status='failed',error=?,failed_stage='claude',checked_at=? WHERE id=?").bind(row.error,new Date().toISOString(),item.id).run();
    }
    return null;
  }catch(error){
    for(const item of items)await db.prepare("UPDATE freebie_tasks SET status='failed',error=?,failed_stage='claude',checked_at=? WHERE id=?").bind(safeError(error),new Date().toISOString(),item.id).run();
    return error instanceof ProviderError&&error.fatal?error:null;
  }
}

async function settleRun(db: Database, runId: string) {
  const counts = await db.prepare("SELECT SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM freebie_tasks WHERE run_id = ?")
    .bind(runId).first<{ queued: number | null; failed: number | null }>();
  if (!counts?.queued) {
    const run = await getRun(db, runId);
    if (run?.exhausted) {
      const partial = (counts?.failed ?? 0) > 0 || JSON.parse(run.warnings_json).length > 0;
      await db.prepare("UPDATE freebie_scans SET status = ?, active_slot = NULL, updated_at = ? WHERE id = ?")
        .bind(partial ? "partial" : "complete", new Date().toISOString(), runId).run();
    }
  }
}

export async function actOnScan(db: Database, config: ProviderConfig, body: Record<string, unknown>, publish?: Publication) {
  const action = body.action;
  if (!["start", "step", "pause", "resume", "retry", "recheck"].includes(String(action))) throw new ScanError("Unknown scan action.");
  if (action !== "pause" && !config.claudeKey) throw new ScanError("Set ANTHROPIC_API_KEY in the server environment before importing.", 503);
  if (action === "start") {
    const id = await startScan(db, validateStart(body.startDate));
    return dashboard(db, config, id);
  }
  if (typeof body.runId !== "string" || body.runId.length > 80) throw new ScanError("A valid scan ID is required.");
  const runId = body.runId;
  const token = await acquireLock(db, runId);
  if (!token) {
    if (!await getRun(db, runId)) throw new ScanError("This scan was not found.", 404);
    throw new ScanError("A batch is still running. Its progress will appear shortly.", 409);
  }
  try {
    const run = await getRun(db, runId);
    if (!run) throw new ScanError("This scan was not found.", 404);
    if (action === "pause") {
      if (["discovering", "running"].includes(run.status)) {
        await db.prepare("UPDATE freebie_scans SET status = 'paused', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), runId).run();
      }
    } else if (action === "resume" || action === "retry" || action === "recheck") {
      const active = await db.prepare("SELECT id FROM freebie_scans WHERE active_slot = 1 AND id <> ?").bind(runId).first();
      if (active) throw new ScanError("Another scan is active. Finish it before resuming this scan.", 409);
      if (action === "retry") {
        // Checkpoints preserve successful fetches and Jev scores. Only the
        // failed stage is repeated, avoiding unnecessary calls and charges.
        await db.prepare("UPDATE freebie_tasks SET status = 'queued', error = NULL, failed_stage = NULL WHERE run_id = ? AND status = 'failed'").bind(runId).run();
      }
      if (action === "recheck") {
        // Recheck all saved listings, including legacy Jev exclusions, so an
        // earlier freebie-only scan can produce complete event classifications.
        await db.prepare("UPDATE freebie_tasks SET status = 'queued', extraction_json = NULL, claude_model = NULL, error = NULL, failed_stage = NULL WHERE run_id = ? AND (extraction_json IS NOT NULL OR failed_stage = 'claude' OR status = 'no_freebies')").bind(runId).run();
      }
      if (["paused", "failed", "partial", "running", "discovering"].includes(run.status) || (action === "recheck" && run.status === "complete")) {
        await db.prepare("UPDATE freebie_scans SET status = ?, active_slot = 1, error = NULL, updated_at = ? WHERE id = ?")
          .bind(run.exhausted ? "running" : "discovering", new Date().toISOString(), runId).run();
      }
    } else if (action === "step" && ["discovering", "running"].includes(run.status)) {
      if (!run.exhausted) {
        try { await discover(db, run); }
        catch (error) {
          await db.prepare("UPDATE freebie_scans SET status = 'failed', error = ?, active_slot = NULL, updated_at = ? WHERE id = ?")
            .bind(safeError(error), new Date().toISOString(), runId).run();
        }
      } else {
        const queued = (await db.prepare("SELECT * FROM freebie_tasks WHERE run_id = ? AND status = 'queued' ORDER BY ordinal LIMIT 30").bind(runId).all<TaskRow>()).results;
        const tasks:TaskRow[]=[];
        // Ended occurrences never need an article fetch or a paid AI call.
        for(const task of queued){
          const source:SourceEvent=JSON.parse(task.source_json),end=source.end?Date.parse(source.end):NaN;
          if(Number.isFinite(end)&&end<=Date.now()||Date.parse(source.start)>=londonMidnight(run.end_date).getTime()){
            await db.prepare("UPDATE freebie_tasks SET status='out_of_window',publication_state='expired',checked_at=? WHERE id=?").bind(new Date().toISOString(),task.id).run();
          }else tasks.push(task);
        }
        const ready=tasks.filter(task=>task.extraction_json);
        const unfetched=tasks.filter(task=>!task.page_json);
        // Fill a text-bounded batch before paying for extraction. Fetching and
        // publication still run three at a time to be gentle on public sources.
        const errors = ready.length?await Promise.all(ready.slice(0,3).map(task=>processEvent(db,task,run,config,publish)))
          :unfetched.length?await Promise.all(unfetched.slice(0,3).map(task=>processEvent(db,task,run,config,publish)))
          :tasks.length?[await processBatch(db,tasks,config)]:[];
        const fatal = errors.find(Boolean);
        if (fatal) {
          await db.prepare("UPDATE freebie_scans SET status = 'paused', error = ?, updated_at = ? WHERE id = ?").bind(safeError(fatal), new Date().toISOString(), runId).run();
        } else await settleRun(db, runId);
      }
      await db.prepare("UPDATE freebie_scans SET updated_at = ? WHERE id = ?").bind(new Date().toISOString(), runId).run();
    }
  } finally { await releaseLock(db, runId, token); }
  return dashboard(db, config, runId);
}
