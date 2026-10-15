import {publicFreebie} from './freebies/publication';
import { getDatabase, isUniqueViolation, type Database } from "./db";
import { moderateContent, moderatePhoto, runtimeEnv } from "./integrations";
import {
  HttpError, assertSameOrigin, imageType, postInput, privateInformationReason,
  readLimitedBody, record, reviewInput, safeId, stripImageMetadata, textField, uclEmail,
  communityRequestInput, collectionUpdateInput, foodDetailsInput, foodPortions, foodRevision,
} from "./community-validation";
import { placeSummaries, pageOffset, retryModeration } from "./community-features";
import { readFoodDetails } from "./food";
import { places } from "./data";
import { adminClient, authClient, authConfigured, currentUser, photoStorage } from "./supabase";

export { HttpError } from "./community-validation";
type Row = Record<string, unknown>;
type VerifiedProfile = { userId: string; email: string; verified: true };
type ModerationResult = { status: string; reason: string | null; retryable?: boolean };

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
  if (!user) throw new HttpError(403, "Sign in with your @ucl.ac.uk email before contributing.");
  // Only @ucl.ac.uk accounts can sign in, so the profile row records the UCL address.
  const now = Date.now();
  try {
    await database().prepare("INSERT INTO profiles (user_id, email, verified_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING").bind(user.userId, user.email, now, now).run();
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "This UCL address is already linked to another account.");
    throw error;
  }
  return { userId: user.userId, email: user.email, verified: true };
}

/** Provider checks may outlive account deletion or a change to a non-UCL email.
 * Never recreate a profile when rechecking a delayed write. This is not session
 * revocation: the request's token can remain valid after remote sign-out. */
async function requireActiveWrite(userId: string): Promise<void> {
  const user = await currentUser();
  if (user?.userId !== userId || !await database().prepare("SELECT user_id FROM profiles WHERE user_id = ?").bind(userId).first()) {
    throw new HttpError(403, "Your account changed while this contribution was checked. Sign in again before submitting.");
  }
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
  if(row.freebie_json)return {...publicFreebie(row),own};
  return { id: row.id, type: row.type, title: row.title, description: row.description, location: row.location,
    lat: row.lat, lng: row.lng, expiresAt: iso(row.expires_at), dietary: parsed(row.dietary, []),
    startsAt: row.starts_at == null ? null : iso(row.starts_at), sourceUrl: row.source_url, sourceName: row.source_name,
    freebie: parsed(row.freebie_json, null), sourceCheckedAt: row.source_checked_at ? iso(row.source_checked_at) : null,
    photoKey: row.photo_key, photoUrl: row.photo_key ? `/api/community/photo?key=${encodeURIComponent(String(row.photo_key))}` : null,
    image: row.photo_key ? `/api/community/photo?key=${encodeURIComponent(String(row.photo_key))}` : undefined,
    price: row.price, originalPrice: row.original_price, createdAt: iso(row.created_at), status: row.status,
    collectionInstructions: row.collection_instructions || "", portionsRemaining: row.portions_remaining ?? null,
    foodDetails: row.type === "food" ? readFoodDetails(parsed(row.food_details, {})) : undefined,
    revision: Number(row.moderation_revision || 0), closureReason: row.closure_reason || null,
    closedAt: row.closed_at == null ? null : iso(row.closed_at),
    availabilityUpdatedAt: iso(row.availability_updated_at ?? row.created_at),
    freshStillCount: Number(row.fresh_still || 0), freshGoneCount: Number(row.fresh_gone || 0),
    lastAvailabilityFeedbackAt: row.last_feedback_at == null ? null : iso(row.last_feedback_at),
    own, ...(own && row.moderation_reason ? { moderationReason: row.moderation_reason } : {}) };
}

async function hydrateFoodFeedback(rows: Row[]): Promise<void> {
  const ids = rows.filter((row) => row.type === "food").map((row) => row.id);
  if (!ids.length) return;
  const result = await database().prepare("SELECT v.target_id, count(*) FILTER (WHERE v.kind = 'still') AS fresh_still, count(*) FILTER (WHERE v.kind = 'gone') AS fresh_gone, max(v.created_at) AS last_feedback_at FROM votes v JOIN posts p ON p.id = v.target_id WHERE p.id IN (SELECT jsonb_array_elements_text(?::jsonb)) AND v.kind IN ('still','gone') AND v.user_id <> p.user_id AND v.created_at > GREATEST(?, COALESCE(p.availability_updated_at, p.created_at)) GROUP BY v.target_id")
    .bind(JSON.stringify(ids), Date.now() - 30 * 60000).all<Row>();
  for (const row of rows) Object.assign(row, result.results.find((entry) => entry.target_id === row.id) || {});
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
  await drainModerationRetries();
  const userId = (await currentUser())?.userId || "";
  const [profile, result, config, summaries] = await Promise.all([
    userId ? db.prepare("SELECT email, verified_at FROM profiles WHERE user_id = ?").bind(userId).first<Row>() : null,
    db.batch<Row>([
      db.prepare("SELECT *, CASE WHEN user_id = ? THEN 1 ELSE 0 END AS own FROM reviews WHERE status = 'approved' OR user_id = ? ORDER BY created_at DESC LIMIT 500").bind(userId, userId),
      db.prepare("SELECT *, CASE WHEN user_id = ? THEN 1 ELSE 0 END AS own FROM posts WHERE (status = 'approved' AND expires_at > ?) OR user_id = ? ORDER BY created_at DESC LIMIT 300").bind(userId, Date.now(), userId),
      db.prepare("SELECT *, CASE WHEN user_id = ? THEN 1 ELSE 0 END AS own FROM threads WHERE status = 'approved' OR user_id = ? ORDER BY created_at DESC LIMIT 300").bind(userId, userId),
      db.prepare("SELECT r.*, CASE WHEN r.user_id = ? THEN 1 ELSE 0 END AS own FROM replies r LEFT JOIN threads t ON r.thread_id = t.id WHERE (r.status = 'approved' AND t.status = 'approved') OR r.user_id = ? ORDER BY r.created_at DESC LIMIT 1000").bind(userId, userId),
      db.prepare("SELECT target_id, kind, count(*) AS count FROM votes GROUP BY target_id, kind LIMIT 3000"),
      db.prepare("SELECT target_id, kind FROM votes WHERE user_id = ? LIMIT 1000").bind(userId),
    ]), runtimeEnv(), placeSummaries(db),
  ]);
  await hydrateFoodFeedback(result[1].results);
  const voteCount = (id: unknown, kind: string) => Number(result[4].results.find((vote) => vote.target_id === id && vote.kind === kind)?.count || 0);
  const isAdmin = Boolean(profile && typeof config.ADMIN_USER_IDS === "string" && config.ADMIN_USER_IDS.split(",").map((id) => id.trim()).includes(userId));
  const mapRows = (index: number, transform: (row: Row, own: boolean) => Row) => result[index].results.map((row) => ({
    ...transform(row, Boolean(row.own)),
    helpful: voteCount(row.id, "helpful"), unhelpful: voteCount(row.id, "unhelpful"),
    still: row.type === "food" ? Number(row.fresh_still || 0) : voteCount(row.id, "still"), goneCount: row.type === "food" ? Number(row.fresh_gone || 0) : voteCount(row.id, "gone"),
    ...(index === 2 ? { replies: result[3].results.filter((reply) => reply.thread_id === row.id && reply.status === "approved").length } : {}),
  }));
  return json({
    placeSummaries: summaries,
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

function passwordField(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 72) throw new HttpError(400, "Use a password of 8 to 72 characters.");
  return value;
}

/** UCL-only email and password accounts. Addresses are not verified by email (hackathon MVP). */
async function passwordAuth(request: Request, mode: "signup" | "signin"): Promise<Response> {
  const body = await jsonBody(request);
  const email = uclEmail(body.email);
  const password = passwordField(body.password);
  const auth = await authClient();
  if (!auth) throw new HttpError(503, "UCL sign-in is not connected yet. Explore the clearly labelled demo meanwhile.");
  await consumeRateLimit(await sha256(clientAddress(request)), `password-${mode}`, mode === "signup" ? 5 : 30, 3600);
  await consumeRateLimit(await sha256(email), "password-email", 20, 3600);
  if (mode === "signup") {
    const admin = adminClient();
    if (!admin) throw new HttpError(503, "UCL sign-in is not connected yet.");
    // Created pre-confirmed so no email has to be delivered.
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) {
      if (error.code === "email_exists" || /already/i.test(error.message)) throw new HttpError(409, "An account already exists for this email. Sign in instead.");
      if (error.code === "weak_password") throw new HttpError(400, "Choose a stronger password.");
      throw new HttpError(502, "The account could not be created. Please try again.");
    }
  }
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new HttpError(401, "That email and password don't match.");
  const now = Date.now();
  try {
    await database().prepare("INSERT INTO profiles (user_id, email, verified_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email")
      .bind(data.user.id, email, now, now).run();
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "This UCL address is already linked to an account.");
    throw error;
  }
  return json({ ok: true, profile: { verified: true, email } });
}

async function signOut(): Promise<Response> {
  const result = await (await authClient())?.auth.signOut();
  if (result?.error) throw new HttpError(503, "We could not sign out your account. Please try again.");
  return json({ ok: true });
}

function placeCategory(placeId: string): "study" | "lecture" | "accommodation" | "rental" | "building" {
  const place = places.find((entry) => entry.id === placeId);
  if (!place) throw new HttpError(404, "That place is not in the community directory.");
  if (place.demo) throw new HttpError(400, "This fictional example is available only in demo mode.");
  return place.category === "halls" ? "accommodation" : place.category;
}

async function moderation(content: string, kind: "review" | "pin" | "thread", privateHome = false): Promise<ModerationResult> {
  const privateReason = privateInformationReason(content, privateHome);
  if (privateReason) throw new HttpError(400, privateReason);
  try {
    const result = await retryModeration(() => moderateContent(content, kind));
    return result.approved ? { status: "approved", reason: null } : { status: "pending", reason: result.reasons.join(" ") || "Awaiting moderation." };
  } catch (error) { return { status: "pending", reason: "Awaiting moderation. This contribution is visible only to you until reviewed.", retryable: transientFailure(error) }; }
}

function transientFailure(error: unknown): boolean { return Boolean(error && typeof error === "object" && [429, 502, 504].includes(Number((error as { status?: number }).status))); }

async function photoModeration(key: string, text: string): Promise<ModerationResult> {
  try {
    const download = await photoStorage()?.download(key);
    const photo = download?.data;
    if (!photo || photo.size > 2_000_000) return { status: "pending", reason: "Photo awaiting a moderator's review." };
    const bytes = new Uint8Array(await photo.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const type = imageType(bytes);
    const result = await retryModeration(() => moderatePhoto({ mediaType: type.mime as "image/jpeg" | "image/png" | "image/webp", data: btoa(binary) }, text));
    return result.approved ? { status: "approved", reason: null } : { status: "pending", reason: result.reasons.join(" ") || "Photo awaiting moderation." };
  } catch (error) { return { status: "pending", reason: "Photo awaiting a moderator's review.", retryable: transientFailure(error) }; }
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
  await retentionSweep();
  if (action === "delete-own" || action === "close-post" || action === "update-post" || action === "food-availability") return ownAction(profile.userId, body, action);
  if (action === "review") {
    const category = placeCategory(safeId(body.placeId, "Place"));
    const data = reviewInput(body, category);
    await consumeRateLimit(profile.userId, "review", 8, 86400);
    const reviewModeration = await moderation(`${data.text}\n${data.tags.join(", ")}\n${data.term}`, "review", category === "rental");
    await requireActiveWrite(profile.userId);
    const row = await db.prepare("INSERT INTO reviews (id, user_id, place_id, rating, criteria, tags, text, term, recommend, status, moderation_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, place_id) DO UPDATE SET rating = excluded.rating, criteria = excluded.criteria, tags = excluded.tags, text = excluded.text, term = excluded.term, recommend = excluded.recommend, status = excluded.status, moderation_reason = excluded.moderation_reason, created_at = excluded.created_at, moderation_revision = reviews.moderation_revision + 1 RETURNING *")
      .bind(id, profile.userId, data.placeId, data.rating, JSON.stringify(data.criteria), JSON.stringify(data.tags), data.text, data.term, Number(data.recommend), reviewModeration.status, reviewModeration.reason, now).first<Row>();
    await scheduleModeration(row!, "review", reviewModeration);
    return json({ ok: true, review: publicReview(row!, true), message: reviewModeration.status === "approved" ? "Your review is published." : "Your review is awaiting moderation." }, 201);
  }
  if (action === "post") {
    // Only the server can grant the longer Union window, after checking identity.
    if(body.sourceUrl)await requireModerator();
    const data = postInput(body,now,{unionImport:!!body.sourceUrl});
    await consumeRateLimit(profile.userId, "post", 10, 3600);
    if (data.sourceUrl) {
      await requireModerator();
      const imported = await db.prepare("SELECT id FROM posts WHERE source_url = ?").bind(data.sourceUrl).first();
      if (imported) throw new HttpError(409, "This Union event has already been imported.");
    }
    if (data.photoKey) {
      // Unattached uploads expire after seven days. A six-day attach window leaves
      // a full day of grace so storage cleanup can never race a valid new post.
      const photo = await db.prepare("SELECT key FROM photos WHERE key = ? AND user_id = ? AND created_at > ?").bind(data.photoKey, profile.userId, now - 6 * 86400000).first();
      if (!photo) throw new HttpError(400, "Upload your own recent photo before publishing. Unused uploads expire after six days.");
    }
    const duplicate = await db.prepare("SELECT id FROM posts WHERE type = ? AND lower(trim(title)) = lower(trim(?)) AND lower(trim(location)) = lower(trim(?)) AND expires_at > ? AND status IN ('approved', 'pending') AND abs(lat - ?) < 0.001 AND abs(lng - ?) < 0.001").bind(data.type, data.title, data.location, now, data.lat, data.lng).first();
    if (duplicate) throw new HttpError(409, "An active alert for this item and location already exists. Confirm that pin instead.");
    if (data.photoKey) {
      const duplicatePhoto = await db.prepare("SELECT p.id FROM posts p JOIN photos existing ON existing.key = p.photo_key JOIN photos uploaded ON uploaded.content_hash = existing.content_hash WHERE uploaded.key = ? AND p.expires_at > ? AND p.status IN ('approved', 'pending') AND abs(p.lat - ?) < 0.001 AND abs(p.lng - ?) < 0.001").bind(data.photoKey, now, data.lat, data.lng).first();
      if (duplicatePhoto) throw new HttpError(409, "That photo is already attached to an active alert here.");
    }
    const moderationText = `${data.type}: ${data.title}\n${data.description}\nLocation: ${data.location}\nCollection: ${data.collectionInstructions}\n${data.foodDetails ? JSON.stringify(data.foodDetails) : ""}`;
    let postModeration = await moderation(moderationText, "pin");
    if (data.photoKey && postModeration.status === "approved") postModeration = await photoModeration(data.photoKey, moderationText);
    await requireActiveWrite(profile.userId);
    let row: Row | null;
    try {
      if (data.type === "food" && data.expiresAt <= Date.now()) throw new HttpError(400, "The collection window ended while this alert was checked. Confirm a new expiry before posting.");
      row = await db.prepare("INSERT INTO posts (id, user_id, type, title, description, location, lat, lng, expires_at, starts_at, source_url, source_name, dietary, photo_key, price, original_price, status, moderation_reason, created_at, collection_instructions, portions_remaining, food_details, availability_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
        .bind(id, profile.userId, data.type, data.title, data.description, data.location, data.lat, data.lng, data.expiresAt, data.startsAt, data.sourceUrl, data.sourceName, JSON.stringify(data.dietary), data.photoKey, data.price, data.originalPrice, postModeration.status, postModeration.reason, now, data.collectionInstructions, data.portionsRemaining, JSON.stringify(data.foodDetails || {}), now).first<Row>();
    } catch (error) {
      if (data.sourceUrl && isUniqueViolation(error)) throw new HttpError(409, "This Union event has already been imported.");
      throw error;
    }
    await scheduleModeration(row!, "post", postModeration);
    return json({ ok: true, post: publicPost(row!, true), message: postModeration.status === "approved" ? "Your pin is live." : "Your pin is awaiting moderation." }, 201);
  }
  if (action === "thread") {
    const placeId = safeId(body.placeId, "Place"); placeCategory(placeId);
    const title = textField(body.title, "Title", 4, 140);
    const text = textField(body.text, "Message", 1, 2500);
    await consumeRateLimit(profile.userId, "thread", 10, 3600);
    const result = await moderation(`${title}\n${text}`, "thread");
    await requireActiveWrite(profile.userId);
    const row = await db.prepare("INSERT INTO threads (id, user_id, place_id, title, text, status, moderation_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .bind(id, profile.userId, placeId, title, text, result.status, result.reason, now).first<Row>();
    await scheduleModeration(row!, "thread", result);
    return json({ ok: true, thread: publicThread(row!, true), message: result.status === "approved" ? "Discussion started." : "Your discussion is awaiting moderation." }, 201);
  }
  if (action === "reply") {
    const threadId = safeId(body.threadId, "Discussion");
    if (await targetKind(threadId) !== "thread") throw new HttpError(400, "Choose a discussion to reply to.");
    const text = textField(body.text, "Reply", 1, 2500);
    await consumeRateLimit(profile.userId, "reply", 20, 3600);
    const result = await moderation(text, "thread");
    await requireActiveWrite(profile.userId);
    // The parent may be removed or hidden while Claude checks the reply. Lock
    // it for this insert; thread deletion locks the parent before its replies.
    const row = await db.prepare("INSERT INTO replies (id, user_id, thread_id, text, status, moderation_reason, created_at) SELECT ?, ?, id, ?, ?, ?, ? FROM threads WHERE id = ? AND status = 'approved' FOR SHARE RETURNING *")
      .bind(id, profile.userId, text, result.status, result.reason, now, threadId).first<Row>();
    if (!row) throw new HttpError(409, "This discussion changed while your reply was checked. Refresh before replying again.");
    await scheduleModeration(row!, "reply", result);
    return json({ ok: true, reply: publicReply(row!, true), message: result.status === "approved" ? "Reply published." : "Your reply is awaiting moderation." }, 201);
  }
  if (action === "vote") {
    const targetId = safeId(body.targetId, "Contribution");
    const kind = textField(body.kind, "Vote", 1, 15);
    const target = await targetKind(targetId);
    if (!(target === "post" ? ["still", "gone"] : ["helpful", "unhelpful"]).includes(kind)) throw new HttpError(400, "This vote does not apply to that contribution.");
    await consumeRateLimit(profile.userId, "vote", 80, 3600);
    const targetPost = target === "post" ? await db.prepare("SELECT * FROM posts WHERE id = ?").bind(targetId).first<Row>() : null;
    if (targetPost && ["event", "freebie"].includes(String(targetPost.type)) && Number(targetPost.starts_at || 0) > now) {
      throw new HttpError(400, "This event has not started yet. Use Report pin if the listing has changed.");
    }
    if (targetPost?.type === "food") {
      if (targetPost.user_id === profile.userId) throw new HttpError(400, "Use your food availability controls to update your own alert.");
      if (targetPost.status !== "approved" || Number(targetPost.expires_at) <= now || Number(targetPost.starts_at || 0) > now || targetPost.closed_at != null) throw new HttpError(400, "This food collection is not available now.");
      const threshold = now - 30 * 60000;
      const [voted] = await db.batch([
        // Lock the collection row for this transaction so owner updates, expiry
        // decisions and concurrent feedback use the same availability version.
        db.prepare("INSERT INTO votes (id, user_id, target_id, kind, created_at) SELECT ?, ?, p.id, ?, ? FROM posts p WHERE p.id = ? AND p.type = 'food' AND p.status = 'approved' AND p.expires_at > ? AND (p.starts_at IS NULL OR p.starts_at <= ?) AND p.closed_at IS NULL AND p.user_id <> ? FOR UPDATE OF p ON CONFLICT(user_id, target_id) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at RETURNING id")
          .bind(id, profile.userId, kind, now, targetId, now, now, profile.userId),
        db.prepare("UPDATE posts p SET expires_at = LEAST(p.expires_at, ?), closure_reason = 'community-gone', closed_at = ?, moderation_revision = moderation_revision + 1 WHERE p.id = ? AND p.status = 'approved' AND p.expires_at > ? AND p.closed_at IS NULL AND (SELECT count(*) FROM votes v WHERE v.target_id = p.id AND v.kind = 'gone' AND v.user_id <> p.user_id AND v.created_at > GREATEST(?, COALESCE(p.availability_updated_at, p.created_at))) >= 3 AND (SELECT count(*) FROM votes v WHERE v.target_id = p.id AND v.kind = 'gone' AND v.user_id <> p.user_id AND v.created_at > GREATEST(?, COALESCE(p.availability_updated_at, p.created_at))) > (SELECT count(*) FROM votes v WHERE v.target_id = p.id AND v.kind = 'still' AND v.user_id <> p.user_id AND v.created_at > GREATEST(?, COALESCE(p.availability_updated_at, p.created_at)))")
          .bind(now, now, targetId, now, threshold, threshold, threshold),
      ]);
      if (!voted.results.length) throw new HttpError(409, "This food collection changed. Refresh before confirming availability.");
      const updated = await db.prepare("SELECT * FROM posts WHERE id = ?").bind(targetId).first<Row>();
      if (!updated) throw new HttpError(404, "This food alert is no longer available.");
      await hydrateFoodFeedback([updated]);
      return json({ ok: true, post: publicPost(updated, false), message: updated.closed_at ? "Thanks. Recent community reports have closed this alert." : "Thanks for confirming what you found." });
    }
    await db.prepare("INSERT INTO votes (id, user_id, target_id, kind, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, target_id) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at")
      .bind(id, profile.userId, targetId, kind, now).run();
    if (target === "post") {
      // Keep a durable closure revision so a later source scan cannot resurrect
      // an event that the community has already marked gone.
      await db.prepare("UPDATE posts SET expires_at = LEAST(expires_at, ?), closed_at = ?, closure_reason = 'community-gone', availability_updated_at = ?, moderation_revision = moderation_revision + 1 WHERE id = ? AND status = 'approved' AND expires_at > ? AND closed_at IS NULL AND (SELECT count(*) FROM votes WHERE target_id = ? AND kind = 'gone') >= 3 AND (SELECT count(*) FROM votes WHERE target_id = ? AND kind = 'gone') > (SELECT count(*) FROM votes WHERE target_id = ? AND kind = 'still')")
        .bind(now, now, now, targetId, now, targetId, targetId, targetId).run();
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
    const digest = await crypto.subtle.digest("SHA-256", clean.buffer as ArrayBuffer);
    const contentHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await database().prepare("INSERT INTO photos (key, user_id, mime, bytes, created_at, content_hash) VALUES (?, ?, ?, ?, ?, ?)").bind(key, profile.userId, type.mime, clean.length, Date.now(), contentHash).run();
  } catch (error) { await storage.remove([key]); throw error; }
  return json({ ok: true, key, url: `/api/community/photo?key=${encodeURIComponent(key)}` }, 201);
}

async function scheduleModeration(row: Row, kind: string, result: ModerationResult): Promise<void> {
  if (result.retryable) {
    await database().prepare("INSERT INTO moderation_retries (target_id, kind, revision, next_attempt_at) VALUES (?, ?, ?, ?) ON CONFLICT(target_id) DO UPDATE SET kind = excluded.kind, revision = excluded.revision, attempts = 0, next_attempt_at = excluded.next_attempt_at, lease_until = NULL WHERE moderation_retries.revision <= excluded.revision")
      .bind(row.id, kind, Number(row.moderation_revision || 0), Date.now() + 120000).run();
  } else await database().prepare("DELETE FROM moderation_retries WHERE target_id = ? AND revision <= ?").bind(row.id, Number(row.moderation_revision || 0)).run();
}

/** One due item per minute of traffic, three durable attempts, no approval after provider failure. */
async function drainModerationRetries(): Promise<void> {
  const db = database(); const now = Date.now();
  if (!(await runtimeEnv()).ANTHROPIC_API_KEY) return;
  const throttle = await db.prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO NOTHING RETURNING key").bind(`moderation-drain:${Math.floor(now / 60000)}`, now + 180000).first();
  if (!throttle) return;
  const job = await db.prepare("UPDATE moderation_retries SET attempts = attempts + 1, lease_until = ? WHERE target_id = (SELECT target_id FROM moderation_retries WHERE next_attempt_at <= ? AND (lease_until IS NULL OR lease_until < ?) AND attempts < 3 ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *")
    .bind(now + 180000, now, now).first<Row>();
  if (!job) return;
  const table = ({ review: "reviews", post: "posts", thread: "threads", reply: "replies" } as Record<string, string>)[String(job.kind)];
  const clear = () => db.prepare("DELETE FROM moderation_retries WHERE target_id = ? AND revision = ? AND attempts = ?").bind(job.target_id, job.revision, job.attempts).run();
  if (!table) { await clear(); return; }
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND moderation_revision = ? AND status = 'pending'`).bind(job.target_id, job.revision).first<Row>();
  if (!row || (job.kind === "post" && Number(row.expires_at) <= now)) { await clear(); return; }
  let result: ModerationResult;
  try {
    const content = [row.title, row.text, row.description, row.location, row.tags, row.term, row.collection_instructions, row.food_details].filter(Boolean).join("\n");
    const privateHome = job.kind === "review" && places.find((place) => place.id === row.place_id)?.category === "rental";
    result = await moderation(content, job.kind === "review" ? "review" : job.kind === "post" ? "pin" : "thread", privateHome);
    if (job.kind === "post" && row.photo_key && result.status === "approved") result = await photoModeration(String(row.photo_key), content);
  } catch { result = { status: "pending", reason: "A moderator needs to review this contribution." }; }
  // An edit, report or moderator decision made during the provider request wins.
  await db.prepare(`UPDATE ${table} SET status = ?, moderation_reason = ? WHERE id = ? AND moderation_revision = ? AND status = 'pending'`)
    .bind(result.status, result.reason, job.target_id, job.revision).run();
  if (!result.retryable || Number(job.attempts) >= 3) await clear();
  else await db.prepare("UPDATE moderation_retries SET next_attempt_at = ?, lease_until = NULL WHERE target_id = ? AND revision = ? AND attempts = ?")
    .bind(now + (Number(job.attempts) === 1 ? 5 : 20) * 60000, job.target_id, job.revision, job.attempts).run();
}

async function ownContributions(request: Request): Promise<Response> {
  const { userId } = await requireVerified();
  const offset = pageOffset(new URL(request.url).searchParams.get("offset"));
  const tables = ["reviews", "posts", "threads", "replies"];
  const maps = [publicReview, publicPost, publicThread, publicReply];
  const results = await database().batch(tables.map((table) => database().prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 51 OFFSET ?`).bind(userId, offset)));
  await hydrateFoodFeedback(results[1].results);
  return json({ ...Object.fromEntries(tables.map((table, i) => [table, results[i].results.slice(0, 50).map((row) => maps[i](row, true))])), nextOffset: results.some((result) => result.results.length > 50) ? offset + 50 : null });
}

async function sharedPin(request: Request): Promise<Response> {
  const id = safeId(new URL(request.url).searchParams.get("id"), "Pin");
  const row = await database().prepare("SELECT * FROM posts WHERE id = ? AND status = 'approved'").bind(id).first<Row>();
  if (!row) throw new HttpError(404, "This pin is not available.");
  await hydrateFoodFeedback([row]);
  const own = row.user_id === (await currentUser())?.userId;
  const expired = Number(row.expires_at) <= Date.now();
  return json({ post: { ...publicPost(row, own), expired, ...(expired ? { photoKey: null, photoUrl: null, image: undefined } : {}) } });
}

async function foodFeed(request: Request): Promise<Response> {
  const userId = (await currentUser())?.userId || "";
  const offset = pageOffset(new URL(request.url).searchParams.get("offset"));
  const now = Date.now();
  const active = "type = 'food' AND status = 'approved' AND expires_at > ? AND (starts_at IS NULL OR starts_at <= ?) AND closed_at IS NULL AND (portions_remaining IS NULL OR portions_remaining > 0)";
  const [rows, total] = await database().batch([
    database().prepare(`SELECT * FROM posts WHERE ${active} ORDER BY created_at DESC, id DESC LIMIT 40 OFFSET ?`).bind(now, now, offset),
    database().prepare(`SELECT count(*) AS total FROM posts WHERE ${active}`).bind(now, now),
  ]);
  await hydrateFoodFeedback(rows.results);
  const count = Number(total.results[0]?.total || 0);
  return json({ posts: rows.results.map((row) => publicPost(row, row.user_id === userId)), total: count, nextOffset: offset + rows.results.length < count ? offset + rows.results.length : null });
}

async function ownAction(userId: string, body: Row, action: string): Promise<Response> {
  const db = database();
  const targetId = safeId(body.targetId, "Contribution");
  await consumeRateLimit(userId, "manage-own", 30, 3600);
  if (action === "delete-own") {
    const kind = textField(body.kind, "Contribution type", 1, 10);
    const table = ({ review: "reviews", post: "posts", thread: "threads", reply: "replies" } as Record<string, string>)[kind];
    if (!table) throw new HttpError(400, "Choose a contribution to delete.");
    const own = await db.prepare(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`).bind(targetId, userId).first();
    if (!own) throw new HttpError(404, "Your contribution could not be found.");
    const statements = [db.prepare("DELETE FROM votes WHERE target_id = ?").bind(targetId), db.prepare("DELETE FROM reports WHERE target_id = ?").bind(targetId), db.prepare("DELETE FROM moderation_retries WHERE target_id = ?").bind(targetId)];
    if (kind === "thread") {
      statements.unshift(db.prepare("SELECT id FROM threads WHERE id = ? AND user_id = ? FOR UPDATE").bind(targetId, userId));
      statements.push(db.prepare("DELETE FROM votes WHERE target_id IN (SELECT id FROM replies WHERE thread_id = ?)").bind(targetId), db.prepare("DELETE FROM reports WHERE target_id IN (SELECT id FROM replies WHERE thread_id = ?)").bind(targetId), db.prepare("DELETE FROM moderation_retries WHERE target_id IN (SELECT id FROM replies WHERE thread_id = ?)").bind(targetId), db.prepare("DELETE FROM replies WHERE thread_id = ?").bind(targetId));
    }
    statements.push(db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).bind(targetId, userId));
    await db.batch(statements);
    return json({ ok: true, message: "Your contribution has been deleted." });
  }
  const post = await db.prepare("SELECT * FROM posts WHERE id = ? AND user_id = ?").bind(targetId, userId).first<Row>();
  if (!post) throw new HttpError(404, "Your alert could not be found.");
  if (action === "close-post") {
    const reason = textField(body.reason ?? "ended", "Closure reason", 1, 20);
    if (!["collected", "ended", "withdrawn"].includes(reason)) throw new HttpError(400, "Choose collected, ended or withdrawn.");
    if (post.closed_at != null) return json({ ok: true, post: publicPost(post, true), message: "This alert is already closed." });
    const closedAt = Date.now();
    const [result] = await db.batch([db.prepare("UPDATE posts SET expires_at = LEAST(expires_at, ?), portions_remaining = CASE WHEN type = 'food' AND ? = 'collected' THEN 0 ELSE portions_remaining END, closure_reason = COALESCE(closure_reason, ?), closed_at = COALESCE(closed_at, ?), availability_updated_at = ?, moderation_revision = moderation_revision + 1 WHERE id = ? AND user_id = ? AND closed_at IS NULL RETURNING *").bind(closedAt, reason, reason, closedAt, closedAt, targetId, userId), db.prepare("DELETE FROM moderation_retries WHERE target_id = ?").bind(targetId)]);
    const closed = result.results[0] || await db.prepare("SELECT * FROM posts WHERE id = ? AND user_id = ?").bind(targetId, userId).first<Row>();
    if (!closed) throw new HttpError(404, "Your alert could not be found.");
    return json({ ok: true, post: publicPost(closed, true), message: result.results.length ? "Your alert is closed and no longer appears on the live map." : "This alert is already closed." });
  }
  if (post.type === "food" && foodRevision(body.revision) !== Number(post.moderation_revision)) throw new HttpError(409, "This alert has changed. Refresh before updating it.");
  if (action === "food-availability") {
    if (post.type !== "food") throw new HttpError(400, "Availability controls apply only to food alerts.");
    if (!("portionsRemaining" in body)) throw new HttpError(400, "Provide a portion count or choose unknown.");
    const portions = foodPortions(body.portionsRemaining, true);
    const now = Date.now();
    const updated = await db.prepare("UPDATE posts SET portions_remaining = ?, availability_updated_at = ?, moderation_revision = moderation_revision + 1, expires_at = CASE WHEN ? = 0 THEN LEAST(expires_at, ?) ELSE expires_at END, closure_reason = CASE WHEN ? = 0 THEN 'collected' ELSE closure_reason END, closed_at = CASE WHEN ? = 0 THEN ? ELSE closed_at END WHERE id = ? AND user_id = ? AND type = 'food' AND status = 'approved' AND expires_at > ? AND (starts_at IS NULL OR starts_at <= ?) AND closed_at IS NULL AND moderation_revision = ? RETURNING *")
      .bind(portions, now, portions, now, portions, portions, now, targetId, userId, now, now, body.revision).first<Row>();
    if (!updated) throw new HttpError(409, "This collection has ended, is awaiting moderation or changed. Refresh the alert.");
    return json({ ok: true, post: publicPost(updated, true), message: portions === 0 ? "All collected. Your alert is closed." : "Food availability updated." });
  }
  if (post.status === "hidden" || post.closed_at != null || Number(post.expires_at) <= Date.now()) throw new HttpError(400, "Only an active alert can be updated. Create a new alert for a new collection.");
  const update = collectionUpdateInput({ ...body, collectionInstructions: body.collectionInstructions ?? post.collection_instructions, portionsRemaining: "portionsRemaining" in body ? body.portionsRemaining : post.portions_remaining });
  const foodDetails = post.type === "food" ? foodDetailsInput(body.foodDetails ?? parsed(post.food_details, {})) : null;
  if (post.type === "food") { textField(update.instructions, "Collection instructions", 5, 500); update.portions = foodPortions("portionsRemaining" in body ? body.portionsRemaining : post.portions_remaining, true); }
  if (update.portions !== null && post.type !== "food") throw new HttpError(400, "Portion counts apply only to food alerts.");
  const moderationText = `${post.title}\n${post.description}\n${post.location}\nCollection: ${update.instructions}\n${foodDetails ? JSON.stringify(foodDetails) : ""}`;
  const verdict = await moderation(moderationText, "pin");
  // A text edit cannot bypass a pending photo check.
  const result = post.photo_key && verdict.status === "approved" ? await photoModeration(String(post.photo_key), moderationText) : verdict;
  await requireActiveWrite(userId);
  const updatedAt = Date.now();
  const row = await db.prepare("UPDATE posts SET collection_instructions = ?, portions_remaining = ?, food_details = ?, availability_updated_at = ?, status = ?, moderation_reason = ?, moderation_revision = moderation_revision + 1, expires_at = CASE WHEN ? = 0 THEN LEAST(expires_at, ?) ELSE expires_at END, closure_reason = CASE WHEN ? = 0 THEN 'collected' ELSE closure_reason END, closed_at = CASE WHEN ? = 0 THEN ? ELSE closed_at END WHERE id = ? AND user_id = ? AND moderation_revision = ? AND status <> 'hidden' AND expires_at > ? AND closed_at IS NULL RETURNING *")
    .bind(update.instructions, update.portions, JSON.stringify(foodDetails || {}), updatedAt, result.status, result.reason, update.portions, updatedAt, update.portions, update.portions, updatedAt, targetId, userId, post.moderation_revision, updatedAt).first<Row>();
  if (!row) throw new HttpError(409, "This alert changed while it was being checked. Refresh your contributions.");
  await scheduleModeration(row!, "post", result);
  return json({ ok: true, post: publicPost(row!, true), message: result.status === "approved" ? "Collection details updated." : "Your changes are awaiting moderation." });
}

async function placePage(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const placeId = safeId(search.get("placeId"), "Place"); placeCategory(placeId);
  const kind = search.get("kind") || "reviews";
  if (!["reviews", "threads", "replies"].includes(kind)) throw new HttpError(400, "Choose reviews or discussions.");
  const userId = (await currentUser())?.userId || "";
  const offset = pageOffset(search.get("offset"));
  let where = "place_id = ? AND (status = 'approved' OR user_id = ?)";
  let target = placeId;
  if (kind === "replies") {
    target = safeId(search.get("threadId"), "Discussion");
    const thread = await database().prepare("SELECT id FROM threads WHERE id = ? AND place_id = ? AND (status = 'approved' OR user_id = ?)").bind(target, placeId, userId).first();
    if (!thread) throw new HttpError(404, "That discussion is no longer available.");
    where = "thread_id = ? AND (status = 'approved' OR user_id = ?)";
  }
  const [rows, totals] = await database().batch([
    database().prepare(`SELECT *, (SELECT count(*) FROM votes WHERE target_id = ${kind}.id AND kind = 'helpful') AS helpful, (SELECT count(*) FROM votes WHERE target_id = ${kind}.id AND kind = 'unhelpful') AS unhelpful${kind === "threads" ? ", (SELECT count(*) FROM replies WHERE thread_id = threads.id AND status = 'approved') AS reply_count" : ""} FROM ${kind} WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 30 OFFSET ?`).bind(target, userId, offset),
    database().prepare(`SELECT count(*) AS total FROM ${kind} WHERE ${where}`).bind(target, userId),
  ]);
  const total = Number(totals.results[0]?.total || 0);
  const transform = kind === "reviews" ? publicReview : kind === "threads" ? publicThread : publicReply;
  return json({ rows: rows.results.map((row) => ({ ...transform(row, row.user_id === userId), helpful: Number(row.helpful), unhelpful: Number(row.unhelpful), ...(kind === "threads" ? { replies: Number(row.reply_count) } : {}) })), total, nextOffset: offset + rows.results.length < total ? offset + rows.results.length : null });
}

async function submitRequest(request: Request): Promise<Response> {
  const data = communityRequestInput(await jsonBody(request));
  const userId = data.kind === "correction" ? (await requireVerified()).userId : null;
  if (data.kind === "correction") placeCategory(data.targetId);
  // The raw address is not retained, and contact details stay in the protected queue.
  await consumeRateLimit(await sha256(clientAddress(request)), "public-request", 5, 3600);
  if (data.contact) await consumeRateLimit(await sha256(data.contact), "request-contact", 5, 86400);
  if (userId) await consumeRateLimit(userId, "correction", 10, 86400);
  await retentionSweep();
  const id = crypto.randomUUID();
  await database().prepare("INSERT INTO community_requests (id, kind, user_id, contact, target_id, reason, evidence_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, data.kind, userId, data.contact, data.targetId, data.reason, data.evidenceUrl, Date.now()).run();
  return json({ ok: true, reference: id, message: data.kind === "correction" ? "Correction saved for source verification. The map has not been changed." : "Your request has been sent privately to the site moderators. Keep this reference for follow-up." }, 201);
}

/** Bounded, traffic-triggered retention; reported/hidden/pending pins are preserved for review. */
async function retentionSweep(): Promise<void> {
  try {
    const db = database(); const now = Date.now(); const day = 86400000;
    const claimed = await db.prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO NOTHING RETURNING key").bind(`maintenance:${Math.floor(now / 3600000)}`, now + 2 * 3600000).first();
    if (!claimed) return;
    await db.batch([
      db.prepare("DELETE FROM votes WHERE target_id IN (SELECT id FROM posts WHERE status = 'approved' AND expires_at < ? AND NOT EXISTS (SELECT 1 FROM reports WHERE target_id = posts.id) AND NOT EXISTS (SELECT 1 FROM community_requests WHERE target_id = posts.id AND status = 'pending') ORDER BY expires_at ASC LIMIT 50)").bind(now - 30 * day),
      db.prepare("DELETE FROM posts WHERE id IN (SELECT id FROM posts WHERE status = 'approved' AND expires_at < ? AND NOT EXISTS (SELECT 1 FROM reports WHERE target_id = posts.id) AND NOT EXISTS (SELECT 1 FROM community_requests WHERE target_id = posts.id AND status = 'pending') ORDER BY expires_at ASC LIMIT 50)").bind(now - 30 * day),
      db.prepare("DELETE FROM community_requests WHERE status = 'resolved' AND resolved_at < ?").bind(now - 90 * day),
    ]);
    const storage = photoStorage();
    if (!storage) return;
    const orphaned = await db.prepare("SELECT key FROM photos WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM posts WHERE photo_key = photos.key) ORDER BY created_at ASC LIMIT 20").bind(now - 7 * day).all<{ key: string }>();
    if (!orphaned.results.length) return;
    const removed = await storage.remove(orphaned.results.map((row) => row.key));
    if (!removed.error) await db.batch(orphaned.results.map((row) => db.prepare("DELETE FROM photos WHERE key = ? AND NOT EXISTS (SELECT 1 FROM posts WHERE photo_key = photos.key)").bind(row.key)));
  } catch { /* Maintenance never turns a successful contribution into a failed submission. */ }
}

async function preferences(request?: Request): Promise<Response> {
  const { userId } = await requireVerified();
  if (!request) {
    const row = await database().prepare("SELECT collections, follows FROM community_preferences WHERE user_id = ?").bind(userId).first<Row>();
    return json({ collections: parsed(row?.collections, []), follows: parsed(row?.follows, []) });
  }
  await consumeRateLimit(userId, "preferences", 60, 3600);
  const body = await jsonBody(request);
  const ids = (value: unknown, max: number) => {
    if (!Array.isArray(value) || value.length > max) throw new HttpError(400, "That collection has too many places.");
    return [...new Set(value.map((item) => { const id = safeId(item, "Place"); placeCategory(id); return id; }))];
  };
  const rawCollections = body.collections ?? [];
  if (!Array.isArray(rawCollections) || rawCollections.length > 20) throw new HttpError(400, "Keep at most 20 collections.");
  const collections = rawCollections.map((value) => { const item = record(value); return { id: safeId(item.id), name: textField(item.name, "Collection name", 1, 60), placeIds: ids(item.placeIds, 120) }; });
  if (new Set(collections.map((item) => item.id)).size !== collections.length) throw new HttpError(400, "Collection references must be unique.");
  const follows = ids(body.follows ?? [], 200);
  const saved = await database().prepare("INSERT INTO community_preferences (user_id, collections, follows, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET collections = CASE WHEN ? THEN excluded.collections ELSE community_preferences.collections END, follows = CASE WHEN ? THEN excluded.follows ELSE community_preferences.follows END, updated_at = excluded.updated_at RETURNING collections, follows")
    .bind(userId, JSON.stringify(collections), JSON.stringify(follows), Date.now(), body.collections !== undefined, body.follows !== undefined).first<Row>();
  return json({ ok: true, collections: parsed(saved?.collections, []), follows: parsed(saved?.follows, []) });
}

async function inboxEntries(userId: string, follows: unknown): Promise<Row[]> {
  const entries = await database().prepare("SELECT r.id, 'reply' AS kind, t.place_id, t.title, r.text, r.created_at, r.moderation_revision FROM replies r JOIN threads t ON t.id = r.thread_id WHERE r.status = 'approved' AND t.status = 'approved' AND r.user_id <> ? AND (t.user_id = ? OR EXISTS (SELECT 1 FROM replies own WHERE own.thread_id = t.id AND own.user_id = ?)) UNION ALL SELECT id, 'thread' AS kind, place_id, title, text, created_at, moderation_revision FROM threads WHERE status = 'approved' AND user_id <> ? AND place_id IN (SELECT jsonb_array_elements_text(?::jsonb)) UNION ALL SELECT id, 'review' AS kind, place_id, 'New student review' AS title, text, created_at, moderation_revision FROM reviews WHERE status = 'approved' AND user_id <> ? AND place_id IN (SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY created_at DESC, id DESC LIMIT 100")
    .bind(userId, userId, userId, userId, JSON.stringify(follows), userId, JSON.stringify(follows)).all<Row>();
  return entries.results;
}

function inboxEntryKey(row: Row): string { return `${row.kind}:${row.id}:${row.moderation_revision}`; }
function seenInboxEntries(preference: Row | null): string[] {
  const value = parsed(preference?.inbox_seen_ids, []);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(-500) : [];
}

async function inbox(): Promise<Response> {
  const { userId } = await requireVerified();
  const preference = await database().prepare("SELECT follows, inbox_seen_ids FROM community_preferences WHERE user_id = ?").bind(userId).first<Row>();
  const entries = await inboxEntries(userId, parsed(preference?.follows, []));
  const seen = new Set(seenInboxEntries(preference));
  return json({ entries: entries.map((row) => ({ id: row.id, kind: row.kind, placeId: row.place_id, title: row.title, text: row.text, createdAt: iso(row.created_at), read: seen.has(inboxEntryKey(row)) })) });
}

async function readInbox(): Promise<Response> {
  const { userId } = await requireVerified();
  await consumeRateLimit(userId, "inbox-read", 60, 3600);
  const preference = await database().prepare("SELECT follows, inbox_seen_ids FROM community_preferences WHERE user_id = ?").bind(userId).first<Row>();
  // Snapshot only content currently visible to this account. A draft approved
  // after this query stays unread regardless of when the draft was created.
  const entries = await inboxEntries(userId, parsed(preference?.follows, []));
  const current = entries.map(inboxEntryKey);
  const seen = [...seenInboxEntries(preference).filter((id) => !current.includes(id)), ...current].slice(-500);
  await database().prepare("INSERT INTO community_preferences (user_id, inbox_seen_ids, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET inbox_seen_ids = excluded.inbox_seen_ids, updated_at = excluded.updated_at").bind(userId, JSON.stringify(seen), Date.now()).run();
  return json({ ok: true });
}

async function maintenance(): Promise<Response> {
  const { userId } = await requireModerator();
  await consumeRateLimit(userId, "maintenance", 4, 3600);
  await drainModerationRetries(); await retentionSweep();
  return json({ ok: true, message: "Due maintenance checked. Retry and retention limits remain in place." });
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

export async function requireModerator(): Promise<VerifiedProfile> {
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
    ...["reviews", "posts", "threads", "replies"].map((table) => db.prepare(`SELECT * FROM ${table} WHERE status IN ('pending', 'hidden') OR id IN (SELECT target_id FROM reports) ORDER BY CASE WHEN status = 'pending' THEN 0 WHEN id IN (SELECT target_id FROM reports) THEN 1 ELSE 2 END, created_at ASC, id ASC LIMIT 200`)),
    db.prepare("SELECT id, target_id, reason, created_at FROM reports ORDER BY created_at DESC LIMIT 500"),
    db.prepare("SELECT id, kind, contact, target_id, reason, evidence_url, status, moderator_note, created_at FROM community_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 200"),
  ]);
  const maps = [publicReview, publicPost, publicThread, publicReply];
  return json({ queue: result.slice(0, 4).flatMap((table, i) => table.results.map((row) => ({ ...maps[i](row), kind: ["review", "post", "thread", "reply"][i], moderationReason: row.moderation_reason }))), reports: result[4].results.map((row) => ({ id: row.id, targetId: row.target_id, reason: row.reason, createdAt: iso(row.created_at) })), requests: result[5].results.map((row) => ({ id: row.id, kind: row.kind, contact: row.contact, targetId: row.target_id, reason: row.reason, evidenceUrl: row.evidence_url, createdAt: iso(row.created_at) })) });
}

async function moderateAction(request: Request): Promise<Response> {
  const profile = await requireModerator();
  const body = await jsonBody(request);
  if (body.decision === "resolve-request") {
    const requestId = safeId(body.requestId, "Request");
    const note = textField(body.reason, "Resolution note", 4, 500);
    const resolved = await database().prepare("UPDATE community_requests SET status = 'resolved', moderator_note = ?, resolved_at = ? WHERE id = ? AND status = 'pending' RETURNING id").bind(note, Date.now(), requestId).first();
    if (!resolved) throw new HttpError(404, "This request is no longer pending.");
    return json({ ok: true, message: "Request resolved. Corrections require a separately verified catalogue change." });
  }
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
      const privateHome = table === "reviews" && places.find((place) => place.id === row.place_id)?.category === "rental";
      const privacy = privateInformationReason([row.title, row.text, row.description, row.location, row.tags, row.term, row.collection_instructions, row.food_details, row.freebie_json].filter(Boolean).join("\n"), privateHome);
      if (privacy) throw new HttpError(400, privacy);
    }
    await database().batch([
      database().prepare(`UPDATE ${table} SET status = ?, moderation_reason = ?, moderation_revision = moderation_revision + 1 WHERE id = ?`).bind(decision === "approve" ? "approved" : "hidden", reason || null, targetId),
      database().prepare("DELETE FROM reports WHERE target_id = ?").bind(targetId),
      database().prepare("DELETE FROM moderation_retries WHERE target_id = ?").bind(targetId),
    ]);
    return json({ ok: true, status: decision === "approve" ? "approved" : "hidden" });
  }
  throw new HttpError(404, "Contribution not found.");
}

async function exportAccount(): Promise<Response> {
  const userId = await identity();
  const db = database();
  const tables = ["profiles", "reviews", "posts", "threads", "replies", "votes", "reports", "photos", "community_requests", "community_preferences"] as const;
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
    db.prepare("SELECT id FROM threads WHERE user_id = ? FOR UPDATE").bind(userId),
    db.prepare("DELETE FROM moderation_retries WHERE target_id IN (SELECT id FROM reviews WHERE user_id = ? UNION SELECT id FROM posts WHERE user_id = ? UNION SELECT id FROM threads WHERE user_id = ? UNION SELECT id FROM replies WHERE user_id = ? UNION SELECT r.id FROM replies r JOIN threads t ON t.id = r.thread_id WHERE t.user_id = ?)").bind(userId, userId, userId, userId, userId),
    db.prepare("DELETE FROM votes WHERE target_id IN (SELECT id FROM reviews WHERE user_id = ? UNION SELECT id FROM posts WHERE user_id = ? UNION SELECT id FROM threads WHERE user_id = ? UNION SELECT id FROM replies WHERE user_id = ?)").bind(userId, userId, userId, userId),
    db.prepare("DELETE FROM reports WHERE target_id IN (SELECT id FROM reviews WHERE user_id = ? UNION SELECT id FROM posts WHERE user_id = ? UNION SELECT id FROM threads WHERE user_id = ? UNION SELECT id FROM replies WHERE user_id = ?)").bind(userId, userId, userId, userId),
    db.prepare("DELETE FROM votes WHERE target_id IN (SELECT r.id FROM replies r JOIN threads t ON t.id = r.thread_id WHERE t.user_id = ?)").bind(userId),
    db.prepare("DELETE FROM reports WHERE target_id IN (SELECT r.id FROM replies r JOIN threads t ON t.id = r.thread_id WHERE t.user_id = ?)").bind(userId),
    db.prepare("DELETE FROM replies WHERE thread_id IN (SELECT id FROM threads WHERE user_id = ?)").bind(userId),
    ...["reviews", "posts", "threads", "replies", "votes", "reports", "photos", "profiles", "community_requests", "community_preferences"].map((table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId)),
    db.prepare("DELETE FROM rate_limits WHERE key LIKE ? ESCAPE '\\'").bind(`%:${userId.replace(/[\\%_]/g, "\\$&") }:%`),
  ]);
  const removed = await admin.auth.admin.deleteUser(userId);
  if (removed.error) throw new HttpError(503, "Your community data was deleted, but your sign-in account could not be deleted. Please retry account deletion.");
  // Auth no longer recognises this account, even if cookie cleanup is briefly
  // unavailable. Retain the session until this point so partial deletion can retry.
  try { await (await authClient())?.auth.signOut(); } catch { /* Deleted identity cannot authorise another request. */ }
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
      if (endpoint === "contributions") return await ownContributions(request);
      if (endpoint === "pin") return await sharedPin(request);
      if (endpoint === "food") return await foodFeed(request);
      if (endpoint === "place") return await placePage(request);
      if (endpoint === "preferences") return await preferences();
      if (endpoint === "inbox") return await inbox();
    }
    if (request.method === "POST" || request.method === "DELETE") assertSameOrigin(request);
    if (request.method === "POST") {
      if (endpoint === "auth/signup") return await passwordAuth(request, "signup");
      if (endpoint === "auth/signin") return await passwordAuth(request, "signin");
      if (endpoint === "auth/signout") return await signOut();
      if (endpoint === "action") return await action(request);
      if (endpoint === "upload") return await upload(request);
      if (endpoint === "moderation") return await moderateAction(request);
      if (endpoint === "request") return await submitRequest(request);
      if (endpoint === "preferences") return await preferences(request);
      if (endpoint === "inbox/read") return await readInbox();
      if (endpoint === "maintenance") return await maintenance();
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
