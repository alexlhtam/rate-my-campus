import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// Hosted identity is provided by Sites. This table records separately verified UCL membership.
export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  verifiedAt: integer("verified_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("profiles_email_unique").on(t.email)]);

export const emailCodes = sqliteTable("email_codes", {
  userId: text("user_id").primaryKey(), email: text("email").notNull(),
  codeHash: text("code_hash").notNull(), salt: text("salt").notNull(),
  expiresAt: integer("expires_at").notNull(), attempts: integer("attempts").notNull().default(0),
});

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), count: integer("count").notNull().default(1),
  expiresAt: integer("expires_at").notNull(),
});

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), placeId: text("place_id").notNull(),
  rating: real("rating").notNull(), criteria: text("criteria").notNull(), tags: text("tags").notNull(),
  text: text("text").notNull(), term: text("term").notNull(), recommend: integer("recommend").notNull(),
  status: text("status").notNull().default("pending"), moderationReason: text("moderation_reason"),
  createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("reviews_user_place").on(t.userId, t.placeId), index("reviews_status_created").on(t.status, t.createdAt)]);

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), type: text("type").notNull(),
  title: text("title").notNull(), description: text("description").notNull(), location: text("location").notNull(),
  lat: real("lat").notNull(), lng: real("lng").notNull(), expiresAt: integer("expires_at").notNull(),
  startsAt: integer("starts_at"), sourceUrl: text("source_url"), sourceName: text("source_name"),
  dietary: text("dietary").notNull(), photoKey: text("photo_key"), price: real("price"), originalPrice: real("original_price"),
  status: text("status").notNull().default("pending"), moderationReason: text("moderation_reason"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("posts_status_expiry").on(t.status, t.expiresAt), uniqueIndex("posts_source_url_unique").on(t.sourceUrl)]);

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), placeId: text("place_id").notNull(),
  title: text("title").notNull(), text: text("text").notNull(), status: text("status").notNull().default("pending"),
  moderationReason: text("moderation_reason"), createdAt: integer("created_at").notNull(),
}, (t) => [index("threads_place").on(t.placeId)]);

export const replies = sqliteTable("replies", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), threadId: text("thread_id").notNull(),
  text: text("text").notNull(), status: text("status").notNull().default("pending"),
  moderationReason: text("moderation_reason"), createdAt: integer("created_at").notNull(),
}, (t) => [index("replies_thread").on(t.threadId)]);

export const votes = sqliteTable("votes", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), targetId: text("target_id").notNull(),
  kind: text("kind").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("votes_user_target").on(t.userId, t.targetId), index("votes_target").on(t.targetId)]);

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), targetId: text("target_id").notNull(),
  reason: text("reason").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("reports_user_target").on(t.userId, t.targetId)]);

export const photos = sqliteTable("photos", {
  key: text("key").primaryKey(), userId: text("user_id").notNull(), mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(), createdAt: integer("created_at").notNull(),
});
