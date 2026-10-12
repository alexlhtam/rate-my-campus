ALTER TABLE `posts` ADD `starts_at` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `source_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `posts_source_url_unique` ON `posts` (`source_url`);