-- The project was renamed from Stardust Cafe to Evals Cafe: stored ids follow.
-- The code still accepts the old ids ("stardust", "builtin:stardust"), so this only keeps what people see consistent.
UPDATE "runs" SET "config" = jsonb_set("config", '{orchestrator}', '"evals-cafe"') WHERE "config"->>'orchestrator' = 'stardust';
--> statement-breakpoint
UPDATE "events" SET "payload" = jsonb_set("payload", '{config,orchestrator}', '"evals-cafe"') WHERE "type" = 'run.started' AND "payload"->'config'->>'orchestrator' = 'stardust';
--> statement-breakpoint
UPDATE "suites" SET "config" = replace(replace("config"::text, '"orchestrator": "stardust"', '"orchestrator": "evals-cafe"'), '"datasetId": "builtin:stardust"', '"datasetId": "builtin:cafe"')::jsonb WHERE "config"::text LIKE '%stardust%';
