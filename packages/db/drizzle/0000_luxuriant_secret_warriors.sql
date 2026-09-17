CREATE TABLE "customers" (
	"loyalty_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"favorite_menu_item_id" text
);
--> statement-breakpoint
CREATE TABLE "drinks_made" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"order_id" text NOT NULL,
	"barista_id" text NOT NULL,
	"menu_item_id" text NOT NULL,
	"size" text NOT NULL,
	"modifiers" jsonb NOT NULL,
	"made_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"t" bigint NOT NULL,
	"tx_id" text,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tx_id" text,
	"agent_id" text,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"sku" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"default_qty" double precision NOT NULL,
	"reorder_level" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"run_id" text NOT NULL,
	"sku" text NOT NULL,
	"quantity" double precision NOT NULL,
	CONSTRAINT "inventory_run_id_sku_pk" PRIMARY KEY("run_id","sku")
);
--> statement-breakpoint
CREATE TABLE "judgements" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tx_id" text NOT NULL,
	"order_id" text,
	"judge_spec" text NOT NULL,
	"answers" jsonb NOT NULL,
	"blinded_transcript" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"base_price_cents" integer NOT NULL,
	"size_delta_cents" jsonb NOT NULL,
	"modifiers" jsonb NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tx_id" text,
	"agent_id" text NOT NULL,
	"role" text NOT NULL,
	"model_spec" text NOT NULL,
	"step" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" double precision NOT NULL,
	"latency_ms" integer NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tx_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"status" text NOT NULL,
	"items" jsonb NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"cashier_id" text,
	"barista_id" text,
	"created_at" bigint NOT NULL,
	"queued_at" bigint,
	"claimed_at" bigint,
	"ready_at" bigint,
	"delivered_at" bigint,
	"fail_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"order_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"menu_item_id" text PRIMARY KEY NOT NULL,
	"steps" jsonb NOT NULL,
	"ingredients" jsonb NOT NULL,
	"prep_seconds" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_metrics" (
	"run_id" text PRIMARY KEY NOT NULL,
	"metrics" jsonb NOT NULL,
	"computed_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"config" jsonb NOT NULL,
	"started_at" bigint,
	"finished_at" bigint,
	"error" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drinks_made" ADD CONSTRAINT "drinks_made_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drinks_made" ADD CONSTRAINT "drinks_made_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_sku_ingredients_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."ingredients"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgements" ADD CONSTRAINT "judgements_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_usage" ADD CONSTRAINT "model_usage_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_metrics" ADD CONSTRAINT "run_metrics_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_run_seq" ON "events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "events_run_tx" ON "events" USING btree ("run_id","tx_id");--> statement-breakpoint
CREATE INDEX "model_usage_run" ON "model_usage" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "orders_run_status" ON "orders" USING btree ("run_id","status");