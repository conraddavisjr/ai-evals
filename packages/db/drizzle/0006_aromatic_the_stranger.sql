CREATE TABLE "benches" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"config" jsonb NOT NULL,
	"report" jsonb,
	"error" text,
	"created_at" bigint NOT NULL,
	"finished_at" bigint
);
