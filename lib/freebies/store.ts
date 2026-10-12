import type { Database } from '../db';
import type { Dashboard, EventRecord, RunStatus, ScanRun, SourceEvent } from "./types";
import type { ProviderConfig } from "./providers";
import { londonDate } from "./ucl";

export interface RunRow {
  id: string; start_date: string; end_date: string; status: RunStatus;
  created_at: string; updated_at: string; next_page: number; exhausted: number;
  source_count: number; warnings_json: string; error: string | null;
  active_slot: number | null; lock_token: string | null; lock_until: number;
}

export interface TaskRow {
  id: string; run_id: string; event_id: string; source_json: string;
  page_json: string | null; jev_json: string | null; extraction_json: string | null;
  claude_model: string | null; status: EventRecord["status"]; error: string | null;
  failed_stage: EventRecord["failedStage"]; attempts: number; checked_at: string | null; published_post_id: string | null; publication_state: string | null;
}

export async function getRun(db: Database, id: string): Promise<RunRow | null> {
  return db.prepare("SELECT * FROM freebie_scans WHERE id = ?").bind(id).first<RunRow>();
}

export async function dashboard(db: Database, config: ProviderConfig, runId?: string): Promise<Dashboard> {
  const row = runId ? await getRun(db, runId) : await db.prepare("SELECT * FROM freebie_scans ORDER BY created_at DESC, ordinal DESC LIMIT 1").first<RunRow>();
  const tasks = row ? (await db.prepare("SELECT id, run_id, event_id, source_json, jev_json, extraction_json, claude_model, status, error, failed_stage, attempts, checked_at, published_post_id, publication_state FROM freebie_tasks WHERE run_id = ? ORDER BY ordinal").bind(row.id).all<TaskRow>()).results : [];
  const events: EventRecord[] = tasks.map(task => {
    const source: SourceEvent = JSON.parse(task.source_json);
    const jev = task.jev_json ? JSON.parse(task.jev_json) : null;
    return {
      ...source,
      status: task.status,
      jevScore: jev?.score ?? null, jevModel: jev?.model ?? null,
      claudeModel: task.claude_model,
      extraction: task.extraction_json ? JSON.parse(task.extraction_json) : null,
      error: task.error, failedStage: task.failed_stage, attempts: task.attempts,
      checkedAt: task.checked_at, publishedPostId: task.published_post_id, publicationState: task.publication_state,
    };
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
  if(row){
    const publications=await db.prepare('SELECT p.id,p.status FROM posts p JOIN freebie_tasks t ON t.published_post_id=p.id WHERE t.run_id=?').bind(row.id).all<{id:string;status:string}>();
    const status=new Map(publications.results.map(post=>[post.id,post.status]));
    for(const event of events){
      const current=event.publishedPostId?status.get(event.publishedPostId):undefined;
      if(current)event.publicationState=current==='approved'?'published':current==='pending'?'needs_review':'held_by_moderator';
    }
  }
  let run: ScanRun | null = null;
  if (row) {
    const count = (status: EventRecord["status"]) => events.filter(event => event.status === status).length;
    const queued = count("queued");
    const failed = count("failed");
    const warnings = JSON.parse(row.warnings_json) as string[];
    run = {
      id: row.id, startDate: row.start_date, endDate: row.end_date, status: row.status,
      createdAt: row.created_at, updatedAt: row.updated_at,
      discovered: events.length, processed: events.length - queued - failed,
      found: count("found"), failed, queued, rejected: count("no_freebies"), needsReview: count("needs_review"),
      sourcePages: row.next_page, sourceCount: row.source_count,
      coverageComplete: !!row.exhausted && queued === 0 && failed === 0 && warnings.length === 0,
      error: row.error, warnings,
    };
  }
  return {
    configured: { jev: !!config.jevKey, claude: !!config.claudeKey },
    models: { jev: config.jevModel, claude: config.claudeModel },
    defaultStart: londonDate(), threshold: config.threshold, run, events,
  };
}

export async function insertEvents(db: Database, runId: string, events: SourceEvent[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < events.length; i += 40) {
    const statements = events.slice(i, i + 40).map(event => db.prepare(
      "INSERT INTO freebie_tasks (id, run_id, event_id, source_json) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, event_id) DO NOTHING RETURNING id"
    ).bind(`${runId}:${event.id}`, runId, event.id, JSON.stringify(event)));
    const results = await db.batch(statements);
    added += results.reduce((sum, result) => sum + result.results.length, 0);
  }
  return added;
}

export async function acquireLock(db: Database, runId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const result = await db.prepare("UPDATE freebie_scans SET lock_token = ?, lock_until = ? WHERE id = ? AND lock_until < ? RETURNING id")
    .bind(token, now + 360000, runId, now).first();
  return result ? token : null;
}

export async function releaseLock(db: Database, runId: string, token: string) {
  await db.prepare("UPDATE freebie_scans SET lock_token = NULL, lock_until = 0 WHERE id = ? AND lock_token = ?").bind(runId, token).run();
}
