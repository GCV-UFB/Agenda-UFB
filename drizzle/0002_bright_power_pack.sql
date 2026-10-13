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
CREATE INDEX `microsoft_oauth_expiry_idx` ON `microsoft_oauth_states` (`expiresAt`);