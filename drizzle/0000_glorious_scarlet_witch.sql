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
CREATE TABLE `admin_departments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminProfileId` int NOT NULL,
	`departmentId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_departments_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_departments_admin_department_unique` UNIQUE(`adminProfileId`,`departmentId`)
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
	`departmentId` int NOT NULL,
	`date` date NOT NULL,
	`federation` varchar(80) NOT NULL,
	`status` enum('AVAILABLE','PENDING_CONFIRMATION','CONFIRMED','UNAVAILABLE') NOT NULL DEFAULT 'AVAILABLE',
	`internalNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `date_slots_id` PRIMARY KEY(`id`),
	CONSTRAINT `date_slots_department_federation_date_unique` UNIQUE(`departmentId`,`federation`,`date`)
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(80) NOT NULL,
	`name` varchar(180) NOT NULL,
	`active` enum('YES','NO') NOT NULL DEFAULT 'YES',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `departments_id` PRIMARY KEY(`id`),
	CONSTRAINT `departments_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int,
	`recipient` varchar(320) NOT NULL,
	`replyTo` varchar(320) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`html` text NOT NULL,
	`status` enum('PENDING','PREVIEW','SENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` text,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `google_mail_connections` (
	`id` int NOT NULL,
	`mailboxEmail` varchar(320) NOT NULL,
	`refreshTokenEncrypted` text NOT NULL,
	`connectedBy` varchar(80) NOT NULL,
	`connectedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `google_mail_connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `intervention_types` (
	`id` int AUTO_INCREMENT NOT NULL,
	`departmentId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`active` enum('YES','NO') NOT NULL DEFAULT 'YES',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `intervention_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `intervention_types_department_name_unique` UNIQUE(`departmentId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `invitation_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`submissionId` varchar(64) NOT NULL,
	`dateSlotId` int NOT NULL,
	`departmentId` int NOT NULL,
	`interventionTypeId` int,
	`federation` varchar(80) NOT NULL,
	`church` varchar(180) NOT NULL,
	`contactName` varchar(180) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(80) NOT NULL,
	`interventionType` varchar(80),
	`message` text,
	`desiredTime` varchar(40),
	`churchAddress` text,
	`googleCalendarEventId` varchar(255),
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
CREATE TABLE `microsoft_mail_connections` (
	`id` int NOT NULL,
	`mailboxEmail` varchar(320) NOT NULL,
	`refreshTokenEncrypted` text NOT NULL,
	`connectedBy` varchar(80) NOT NULL,
	`connectedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `microsoft_mail_connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `microsoft_oauth_states` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stateHash` varchar(64) NOT NULL,
	`verifierEncrypted` text NOT NULL,
	`userId` int NOT NULL,
	`platform` enum('web','native') NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `microsoft_oauth_states_id` PRIMARY KEY(`id`),
	CONSTRAINT `microsoft_oauth_states_stateHash_unique` UNIQUE(`stateHash`)
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
	`slotDate` date NOT NULL,
	`reminderKind` enum('D30','D7','D1') NOT NULL,
	`recipient` varchar(320) NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reminder_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `reminder_request_date_kind_recipient_unique` UNIQUE(`requestId`,`slotDate`,`reminderKind`,`recipient`)
);
--> statement-breakpoint
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
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE INDEX `action_tokens_request_idx` ON `action_tokens` (`requestId`,`action`);--> statement-breakpoint
CREATE INDEX `admin_departments_admin_idx` ON `admin_departments` (`adminProfileId`);--> statement-breakpoint
CREATE INDEX `admin_departments_department_idx` ON `admin_departments` (`departmentId`);--> statement-breakpoint
CREATE INDEX `admin_profiles_active_idx` ON `admin_profiles` (`active`);--> statement-breakpoint
CREATE INDEX `audit_log_request_idx` ON `audit_log` (`requestId`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `date_slots_status_date_idx` ON `date_slots` (`status`,`date`);--> statement-breakpoint
CREATE INDEX `date_slots_department_status_date_idx` ON `date_slots` (`departmentId`,`status`,`date`);--> statement-breakpoint
CREATE INDEX `date_slots_department_federation_status_date_idx` ON `date_slots` (`departmentId`,`federation`,`status`,`date`);--> statement-breakpoint
CREATE INDEX `departments_active_idx` ON `departments` (`active`);--> statement-breakpoint
CREATE INDEX `email_outbox_status_idx` ON `email_outbox` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `intervention_types_department_active_idx` ON `intervention_types` (`departmentId`,`active`);--> statement-breakpoint
CREATE INDEX `invitation_requests_date_idx` ON `invitation_requests` (`dateSlotId`);--> statement-breakpoint
CREATE INDEX `invitation_requests_department_idx` ON `invitation_requests` (`departmentId`);--> statement-breakpoint
CREATE INDEX `invitation_requests_intervention_type_idx` ON `invitation_requests` (`interventionTypeId`);--> statement-breakpoint
CREATE INDEX `invitation_requests_status_idx` ON `invitation_requests` (`status`,`submittedAt`);--> statement-breakpoint
CREATE INDEX `invitation_requests_federation_idx` ON `invitation_requests` (`federation`);--> statement-breakpoint
CREATE INDEX `invitation_requests_church_idx` ON `invitation_requests` (`church`);--> statement-breakpoint
CREATE INDEX `microsoft_oauth_expiry_idx` ON `microsoft_oauth_states` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `scheduled_jobs_active_idx` ON `scheduled_jobs` (`active`);