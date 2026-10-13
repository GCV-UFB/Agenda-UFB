CREATE TABLE `google_mail_connections` (
	`id` int NOT NULL,
	`mailboxEmail` varchar(320) NOT NULL,
	`refreshTokenEncrypted` text NOT NULL,
	`connectedBy` varchar(80) NOT NULL,
	`connectedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `google_mail_connections_id` PRIMARY KEY(`id`)
);
