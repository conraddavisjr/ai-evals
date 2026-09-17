import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

export type Db = ReturnType<typeof createDb>['db']

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgres://cafe:cafe@localhost:5434/cafe'
}

export function createDb(
  url = databaseUrl(),
  opts: { max?: number; debug?: postgres.Options<Record<string, never>>['debug'] } = {},
) {
  const sql = postgres(url, {
    max: opts.max ?? Number(process.env.DATABASE_POOL_MAX ?? 10),
    onnotice: () => {},
    ...(opts.debug ? { debug: opts.debug } : {}),
  })
  const db = drizzle(sql, { schema })
  return { db, sql, close: () => sql.end() }
}
