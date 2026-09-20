CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tx_id" text NOT NULL,
	"order_id" text,
	"reviewer_spec" text NOT NULL,
	"verdict" text NOT NULL,
	"issues" jsonb NOT NULL,
	"summary" text NOT NULL,
	"brief" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;