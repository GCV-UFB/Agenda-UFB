ALTER TABLE `date_slots` ADD `federation` varchar(80);--> statement-breakpoint
CREATE INDEX `date_slots_federation_status_date_idx` ON `date_slots` (`federation`,`status`,`date`);--> statement-breakpoint
UPDATE `date_slots` ds
JOIN `invitation_requests` ir
  ON ir.`dateSlotId` = ds.`id`
SET ds.`federation` = ir.`federation`
WHERE ds.`federation` IS NULL
  AND ir.`status` IN ('PENDING', 'CONFIRMED');
