import { getDatabase, isUniqueViolation, type Database } from "./db";
import { moderateContent, moderatePhoto, runtimeEnv } from "./integrations";
import {
  HttpError, assertSameOrigin, imageType, postInput, privateInformationReason,
  readLimitedBody, record, reviewInput, safeId, stripImageMetadata, textField, uclEmail,
} from "./community-validation";
import { places } from "./data";
import { adminClient, authClient, authConfigured, currentUser, photoStorage } from "./supabase";

export { HttpError } from "./community-validation";
type Row = Record<string, unknown>;
type VerifiedProfile = { userId: string; email: string; verified: true };

function database(): Database {
  const db = getDatabase();
  if (!db) throw new HttpError(503, "Community storage is not connected yet. Your demo is still available.");
  return db;
}

async function identity(): Promise<string> {
  // Supabase Auth verifies the session cookie; browser-supplied headers are never trusted.
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in with your @ucl.ac.uk email first.");
  return user.userId;
}

export async function requireVerified(): Promise<VerifiedProfile> {
  const user = await currentUser();
  if (!user) throw new HttpError(403, "Verify your @ucl.ac.uk email before contributing.");
  // An email-code sign-in is itself the UCL verification, so the profile row records it.
  const now = Date.now();
  try {
    await database().prepare("INSERT INTO profiles (user_id, email, verified_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING").bind(user.userId, user.email, now, now).run();
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "This UCL address is already linked to another account.");
    throw error;
  }
  return { userId: user.userId, email: user.email, verified: true };
}

export async function consumeRateLimit(userId: string, scope: string, limit: number, windowSeconds: number): Promise<void> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const key = `${scope}:${userId}:${Math.floor(now / windowMs)}`;
  const result = await database().prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = rate_limits.count + 1 RETURNING count")
    .bind(key, now + windowMs).first<{ count: number }>();
  if (!result || result.count > limit) throw new HttpError(429, "A few too many requests. Please wait before trying again.");
  // Bounded cleanup keeps temporary identifiers from being retained indefinitely.
  await database().prepare("DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at < ? LIMIT 100)").bind(now).run();
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Send JSON data.");
  const bytes = await readLimitedBody(request, 32 * 1024);
  try { return record(JSON.parse(new TextDecoder().decode(bytes))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "The request was not valid JSON."); }
}

function iso(value: unknown): string { return new Date(Number(value)).toISOString(); }
function parsed(value: unknown, fallback: unknown): unknown { try { return JSON.parse(String(value)); } catch { return fallback; } }

function publicReview(row: Row, own = false): Row {
  return { id: row.id, placeId: row.place_id, rating: row.rating, criteria: parsed(row.criteria, {}), tags: parsed(row.tags, []),
    text: row.text, term: row.term, recommend: Boolean(row.recommend), createdAt: iso(row.created_at), status: row.status,
    own, ...(own && row.moderation_reason ? { moderationReason: row.moderation_reason } : {}) };
}
function publicPost(row: Row, own = false): Row {
  return { id: row.id, type: row.type, title: row.title, description: row.description, location: row.location,
    lat: row.lat, lng: row.lng, expiresAt: iso(row.expires_at), dietary: parsed(row.dietary, []),
    startsAt: row.starts_at == null ? null : iso(row.starts_at), sourceUrl: row.source_url, sourceName: row.source_name,
    photoKey: row.photo_key, photoUrl: row.photo_key ? `/api/community/photo?key=${encodeURIComponent(String(row.photo_key))}` : null,
    image: row.photo_key ? `/api/community/photo?key=${encodeURIComponent(String(row.photo_key))}` : undefined,
    price: row.price, originalPrice: row.original_price, createdAt: iso(row.created_at), status: row.status,
    own, ...(own && row.moderation_reason ? { moderationReason: row.moderation_reason } : {}) };
}
function publicThread(row: Row, own = false): Row {
  return { id: row.id, placeId: row.place_id, title: row.title, text: row.text, createdAt: iso(row.created_at), status: row.status, own,
    ...(own && row.moderation_reason ? { moderationReason: row.moderation_reason } : {}) };
}
function publicReply(row: Row, own = false): Row {
  return { id: row.id, threadId: row.thread_id, text: row.text, createdAt: iso(row.created_at), status: row.status, own,
    ...(own && row.moderation_reason ? { moderationReason: row.moderation_reason } : {}) };
}

async function communityState(): Promise<Response> {
  const db = database();
  const userId = (await currentUser())?.userId || "";
  const [profile, result, config] = await Promise.all([
    userId ? db.prepare("SELECT email, verified_at FROM profiles WHERE user_id = ?").bind(userId).first<Row>() : null,
    db.batch<Row>([
      db.prepare("SELECT *, CASE WHEN user_id = ? THEN 1 ELSE 0 END AS own FROM reviews WHERE status = 'approved' OR user_id = ? ORDER BY created_at DESC LIMIT 500").bind(userId, userId),
      db.prepare("SELECT *, CASE WHEN user_id = ? THEN 1 ELSE 0 END AS own FROM posts WHERE (status = 'approved' AND expires_at > ?) OR user_id = ? ORDER BY created_at DESC LIMIT 300").bind(userId, Date.now(), userId),
      db.prepare("SELECT *, CASE WHEN user_id = ? THEN 1 ELSE 0 END AS own FROM threads WHERE status = 'approved' OR user_id = ? ORDER BY created_at DESC LIMIT 300").bind(userId, userId),
      db.prepare("SELECT r.*, CASE WHEN r.user_id = ? THEN 1 ELSE 0 END AS own FROM replies r LEFT JOIN threads t ON r.thread_id = t.id WHERE (r.status = 'approved' AND t.status = 'approved') OR r.user_id = ? ORDER BY r.created_at DESC LIMIT 1000").bind(userId, userId),
      db.prepare("SELECT target_id, kind, count(*) AS count FROM votes GROUP BY target_id, kind LIMIT 3000"),
      db.prepare("SELECT target_id, kind FROM votes WHERE user_id = ? LIMIT 1000").bind(userId),
    ]), runtimeEnv(),
  ]);
  const voteCount = (id: unknown, kind: string) => Number(result[4].results.find((vote) => vote.target_id === id && vote.kind === kind)?.count || 0);
  const isAdmin = Boolean(profile && typeof config.ADMIN_USER_IDS === "string" && config.ADMIN_USER_IDS.split(",").map((id) => id.trim()).includes(userId));
  const mapRows = (index: number, transform: (row: Row, own: boolean) => Row) => result[index].results.map((row) => ({
    ...transform(row, Boolean(row.own)),
    helpful: voteCount(row.id, "helpful"), unhelpful: voteCount(row.id, "unhelpful"),
    still: voteCount(row.id, "still"), goneCount: voteCount(row.id, "gone"),
    ...(index === 2 ? { replies: result[3].results.filter((reply) => reply.thread_id === row.id && reply.status === "approved").length } : {}),
  }));
  return json({
    reviews: mapRows(0, publicReview), posts: mapRows(1, publicPost), threads: mapRows(2, publicThread), replies: mapRows(3, publicReply),
    votes: result[4].results.map((row) => ({ targetId: row.target_id, kind: row.kind, count: row.count })),
    myVotes: result[5].results.map((row) => ({ targetId: row.target_id, kind: row.kind })),
    profile: profile ? { verified: true, signedIn: true, accountId: userId, email: profile.email, verifiedAt: iso(profile.verified_at), isAdmin } : { verified: false, signedIn: Boolean(userId), ...(userId ? { accountId: userId } : {}), isAdmin: false },
    services: { email: authConfigured(), ai: Boolean(config.ANTHROPIC_API_KEY), google: Boolean(config.GOOGLE_MAPS_API_KEY) },
  });
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientAddress(request: Request): string {
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

async function requestCode(request: Request): Promise<Response> {
  const body = await jsonBody(request);
  const email = uclEmail(body.email);
  const auth = await authClient();
  if (!auth) throw new HttpError(503, "UCL email sign-in is not connected yet. Explore the clearly labelled demo while email is configured.");
  await consumeRateLimit(await sha256(clientAddress(request)), "email-request", 5, 3600);
  await consumeRateLimit(await sha256(email), "email-recipient", 5, 3600);
  // Supabase Auth emails a one-time code; the email template must include {{ .Token }}.
  const { error } = await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw new HttpError(error.status === 429 ? 429 : 502, "The sign-in email could not be sent. Please try again later.");
  return json({ ok: true, expiresIn: 600, message: "Check your UCL inbox for the sign-in code." });
}

async function verifyCode(request: Request): Promise<Response> {
  const body = await jsonBody(request);
  const email = uclEmail(body.email);
  const code = textField(body.code, "Code", 6, 10);
  if (!/^\d{6,10}$/.test(code)) throw new HttpError(400, "Enter the code from your email.");
  const auth = await authClient();
  if (!auth) throw new HttpError(503, "UCL email sign-in is not connected yet.");
  await consumeRateLimit(await sha256(email), "email-verify", 15, 3600);
  const { data, error } = await auth.auth.verifyOtp({ email, token: code, type: "email" });
  if (error || !data.user) throw new HttpError(400, "The code is incorrect or expired. Request a new one.");
  const now = Date.now();
  try {
    await database().prepare("INSERT INTO profiles (user_id, email, verified_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, verified_at = excluded.verified_at")
      .bind(data.user.id, email, now, now).run();
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "This UCL address is already linked to an account.");
    throw error;
  }
  return json({ ok: true, profile: { verified: true, email } });
}

async function signOut(): Promise<Response> {
  await (await authClient())?.auth.signOut();
  return json({ ok: true });
}

function placeCategory(placeId: string): "study" | "lecture" | "accommodation" | "rental" {
  const place = places.find((entry) => entry.id === placeId);
  if (!place) throw new HttpError(404, "That place is not in the community directory.");
  if (place.demo) throw new HttpError(400, "This fictional example is available only in demo mode.");
  return place.category === "halls" ? "accommodation" : place.category;
}

async function moderation(content: string, kind: "review" | "pin" | "thread", privateHome = false): Promise<{ status: string; reason: string | null }> {
  const privateReason = privateInformationReason(content, privateHome);
  if (privateReason) throw new HttpError(400, privateReason);
  try {
    const result = await moderateContent(content, kind);
    return result.approved ? { status: "approved", reason: null } : { status: "pending", reason: result.reasons.join(" ") || "Awaiting moderation." };
  } catch { return { status: "pending", reason: "Awaiting moderation. This contribution is visible only to you until reviewed." }; }
}

async function photoModeration(key: string, text: string): Promise<{ status: string; reason: string | null }> {
  try {
    const download = await photoStorage()?.download(key);
    const photo = download?.data;
    if (!photo || photo.size > 2_000_000) return { status: "pending", reason: "Photo awaiting a moderator's review." };
    const bytes = new Uint8Array(await photo.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const type = imageType(bytes);
    const result = await moderatePhoto({ mediaType: type.mime as "image/jpeg" | "image/png" | "image/webp", data: btoa(binary) }, text);
    return result.approved ? { status: "approved", reason: null } : { status: "pending", reason: result.reasons.join(" ") || "Photo awaiting moderation." };
  } catch { return { status: "pending", reason: "Photo awaiting a moderator's review." }; }
}

async function targetKind(id: string, owner?: string): Promise<"review" | "post" | "thread" | "reply"> {
  for (const [table, kind] of [["reviews", "review"], ["posts", "post"], ["threads", "thread"], ["replies", "reply"]] as const) {
    const row = await database().prepare(`SELECT id FROM ${table} WHERE id = ? AND (status = 'approved' OR user_id = ?)`).bind(id, owner || "").first();
    if (row) return kind;
  }
  throw new HttpError(404, "This contribution is no longer available.");
}

async function action(request: Request): Promise<Response> {
  const profile = await requireVerified();
  const body = await jsonBody(request);
  const action = textField(body.action, "Action", 1, 20);
  const db = database();
  const id = crypto.randomUUID();
  const now = Date.now();
  if (action === "review") {
    const category = placeCategory(safeId(body.placeId, "Place"));
    const data = reviewInput(body, category);
    await consumeRateLimit(profile.userId, "review", 8, 86400);
    const reviewModeration = await moderation(`${data.text}\n${data.tags.join(", ")}\n${data.term}`, "review", category === "rental");
    const row = await db.prepare("INSERT INTO reviews (id, user_id, place_id, rating, criteria, tags, text, term, recommend, status, moderation_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, place_id) DO UPDATE SET rating = excluded.rating, criteria = excluded.criteria, tags = excluded.tags, text = excluded.text, term = excluded.term, recommend = excluded.recommend, status = excluded.status, moderation_reason = excluded.moderation_reason, created_at = excluded.created_at RETURNING *")
      .bind(id, profile.userId, data.placeId, data.rating, JSON.stringify(data.criteria), JSON.stringify(data.tags), data.text, data.term, Number(data.recommend), reviewModeration.status, reviewModeration.reason, now).first<Row>();
    return json({ ok: true, review: publicReview(row!, true), message: reviewModeration.status === "approved" ? "Your review is published." : "Your review is awaiting moderation." }, 201);
  }
  if (action === "post") {
    const data = postInput(body);
    await consumeRateLimit(profile.userId, "post", 10, 3600);
    if (data.sourceUrl) {
      await requireModerator();
      const imported = await db.prepare("SELECT id FROM posts WHERE source_url = ?").bind(data.sourceUrl).first();
      if (imported) throw new HttpError(409, "This Union event has already been imported.");
    }
    if (data.photoKey) {
      const photo = await db.prepare("SELECT key FROM photos WHERE key = ? AND user_id = ?").bind(data.photoKey, profile.userId).first();
      if (!photo) throw new HttpError(400, "Upload your own photo before publishing.");
    }
    const duplicate = await db.prepare("SELECT id FROM posts WHERE user_id = ? AND title = ? AND location = ? AND created_at > ?").bind(profile.userId, data.title, data.location, now - 10 * 60000).first();
    if (duplicate) throw new HttpError(409, "You have already posted this alert. Check your existing pin.");
    let postModeration = await moderation(`${data.type}: ${data.title}\n${data.description}\nLocation: ${data.location}`, "pin");
    if (data.photoKey && postModeration.status === "approved") postModeration = await photoModeration(data.photoKey, `${data.title}\n${data.description}`);
    let row: Row | null;
    try {
      row = await db.prepare("INSERT INTO posts (id, user_id, type, title, description, location, lat, lng, expires_at, starts_at, source_url, source_name, dietary, photo_key, price, original_price, status, moderation_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
        .bind(id, profile.userId, data.type, data.title, data.description, data.location, data.lat, data.lng, data.expiresAt, data.startsAt, data.sourceUrl, data.sourceName, JSON.stringify(data.dietary), data.photoKey, data.price, data.originalPrice, postModeration.status, postModeration.reason, now).first<Row>();
    } catch (error) {
      if (data.sourceUrl && isUniqueViolation(error)) throw new HttpError(409, "This Union event has already been imported.");
      throw error;
    }
    return json({ ok: true, post: publicPost(row!, true), message: postModeration.status === "approved" ? "Your pin is live." : "Your pin is awaiting moderation." }, 201);
  }
  if (action === "thread") {
    const placeId = safeId(body.placeId, "Place"); placeCategory(placeId);
    const title = textField(body.title, "Title", 4, 140);
    const text = textField(body.text, "Message", 1, 2500);
    await consumeRateLimit(profile.userId, "thread", 10, 3600);
    const result = await moderation(`${title}\n${text}`, "thread");
    const row = await db.prepare("INSERT INTO threads (id, user_id, place_id, title, text, status, moderation_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .bind(id, profile.userId, placeId, title, text, result.status, result.reason, now).first<Row>();
    return json({ ok: true, thread: publicThread(row!, true), message: result.status === "approved" ? "Discussion started." : "Your discussion is awaiting moderation." }, 201);
  }
  if (action === "reply") {
    const threadId = safeId(body.threadId, "Discussion");
    if (await targetKind(threadId) !== "thread") throw new HttpError(400, "Choose a discussion to reply to.");
    const text = textField(body.text, "Reply", 1, 2500);
    await consumeRateLimit(profile.userId, "reply", 20, 3600);
    const result = await moderation(text, "thread");
    const row = await db.prepare("INSERT INTO replies (id, user_id, thread_id, text, status, moderation_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .bind(id, profile.userId, threadId, text, result.status, result.reason, now).first<Row>();
    return json({ ok: true, reply: publicReply(row!, true), message: result.status === "approved" ? "Reply published." : "Your reply is awaiting moderation." }, 201);
  }
  if (action === "vote") {
    const targetId = safeId(body.targetId, "Contribution");
    const kind = textField(body.kind, "Vote", 1, 15);
    const target = await targetKind(targetId);
    if (!(target === "post" ? ["still", "gone"] : ["helpful", "unhelpful"]).includes(kind)) throw new HttpError(400, "This vote does not apply to that contribution.");
    await consumeRateLimit(profile.userId, "vote", 80, 3600);
    await db.prepare("INSERT INTO votes (id, user_id, target_id, kind, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, target_id) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at")
      .bind(id, profile.userId, targetId, kind, now).run();
    if (target === "post") {
      // Three independent reports of gone, exceeding confirmations, remove the live pin.
      await db.prepare("UPDATE posts SET expires_at = LEAST(expires_at, ?) WHERE id = ? AND (SELECT count(*) FROM votes WHERE target_id = ? AND kind = 'gone') >= 3 AND (SELECT count(*) FROM votes WHERE target_id = ? AND kind = 'gone') > (SELECT count(*) FROM votes WHERE target_id = ? AND kind = 'still')")
        .bind(now, targetId, targetId, targetId, targetId).run();
    }
    return json({ ok: true });
  }
  if (action === "report") {
    const targetId = safeId(body.targetId, "Contribution");
    const generalRequest = targetId === "takedown";
    if (!generalRequest) await targetKind(targetId, profile.userId);
    const reason = textField(body.reason, "Reason", 4, 500);
    await consumeRateLimit(profile.userId, "report", 10, 3600);
    await db.prepare("INSERT INTO reports (id, user_id, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, target_id) DO UPDATE SET reason = excluded.reason")
      .bind(id, profile.userId, targetId, reason, now).run();
    if (generalRequest) return json({ ok: true, message: "Your privacy or takedown request has been sent to the campus moderators." });
    const statements = ["reviews", "posts", "threads", "replies"].map((table) => db.prepare(`UPDATE ${table} SET status = 'hidden', moderation_reason = 'Hidden while community reports are reviewed.' WHERE id = ? AND (SELECT count(*) FROM reports WHERE target_id = ?) >= 3`).bind(targetId, targetId));
    await db.batch(statements);
    return json({ ok: true, message: "Report received. Repeated independent reports hide a contribution pending review." });
  }
  throw new HttpError(400, "Unknown community action.");
}

async function upload(request: Request): Promise<Response> {
  const profile = await requireVerified();
  const storage = photoStorage();
  if (!storage) throw new HttpError(503, "Photo storage is not connected yet.");
  await consumeRateLimit(profile.userId, "upload", 15, 3600);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("multipart/form-data;")) throw new HttpError(415, "Send an image file.");
  const body = await readLimitedBody(request, 5 * 1024 * 1024 + 65536);
  const form = await new Response(body.buffer as ArrayBuffer, { headers: { "Content-Type": contentType } }).formData();
  const file = form.get("photo") ?? form.get("file");
  if (!file || typeof file === "string" || file.size === 0 || file.size > 5 * 1024 * 1024) throw new HttpError(400, "Choose a JPEG, PNG or WebP image under 5 MB.");
  const source = new Uint8Array(await file.arrayBuffer());
  const type = imageType(source);
  if (file.type && file.type !== type.mime) throw new HttpError(400, "The image contents do not match its file type.");
  const clean = stripImageMetadata(source, type.mime);
  const key = `photos/${crypto.randomUUID()}.${type.extension}`;
  const stored = await storage.upload(key, clean, { contentType: type.mime, upsert: false });
  if (stored.error) throw new HttpError(502, "The photo could not be stored. Please try again.");
  try {
    await database().prepare("INSERT INTO photos (key, user_id, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?)").bind(key, profile.userId, type.mime, clean.length, Date.now()).run();
  } catch (error) { await storage.remove([key]); throw error; }
  return json({ ok: true, key, url: `/api/community/photo?key=${encodeURIComponent(key)}` }, 201);
}

async function photo(request: Request): Promise<Response> {
  const key = new URL(request.url).searchParams.get("key") || "";
  const storage = photoStorage();
  if (!/^photos\/[a-f0-9-]+\.(jpg|png|webp)$/.test(key) || !storage) throw new HttpError(404, "Photo not found.");
  const userId = (await currentUser())?.userId || "";
  let allowed = await database().prepare("SELECT mime FROM photos WHERE key = ? AND (user_id = ? OR EXISTS (SELECT 1 FROM posts WHERE photo_key = ? AND status = 'approved' AND expires_at > ?))")
    .bind(key, userId, key, Date.now()).first<{ mime: string }>();
  if (!allowed && userId) {
    try {
      await requireModerator();
      allowed = await database().prepare("SELECT mime FROM photos WHERE key = ?").bind(key).first<{ mime: string }>();
    } catch { /* Do not reveal whether a private image exists. */ }
  }
  if (!allowed) throw new HttpError(404, "Photo not found.");
  const { data: image } = await storage.download(key);
  if (!image) throw new HttpError(404, "Photo not found.");
  return new Response(image.stream(), { headers: { "Content-Type": allowed.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline; filename=community-photo" } });
}

async function requireModerator(): Promise<VerifiedProfile> {
  const profile = await requireVerified();
  const config = await runtimeEnv();
  const admins = typeof config.ADMIN_USER_IDS === "string" ? config.ADMIN_USER_IDS.split(",").map((id) => id.trim()).filter(Boolean) : [];
  if (!admins.includes(profile.userId)) throw new HttpError(403, "This account is not a community moderator.");
  return profile;
}

async function moderationQueue(request: Request): Promise<Response> {
  await requireModerator();
  const db = database();
  const result = await db.batch<Row>([
    ...["reviews", "posts", "threads", "replies"].map((table) => db.prepare(`SELECT * FROM ${table} WHERE status IN ('pending', 'hidden') OR id IN (SELECT target_id FROM reports) ORDER BY created_at ASC LIMIT 200`)),
    db.prepare("SELECT id, target_id, reason, created_at FROM reports ORDER BY created_at DESC LIMIT 500"),
  ]);
  const maps = [publicReview, publicPost, publicThread, publicReply];
  return json({ queue: result.slice(0, 4).flatMap((table, i) => table.results.map((row) => ({ ...maps[i](row), kind: ["review", "post", "thread", "reply"][i], moderationReason: row.moderation_reason }))), reports: result[4].results.map((row) => ({ id: row.id, targetId: row.target_id, reason: row.reason, createdAt: iso(row.created_at) })) });
}

async function moderateAction(request: Request): Promise<Response> {
  const profile = await requireModerator();
  const body = await jsonBody(request);
  if (body.decision === "resolve-report") {
    const reportId = safeId(body.reportId, "Report");
    await consumeRateLimit(profile.userId, "moderation", 100, 3600);
    const resolved = await database().prepare("DELETE FROM reports WHERE id = ? AND target_id = 'takedown' RETURNING id").bind(reportId).first();
    if (!resolved) throw new HttpError(404, "This general request is no longer in the queue.");
    return json({ ok: true, status: "resolved" });
  }
  const targetId = safeId(body.targetId, "Contribution");
  const decision = textField(body.decision, "Decision", 1, 10);
  if (!["approve", "hide"].includes(decision)) throw new HttpError(400, "Choose approve or hide.");
  const reason = textField(body.reason ?? (decision === "hide" ? "Hidden by a community moderator." : ""), "Reason", 0, 500);
  await consumeRateLimit(profile.userId, "moderation", 100, 3600);
  for (const table of ["reviews", "posts", "threads", "replies"]) {
    const row = await database().prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(targetId).first<Row>();
    if (!row) continue;
    if (decision === "approve") {
      const privacy = privateInformationReason([row.title, row.text, row.description, row.location, row.tags].filter(Boolean).join("\n"));
      if (privacy) throw new HttpError(400, privacy);
    }
    await database().batch([
      database().prepare(`UPDATE ${table} SET status = ?, moderation_reason = ? WHERE id = ?`).bind(decision === "approve" ? "approved" : "hidden", reason || null, targetId),
      database().prepare("DELETE FROM reports WHERE target_id = ?").bind(targetId),
    ]);
    return json({ ok: true, status: decision === "approve" ? "approved" : "hidden" });
  }
  throw new HttpError(404, "Contribution not found.");
}

async function exportAccount(): Promise<Response> {
  const userId = await identity();
  const db = database();
  const tables = ["profiles", "reviews", "posts", "threads", "replies", "votes", "reports", "photos"] as const;
  const data = await db.batch(tables.map((table) => db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).bind(userId)));
  const account = Object.fromEntries(tables.map((table, i) => [table, data[i].results]));
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), account }, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=community-account.json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

async function deleteAccount(): Promise<Response> {
  const userId = await identity();
  const db = database();
  const admin = adminClient();
  if (!admin) throw new HttpError(503, "Account deletion is unavailable. Try again later.");
  const objects = await db.prepare("SELECT key FROM photos WHERE user_id = ?").bind(userId).all<{ key: string }>();
  for (let index = 0; index < objects.results.length; index += 1000) {
    const removed = await admin.storage.from("photos").remove(objects.results.slice(index, index + 1000).map((row) => row.key));
    if (removed.error) throw new HttpError(503, "Photo storage is unavailable. Try account deletion again later.");
  }
  await db.batch([
    db.prepare("DELETE FROM votes WHERE target_id IN (SELECT id FROM reviews WHERE user_id = ? UNION SELECT id FROM posts WHERE user_id = ? UNION SELECT id FROM threads WHERE user_id = ? UNION SELECT id FROM replies WHERE user_id = ?)").bind(userId, userId, userId, userId),
    db.prepare("DELETE FROM reports WHERE target_id IN (SELECT id FROM reviews WHERE user_id = ? UNION SELECT id FROM posts WHERE user_id = ? UNION SELECT id FROM threads WHERE user_id = ? UNION SELECT id FROM replies WHERE user_id = ?)").bind(userId, userId, userId, userId),
    db.prepare("DELETE FROM replies WHERE thread_id IN (SELECT id FROM threads WHERE user_id = ?)").bind(userId),
    ...["reviews", "posts", "threads", "replies", "votes", "reports", "photos", "profiles"].map((table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId)),
    db.prepare("DELETE FROM rate_limits WHERE key LIKE ? ESCAPE '\\'").bind(`%:${userId.replace(/[\\%_]/g, "\\$&") }:%`),
  ]);
  await (await authClient())?.auth.signOut();
  const removed = await admin.auth.admin.deleteUser(userId);
  if (removed.error) console.error("Auth user deletion failed:", removed.error.name);
  return json({ ok: true, message: "Your community account, contributions and uploaded photos have been deleted." });
}

export async function communityRoute(request: Request, path: string[]): Promise<Response> {
  try {
    const endpoint = path.join("/");
    if (request.method === "GET") {
      if (endpoint === "state") return await communityState();
      if (endpoint === "photo") return await photo(request);
      if (endpoint === "account/export") return await exportAccount();
      if (endpoint === "moderation") return await moderationQueue(request);
    }
    if (request.method === "POST" || request.method === "DELETE") assertSameOrigin(request);
    if (request.method === "POST") {
      if (endpoint === "auth/request") return await requestCode(request);
      if (endpoint === "auth/verify") return await verifyCode(request);
      if (endpoint === "auth/signout") return await signOut();
      if (endpoint === "action") return await action(request);
      if (endpoint === "upload") return await upload(request);
      if (endpoint === "moderation") return await moderateAction(request);
    }
    if (request.method === "DELETE" && endpoint === "account") return await deleteAccount();
    throw new HttpError(404, "This community endpoint does not exist.");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    // Never return provider responses, email codes, database queries or identities to clients.
    console.error("Community request failed:", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "Community services are temporarily unavailable. Please try again." }, 500);
  }
}
