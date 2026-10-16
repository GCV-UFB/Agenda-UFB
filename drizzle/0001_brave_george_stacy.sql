CREATE TABLE `admin_credentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminProfileId` int NOT NULL,
	`passwordHash` varchar(512) NOT NULL,
	`failedAttempts` int NOT NULL DEFAULT 0,
	`lockedUntil` timestamp,
	`passwordChangedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_credentials_adminProfileId_unique` UNIQUE(`adminProfileId`)
);
--> statement-breakpoint
CREATE INDEX `admin_credentials_locked_idx` ON `admin_credentials` (`lockedUntil`);