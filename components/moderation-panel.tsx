"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Copy, Flag, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import {FreebieFacts} from './freebie-events';
import type {EventPin} from '@/lib/freebies/view';
import { places } from "@/lib/data";
import { FOOD_ALLERGENS, readFoodDetails } from "@/lib/food";
import { categoryInfo, severityInfo } from "@/lib/incidents/model";

type Item = Partial<EventPin> & {
  id: string; kind: "review" | "post" | "thread" | "reply" | "incident";
  status: "approved" | "pending" | "hidden"; createdAt: string; moderationReason?: string;
  placeId?: string; title?: string; text?: string; description?: string;
  location?: string; photoUrl?: string; rating?: number; tags?: string[]; term?: string;
  type?: string; foodDetails?: unknown; collectionInstructions?: string; portionsRemaining?: number | null;
  dietary?: string[]; expiresAt?: string; category?: string; severity?: string; resolvedAt?: string | null;
};
type Report = { id: string; targetId: string; reason: string; createdAt: string };
type CommunityRequest = { id: string; kind: "correction" | "takedown"; contact?: string; targetId: string; reason: string; evidenceUrl?: string; createdAt: string };
type Queue = { queue: Item[]; reports: Report[]; requests?: CommunityRequest[] };

const styles = {
  card: { border: "1px solid #e4e3df", borderRadius: 15, padding: 18, background: "#fff", display: "grid", gap: 12 } as const,
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 9 } as const,
  muted: { fontSize: 12, color: "#737874" } as const,
  note: { background: "#f6f4ed", borderRadius: 9, padding: 12, fontSize: 13, lineHeight: 1.6 } as const,
};

export default function ModerationPanel({ onAccount }: { onAccount?: () => void }) {
  const [data, setData] = useState<Queue>({ queue: [], reports: [] });
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [takedownId, setTakedownId] = useState("");
  const [takedownNote, setTakedownNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/community/moderation", { cache: "no-store" });
      const body = await response.json() as Queue & { error?: string };
      if (!response.ok) {
        const denied = response.status === 401 || response.status === 403;
        setAccessDenied(denied);
        if (denied) {
          try {
            const stateResponse = await fetch("/api/community/state", { cache: "no-store" });
            if (stateResponse.ok) {
              const state = await stateResponse.json() as { profile?: { accountId?: string } };
              setAccountId(state.profile?.accountId || "");
            }
          } catch { /* The access explanation remains useful if account lookup fails. */ }
        }
        throw new Error(body.error || "The moderation queue could not be loaded.");
      }
      setAccessDenied(false); setData(body);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The moderation queue could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const reported = useMemo(() => new Set(data.reports.filter((report) => report.targetId !== "takedown").map((report) => report.targetId)), [data.reports]);
  const generalRequests = data.reports.filter((report) => report.targetId === "takedown");
  const visible = data.queue.filter((item) => filter === "all" || (filter === "reported" ? reported.has(item.id) : item.status === filter));

  async function decide(targetId: string, decision: "approve" | "hide", reason: string) {
    setBusy(targetId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/community/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: targetId.trim(), decision, reason: reason.trim() }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The moderation decision could not be saved.");
      setNotice(decision === "approve" ? "Approved. The contribution is now public and its reports have been resolved." : "Hidden. The contribution is no longer public and its reports have been resolved.");
      await load();
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The moderation decision could not be saved."); return false; }
    finally { setBusy(null); }
  }

  async function resolveGeneralRequest(reportId: string) {
    setBusy(reportId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/community/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId, decision: "resolve-report" }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The request could not be resolved.");
      setNotice("Request marked as resolved. This action does not hide or delete a contribution.");
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The request could not be resolved."); }
    finally { setBusy(null); }
  }

  async function resolveRequest(requestId: string) {
    setBusy(requestId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/community/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, decision: "resolve-request", reason: notes[requestId] || "" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The request could not be resolved.");
      setNotice(body.message); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(null); }
  }

  return <section aria-label="Community moderation" style={{ display: "grid", gap: 18 }}>
    <div>
      <div className="eyebrow"><ShieldCheck size={14} /> COMMUNITY CARE</div>
      <h2>Moderation &amp; reports</h2>
      <p style={{ color: "#66716c", fontSize: 14, lineHeight: 1.6 }}>Claude automatically checks and publishes safe contributions. This queue is for flagged content, interrupted checks and takedown reports. Pending and hidden content stays private.</p>
    </div>
    {error && <div role="alert" style={{ ...styles.note, background: "#fff0ec", color: "#943e32" }}>{error}</div>}
    {notice && <div role="status" style={{ ...styles.note, background: "#edf7ed", color: "#295a34" }}>{notice}</div>}
    {accessDenied ? <div style={styles.card}>
      <ShieldCheck size={24} />
      <h3>Moderator access required</h3>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>Sign in with the UCL email assigned as a campus moderator. Community reports and other students’ unpublished contributions are available only to moderators.</p>
      {accountId && <div style={styles.note}><strong>Your account reference</strong><p style={{ overflowWrap: "anywhere", userSelect: "all", margin: "7px 0" }}>{accountId}</p><p style={styles.muted}>The site owner can use this reference when assigning moderator access.</p><button className="button light small" onClick={async () => { try { await navigator.clipboard.writeText(accountId); setNotice("Account reference copied."); } catch { setNotice("Select the account reference above to copy it."); } }}><Copy size={13} /> Copy reference</button></div>}
      <div style={styles.row}>
        {onAccount && <button className="button dark small" onClick={onAccount}>Sign in with UCL email</button>}
        <button className="button light small" onClick={() => void load()}><RefreshCw size={14} /> Check access</button>
      </div>
    </div> : <>
      <div style={{ ...styles.row, justifyContent: "space-between" }}>
        <label style={styles.row}>Show
          <select aria-label="Filter moderation queue" value={filter} onChange={(event) => setFilter(event.target.value)} style={{ border: "1px solid #d9ded8", padding: "9px 12px", borderRadius: 8 }}>
            <option value="all">All items ({data.queue.length})</option>
            <option value="pending">Awaiting review ({data.queue.filter((item) => item.status === "pending").length})</option>
            <option value="reported">Reported ({reported.size})</option>
            <option value="hidden">Hidden ({data.queue.filter((item) => item.status === "hidden").length})</option>
          </select>
        </label>
        <button className="button light small" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Refresh</button>
      </div>
      {loading && data.queue.length === 0 ? <p role="status" style={styles.muted}>Loading the protected queue…</p> : visible.length === 0 && generalRequests.length === 0 && !data.requests?.length && !error ? <div style={{ ...styles.card, textAlign: "center", padding: 26 }}><Check size={26} style={{ margin: "auto", color: "#3a6c4d" }} /><h3>All clear here.</h3><p style={styles.muted}>No contributions match this view.</p></div> : null}
      {Boolean(data.requests?.length) && <section aria-label="Private requests and map corrections" style={{ display: "grid", gap: 12 }}><h3>Private requests &amp; map corrections</h3>{data.requests!.map((request) => <article key={request.id} style={styles.card}>
        <strong>{request.kind === "correction" ? "Map correction" : "Privacy / takedown request"}</strong><small>{request.targetId} · {new Date(request.createdAt).toLocaleDateString("en-GB")}</small>
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{request.reason}</p>
        {request.contact && <p style={{ overflowWrap: "anywhere" }}>Private follow-up contact: {request.contact}</p>}
        {request.evidenceUrl && <a href={request.evidenceUrl} target="_blank" rel="noreferrer">View submitted evidence (external website)</a>}
        <p style={styles.muted}>{request.kind === "correction" ? "Check the source, then make a reviewed catalogue change. Resolving this request does not change the map." : "Use the contribution reference below to hide content if needed. Resolve after handling the request."}</p>
        <label>Resolution note<textarea minLength={4} maxLength={500} rows={2} value={notes[request.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} style={{ width: "100%", border: "1px solid #d9ded8", borderRadius: 8, padding: 10 }} /></label>
        <button className="button light small" disabled={Boolean(busy) || (notes[request.id] || "").trim().length < 4} onClick={() => void resolveRequest(request.id)}>Mark resolved</button>
      </article>)}</section>}
      {generalRequests.length > 0 && <section aria-label="General privacy and takedown requests" style={{ display: "grid", gap: 12 }}><h3>Privacy &amp; takedown requests ({generalRequests.length})</h3>{generalRequests.map((report) => <article key={report.id} style={{ ...styles.card, background: "#fffbf2" }}><div style={styles.row}><Flag size={15} /><strong style={{ fontSize: 13 }}>General request</strong><time dateTime={report.createdAt} style={styles.muted}>{new Date(report.createdAt).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}</time></div><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14, lineHeight: 1.7 }}>{report.reason}</p><p style={styles.muted}>Review the request and use the contribution controls below if removal is needed. Mark it resolved after taking the appropriate action.</p><button className="button light small" disabled={Boolean(busy)} onClick={() => void resolveGeneralRequest(report.id)}>{busy === report.id ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Mark resolved</button></article>)}</section>}
      {visible.map((item) => {
        const reports = data.reports.filter((report) => report.targetId === item.id);
        const place = places.find((entry) => entry.id === item.placeId);
        const working = busy === item.id;
        const food = item.kind === "post" && item.type === "food" ? readFoodDetails(item.foodDetails) : null;
        return <article key={item.id} style={styles.card}>
          <div style={{ ...styles.row, justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, letterSpacing: ".07em", textTransform: "uppercase", color: "#53705b", fontWeight: 700 }}>{item.kind} · {item.status}{reports.length ? ` · ${reports.length} report${reports.length === 1 ? "" : "s"}` : ""}</span>
            <time dateTime={item.createdAt} style={styles.muted}>{new Date(item.createdAt).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" })}</time>
          </div>
          <h3 style={{ margin: 0, fontSize: 17 }}>{item.title || place?.name || (item.kind === "reply" ? "Discussion reply" : "Student review")}</h3>
          {item.kind === "incident" && <p style={{ ...styles.note, background: "#fdecec", color: "#8f1a1f" }}><strong>Incident report</strong> · {categoryInfo(item.category).label} · {severityInfo(item.severity).label}{item.expiresAt ? ` · live until ${new Date(item.expiresAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}` : ""}{item.resolvedAt ? " · already cleared" : ""}. Hiding an incident also ends it. Approve only if it describes a place and an event, not an identifiable person.</p>}
          {item.location && <p style={styles.muted}>{item.location}</p>}
          {item.rating && <span style={styles.muted}>{item.rating} / 5 · {item.term}</span>}
          <p style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.7 }}>{item.text || item.description || "No written review supplied."}</p>{item.freebie&&<><FreebieFacts pin={item as EventPin} expanded/>{item.sourceUrl&&<a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">Original Union listing</a>}</>}
          {food && <section aria-label="Food collection details" style={{ ...styles.note, display: "grid", gap: 10 }}>
            <strong>Food collection details</strong>
            <p style={styles.muted}>These are the sharer’s declarations. Moderation does not verify ingredients, allergen safety or storage conditions.</p>
            <dl style={{ display: "grid", gap: 10, margin: 0 }}>{[
              ["Collection instructions", item.collectionInstructions || "Not supplied"],
              ["Organisation or event (unverified)", food.sourceLabel || "Not supplied"],
              ["Allergen information", food.allergenStatus === "unknown" ? "Unknown" : food.allergens.length ? food.allergens.map((id) => FOOD_ALLERGENS.find((allergen) => allergen.id === id)?.label || id).join(", ") : "See ingredient information; no individual allergens listed"],
              ["Ingredients", food.ingredients || "Not supplied"],
              ["Storage and handling", food.handling || "Not supplied"],
              ["Dietary labels", item.dietary?.join(", ") || "Not supplied"],
              ["Collection access", food.pickupAccess === "ucl" ? "UCL access required" : food.pickupAccess === "public" ? "Public access declared" : "Ask the sharer"],
              ["Bring a container", food.bringContainer ? "Yes" : "Not requested"],
              ["Portions remaining", item.portionsRemaining == null ? "Unknown" : String(item.portionsRemaining)],
              ["Collection ends", item.expiresAt ? new Date(item.expiresAt).toLocaleString("en-GB", { timeZone: "Europe/London" }) : "Not supplied"],
            ].map(([label, value]) => <div key={label}><dt style={{ fontSize: 12, fontWeight: 700 }}>{label}</dt><dd style={{ margin: "3px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value}</dd></div>)}</dl>
          </section>}
          {item.tags?.length ? <p style={styles.muted}>{item.tags.join(" · ")}</p> : null}
          {item.photoUrl && <a href={item.photoUrl} target="_blank" rel="noreferrer"><img src={item.photoUrl} alt="Photo awaiting moderation" style={{ width: "100%", maxHeight: 280, objectFit: "contain", background: "#f6f6f1", borderRadius: 10 }} /></a>}
          {item.moderationReason && <p style={styles.note}><strong>Review note:</strong> {item.moderationReason}</p>}
          {reports.length > 0 && <div style={{ ...styles.note, background: "#fff3df" }}><strong style={styles.row}><Flag size={14} /> Community reports</strong>{reports.map((report) => <p key={report.id} style={{ marginTop: 7, whiteSpace: "pre-wrap" }}>{report.reason}</p>)}</div>}
          <label style={{ display: "grid", gap: 7, fontSize: 12, fontWeight: 600 }}>Decision note <span style={{ fontWeight: 400, color: "#737874" }}>Visible to the author; leave out private names and contact details.</span>
            <textarea rows={2} maxLength={500} value={notes[item.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Explain the decision or requested change…" style={{ width: "100%", border: "1px solid #d9ded8", borderRadius: 8, padding: 10, fontWeight: 400, resize: "vertical" }} />
          </label>
          <div style={styles.row}>
            <button className="button dark small" disabled={Boolean(busy)} onClick={() => void decide(item.id, "approve", notes[item.id] || "")}>{working ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{item.status === "approved" ? "Keep published & resolve" : "Approve"}</button>
            <button className="button light small" disabled={Boolean(busy)} onClick={() => void decide(item.id, "hide", notes[item.id] || "Hidden by a community moderator.")}><Trash2 size={14} />{item.status === "hidden" ? "Keep hidden & resolve" : "Hide contribution"}</button>
          </div>
          <span style={{ ...styles.muted, fontSize: 10, overflowWrap: "anywhere" }}>Reference: {item.id}</span>
        </article>;
      })}
      <details style={styles.card}>
        <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600 }}>Takedown by contribution reference <ChevronDown size={14} style={{ display: "inline", verticalAlign: "middle" }} /></summary>
        <form onSubmit={async (event) => { event.preventDefault(); if (await decide(takedownId, "hide", takedownNote)) { setTakedownId(""); setTakedownNote(""); } }} style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <p style={styles.muted}>Use a contribution reference from a report to hide an item immediately, including one that is currently published.</p>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>Contribution reference<input required pattern="[a-zA-Z0-9_-]+" maxLength={120} value={takedownId} onChange={(event) => setTakedownId(event.target.value)} style={{ border: "1px solid #d9ded8", borderRadius: 8, padding: 10 }} /></label>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>Reason for the author<textarea required minLength={4} maxLength={500} rows={2} value={takedownNote} onChange={(event) => setTakedownNote(event.target.value)} style={{ border: "1px solid #d9ded8", borderRadius: 8, padding: 10 }} /></label>
          <button className="button dark small" disabled={Boolean(busy)} type="submit"><Trash2 size={14} /> Hide contribution</button>
        </form>
      </details>
    </>}
  </section>;
}
