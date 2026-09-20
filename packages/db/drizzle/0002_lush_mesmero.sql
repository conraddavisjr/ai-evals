CREATE TABLE "spans" (
	"trace_id" text NOT NULL,
	"span_id" text NOT NULL,
	"parent_span_id" text,
	"run_id" text,
	"suite_id" text,
	"tx_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"role" text,
	"agent_id" text,
	"model_spec" text,
	"tool" text,
	"start_t" bigint NOT NULL,
	"end_t" bigint NOT NULL,
	"duration_ms" double precision NOT NULL,
	"status" text NOT NULL,
	"error_kind" text,
	"cost_usd" double precision,
	"input_tokens" integer,
	"output_tokens" integer,
	"attributes" jsonb NOT NULL,
	CONSTRAINT "spans_trace_id_span_id_pk" PRIMARY KEY("trace_id","span_id")
);
--> statement-breakpoint
ALTER TABLE "spans" ADD CONSTRAINT "spans_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spans_run_start" ON "spans" USING btree ("run_id","start_t");--> statement-breakpoint
CREATE INDEX "spans_run_tx" ON "spans" USING btree ("run_id","tx_id");--> statement-breakpoint
CREATE INDEX "spans_suite" ON "spans" USING btree ("suite_id");