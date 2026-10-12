CREATE TABLE `email_codes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`salt` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`location` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`expires_at` integer NOT NULL,
	`dietary` text NOT NULL,
	`photo_key` text,
	`price` real,
	`original_price` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`moderation_reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `posts_status_expiry` ON `posts` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`verified_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_email_unique` ON `profiles` (`email`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `replies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`moderation_reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `replies_thread` ON `replies` (`thread_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_user_target` ON `reports` (`user_id`,`target_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`place_id` text NOT NULL,
	`rating` real NOT NULL,
	`criteria` text NOT NULL,
	`tags` text NOT NULL,
	`text` text NOT NULL,
	`term` text NOT NULL,
	`recommend` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`moderation_reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_user_place` ON `reviews` (`user_id`,`place_id`);--> statement-breakpoint
CREATE INDEX `reviews_status_created` ON `reviews` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`place_id` text NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`moderation_reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `threads_place` ON `threads` (`place_id`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_user_target` ON `votes` (`user_id`,`target_id`);--> statement-breakpoint
CREATE INDEX `votes_target` ON `votes` (`target_id`);