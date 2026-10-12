"use client";

import { useCallback, useEffect, useState } from "react";
import { places } from "@/lib/data";

export type OwnContribution = { id: string; kind: "review" | "post" | "thread" | "reply"; placeId?: string; title?: string; text?: string; description?: string; status: string; moderationReason?: string; createdAt: string; expiresAt?: string; type?: string; rating?: number; criteria?: Record<string, number>; tags?: string[]; term?: string; recommend?: boolean; collectionInstructions?: string; portionsRemaining?: number | null };
export type DemoContributions = { reviews: OwnContribution[]; posts: OwnContribution[]; threads: OwnContribution[]; replies: OwnContribution[] };
const card = { border: "1px solid #e3ddec", borderRadius: 12, padding: 16, display: "grid", gap: 10 } as const;
const kinds = { reviews: "review", posts: "post", threads: "thread", replies: "reply" } as const;
function contributionItems(data: Partial<DemoContributions>): OwnContribution[] {
  return (Object.entries(kinds).flatMap(([key, kind]) => (data[key as keyof DemoContributions] || []).map((item) => ({ ...item, kind }))) as OwnContribution[]).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export default function ContributionsPanel({ onChanged, onEditReview, onOpenPlace, demoItems, onDemoAction }: { onChanged?: () => void; onEditReview?: (review: OwnContribution) => void; onOpenPlace?: (placeId: string) => void; demoItems?: DemoContributions; onDemoAction?: (body: Record<string, unknown>) => Promise<unknown> }) {
  const [items, setItems] = useState<OwnContribution[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [editId, setEditId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [portions, setPortions] = useState("");
  const demo = demoItems !== undefined;
  // Read local data straight from props so a parent update is immediately visible.
  const visibleItems = demo ? contributionItems(demoItems) : items;
  const load = useCallback(async (offset = 0) => {
    if (demo) { setNextOffset(null); setError(""); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/community/contributions?offset=${offset}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your contributions could not be loaded.");
      const incoming = contributionItems(data);
      setItems((old) => [...(offset ? old : []), ...incoming].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
      setNextOffset(data.nextOffset);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(false); }
  }, [demo]);
  useEffect(() => { void load(); }, [load]);
  async function act(body: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      if (demo) {
        if (!onDemoAction) throw new Error("Demo editing is not available in this view.");
        const result = await onDemoAction(body);
        if (result && typeof result === "object" && "error" in result && result.error) throw new Error(String(result.error));
        setNotice("Your private demo has been updated on this device."); setEditId(""); setRemoveId("");
        // The parent supplies refreshed local rows. Do not invoke onChanged, which
        // may refresh the live backend, or fall through to either API request.
        return;
      }
      const response = await fetch("/api/community/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The change could not be saved.");
      setNotice(data.message); setEditId(""); setRemoveId(""); onChanged?.(); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <section style={{ display: "grid", gap: 14 }} aria-label="My contributions">
    <h2>My contributions</h2><p>{demo ? "Private demo · These are your own contributions saved in this browser. Changes stay on this device and are not sent to the live community." : "Manage your reviews, discussions and alerts. Pending content and review notes are visible only to you."}</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!busy && !visibleItems.length && !error && <p>Your contributions will appear here after you post.</p>}
    {visibleItems.map((item) => { const expired = item.expiresAt && Date.parse(item.expiresAt) <= Date.now(); const place = places.find((entry) => entry.id === item.placeId); return <article key={item.id} style={card}>
      <small>{item.kind} · {expired ? "closed / expired" : item.status} · {new Date(item.createdAt).toLocaleDateString("en-GB")}</small>
      <strong>{item.title || place?.name || "Discussion reply"}{item.rating ? ` · ${item.rating}/5` : ""}</strong>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.text || item.description || "No written review."}</p>
      {item.moderationReason && <p style={{ padding: 10, background: "#f6f1ff", borderRadius: 8 }}>Review note: {item.moderationReason}</p>}
      {item.collectionInstructions && <p>Collection: {item.collectionInstructions}</p>}{item.portionsRemaining != null && <p>{item.portionsRemaining} portions remaining</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {item.placeId && onOpenPlace && <button className="button light small" onClick={() => onOpenPlace(item.placeId!)}>Open place</button>}
        {item.kind === "review" && onEditReview && <button className="button light small" onClick={() => onEditReview(item)}>Update review</button>}
        {item.kind === "post" && !expired && <><button className="button light small" disabled={busy} onClick={() => void act({ action: "close-post", targetId: item.id })}>Close alert</button>{item.status !== "hidden" && <button className="button light small" onClick={() => { setEditId(item.id); setInstructions(item.collectionInstructions || ""); setPortions(item.portionsRemaining == null ? "" : String(item.portionsRemaining)); }}>Edit collection details</button>}</>}
        <button className="button light small" disabled={busy} onClick={() => setRemoveId(item.id)}>Delete</button>
      </div>
      {editId === item.id && <form style={{ display: "grid", gap: 10 }} onSubmit={(event) => { event.preventDefault(); void act({ action: "update-post", targetId: item.id, collectionInstructions: instructions, portionsRemaining: portions === "" ? null : Number(portions) }); }}>
        <label>Collection instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={500} rows={3} style={{ width: "100%" }} /></label>
        {item.type === "food" && <label>Portions remaining (optional)<input type="number" min={0} max={10000} step={1} value={portions} onChange={(event) => setPortions(event.target.value)} /></label>}
        <small>{demo ? "Demo changes stay in this browser. " : "Changes are checked by Claude before publication. "}Setting portions to zero closes the alert.</small><button className="button dark small" disabled={busy}>Save details</button>
      </form>}
      {removeId === item.id && <div role="alert"><p>Delete this {item.kind}?{item.kind === "thread" ? " Its replies will also be removed." : ""} This cannot be undone.</p><button className="button dark small" disabled={busy} onClick={() => void act({ action: "delete-own", targetId: item.id, kind: item.kind })}>Delete permanently</button> <button className="button light small" onClick={() => setRemoveId("")}>Cancel</button></div>}
    </article>; })}
    {busy && <p role="status">Loading…</p>}{!demo && nextOffset !== null && <button className="button light" disabled={busy} onClick={() => void load(nextOffset)}>Load older contributions</button>}
  </section>;
}
