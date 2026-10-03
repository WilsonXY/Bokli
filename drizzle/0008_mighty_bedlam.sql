CREATE TABLE `operating_expense_add_requests` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`type` text NOT NULL,
	`amount_sen` integer NOT NULL,
	`note` text,
	`result` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
