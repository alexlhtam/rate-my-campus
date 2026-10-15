import type { Database } from '../db';
import { askClaude, ProviderError } from "./providers";
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

export type Publication = (source: SourceEvent, extraction: Extraction | null) => Promise<{id: string | null; state: string}>;

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
    if (!task.extraction_json) {
      const result = await askClaude(page, config);
      await db.prepare("UPDATE freebie_tasks SET extraction_json = ?, claude_model = ? WHERE id = ?")
        .bind(JSON.stringify(result.extraction), result.model, task.id).run();
      return null;
    }
    stage = "publish";
    const extraction: Extraction = JSON.parse(task.extraction_json);
    const publication = publish ? await publish(source, extraction) : {id:null,state:"not_connected"};
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
        const tasks = (await db.prepare("SELECT * FROM freebie_tasks WHERE run_id = ? AND status = 'queued' ORDER BY ordinal LIMIT 3").bind(runId).all<TaskRow>()).results;
        const errors = await Promise.all(tasks.map(task => processEvent(db, task, run, config, publish)));
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
