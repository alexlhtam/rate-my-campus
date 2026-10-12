"use client";

import { useState } from "react";

export default function CommunityRequestForm({ kind, placeId, onSubmitted }: { kind: "correction" | "takedown"; placeId?: string; onSubmitted?: () => void }) {
  const [target, setTarget] = useState(placeId || "");
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/community/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, targetId: target || "general", reason, contact, evidenceUrl }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Your request could not be sent.");
      setNotice(`${body.message} Reference: ${body.reference}`); setReason(""); onSubmitted?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
    <h2>{kind === "correction" ? "Suggest a map correction" : "Privacy or takedown request"}</h2>
    <p>{kind === "correction" ? "Tell us what is wrong and include a source if possible. A moderator will verify the evidence before the catalogue changes. A signed-in UCL-address account is required." : "You do not need a UCL account. Your details are sent privately to the site moderators. Please include enough information to identify the content."}</p>
    <label>Place or contribution reference{kind === "takedown" ? " (optional)" : ""}<input required={kind === "correction"} value={target} onChange={(event) => setTarget(event.target.value)} maxLength={120} pattern="[a-zA-Z0-9_-]+" style={{ width: "100%" }} /></label>
    <label>What needs attention?<textarea required minLength={10} maxLength={2000} rows={5} value={reason} onChange={(event) => setReason(event.target.value)} style={{ width: "100%" }} /></label>
    <label>Evidence link (optional)<input type="url" placeholder="https://…" maxLength={1000} value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} style={{ width: "100%" }} /></label>
    <label>Contact email (optional, for follow-up)<input type="email" maxLength={254} value={contact} onChange={(event) => setContact(event.target.value)} style={{ width: "100%" }} /></label>
    <small>Only include information needed to handle this request. Requests and contact details are visible only to moderators and are scheduled for removal 90 days after resolution.</small>
    {error && <p role="alert">{error}</p>}{notice && <p role="status" style={{ overflowWrap: "anywhere" }}>{notice}</p>}
    <button className="button dark" disabled={busy} type="submit">{busy ? "Sending…" : "Send private request"}</button>
  </form>;
}
