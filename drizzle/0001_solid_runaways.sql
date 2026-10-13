CREATE TABLE `action_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`action` enum('CONFIRM','RELEASE') NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `action_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `action_tokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `admin_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('PRIMARY_ADMIN','ADMIN','READ_ONLY') NOT NULL DEFAULT 'ADMIN',
	`active` enum('YES','NO') NOT NULL DEFAULT 'YES',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_profiles_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `admin_profiles_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settingKey` varchar(120) NOT NULL,
	`settingValue` text NOT NULL,
	`updatedBy` varchar(320),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_settings_settingKey_unique` UNIQUE(`settingKey`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`action` varchar(120) NOT NULL,
	`entityType` varchar(80) NOT NULL,
	`entityId` varchar(80) NOT NULL,
	`requestId` int,
	`actor` varchar(320),
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `date_slots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` date NOT NULL,
	`status` enum('AVAILABLE','PENDING_CONFIRMATION','CONFIRMED','UNAVAILABLE') NOT NULL DEFAULT 'AVAILABLE',
	`internalNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `date_slots_id` PRIMARY KEY(`id`),
	CONSTRAINT `date_slots_date_unique` UNIQUE(`date`)
);
--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int,
	`recipient` varchar(320) NOT NULL,
	`replyTo` varchar(320) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`html` text NOT NULL,
	`status` enum('PENDING','PREVIEW','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` text,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invitation_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`submissionId` varchar(64) NOT NULL,
	`dateSlotId` int NOT NULL,
	`federation` varchar(80) NOT NULL,
	`church` varchar(180) NOT NULL,
	`contactName` varchar(180) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(80) NOT NULL,
	`interventionType` varchar(80) NOT NULL,
	`message` text,
	`desiredTime` varchar(40),
	`churchAddress` text,
	`consentAt` timestamp NOT NULL,
	`status` enum('PENDING','CONFIRMED','REFUSED','CANCELLED','RESCHEDULED') NOT NULL DEFAULT 'PENDING',
	`submittedAt` timestamp NOT NULL DEFAULT (now()),
	`decisionAt` timestamp,
	`decisionBy` varchar(160),
	`decisionNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invitation_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitation_requests_submissionId_unique` UNIQUE(`submissionId`)
);
--> statement-breakpoint
CREATE TABLE `privacy_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`requestType` enum('ACCESS','DELETE') NOT NULL,
	`message` text,
	`status` enum('NEW','IN_PROGRESS','COMPLETED') NOT NULL DEFAULT 'NEW',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `privacy_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reminder_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`reminderKind` enum('D30','D7','D1') NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reminder_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `reminder_request_kind_unique` UNIQUE(`requestId`,`reminderKind`)
);
--> statement-breakpoint
CREATE INDEX `action_tokens_request_idx` ON `action_tokens` (`requestId`,`action`);--> statement-breakpoint
CREATE INDEX `admin_profiles_active_idx` ON `admin_profiles` (`active`);--> statement-breakpoint
CREATE INDEX `audit_log_request_idx` ON `audit_log` (`requestId`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `date_slots_status_date_idx` ON `date_slots` (`status`,`date`);--> statement-breakpoint
CREATE INDEX `email_outbox_status_idx` ON `email_outbox` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `invitation_requests_date_idx` ON `invitation_requests` (`dateSlotId`);--> statement-breakpoint
CREATE INDEX `invitation_requests_status_idx` ON `invitation_requests` (`status`,`submittedAt`);--> statement-breakpoint
CREATE INDEX `invitation_requests_federation_idx` ON `invitation_requests` (`federation`);--> statement-breakpoint
CREATE INDEX `invitation_requests_church_idx` ON `invitation_requests` (`church`);