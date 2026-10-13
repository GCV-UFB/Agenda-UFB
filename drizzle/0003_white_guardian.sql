CREATE TABLE `scheduled_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobKey` varchar(80) NOT NULL,
	`taskUid` varchar(160),
	`active` enum('YES','NO') NOT NULL DEFAULT 'YES',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduled_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_jobs_jobKey_unique` UNIQUE(`jobKey`),
	CONSTRAINT `scheduled_jobs_taskUid_unique` UNIQUE(`taskUid`)
);
--> statement-breakpoint
ALTER TABLE `reminder_log` DROP INDEX `reminder_request_kind_unique`;--> statement-breakpoint
ALTER TABLE `invitation_requests` MODIFY COLUMN `interventionType` varchar(80);--> statement-breakpoint
ALTER TABLE `reminder_log` ADD `slotDate` date NOT NULL;--> statement-breakpoint
ALTER TABLE `reminder_log` ADD `recipient` varchar(320) NOT NULL;--> statement-breakpoint
ALTER TABLE `reminder_log` ADD CONSTRAINT `reminder_request_date_kind_recipient_unique` UNIQUE(`requestId`,`slotDate`,`reminderKind`,`recipient`);--> statement-breakpoint
CREATE INDEX `scheduled_jobs_active_idx` ON `scheduled_jobs` (`active`);