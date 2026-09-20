CREATE TABLE "suites" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"finished_at" bigint,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "suite_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "repeat" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_suite_id_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_suite" ON "runs" USING btree ("suite_id");