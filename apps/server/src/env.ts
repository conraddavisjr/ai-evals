import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Load the repo's .env into process.env for the server and the CLI, so
 * `pnpm dev` and `pnpm eval` see CAFE_ALLOW_LIVE_MODELS and the provider keys
 * without the shell having to source the file. Values already in the
 * environment win; a missing .env is fine.
 */
export function loadEnv(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '../../../.env'),
    resolve(process.env.INIT_CWD ?? process.cwd(), '.env'),
    resolve(process.cwd(), '.env'),
  ]
  const file = candidates.find((f) => existsSync(f))
  if (!file) return null
  const before = { ...process.env }
  try {
    process.loadEnvFile(file)
  } catch {
    return null
  }
  // loadEnvFile overwrites; restore anything the shell had set explicitly
  for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v
  return file
}
