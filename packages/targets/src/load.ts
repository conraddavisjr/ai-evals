import { globSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { DatasetFile, type EvalCase, PackConfig } from './config.js'
import { interpolateEnv } from './template.js'

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/** A case with the file it came from, so reports can group by dataset. */
export interface LoadedCase extends EvalCase {
  dataset: string
}

export interface LoadedPack {
  file: string
  dir: string
  config: PackConfig
  cases: LoadedCase[]
  /** The contract the target's responses are checked against, when the pack names one. */
  responseSchema: z.ZodType | null
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new ConfigError(`${file}: ${(err as Error).message}`)
  }
}

const issues = (file: string, err: z.ZodError) =>
  new ConfigError(
    `${file}:\n${err.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`,
  )

/**
 * Read a config pack and its datasets. Environment variables are resolved in the
 * target only, so a dataset can mention `${...}` in a prompt without tripping it.
 */
export function loadPack(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
  /** 'keep' reads a pack whose secrets are not set here (the dashboard's case list). */
  missingVars: 'throw' | 'keep' = 'throw',
): LoadedPack {
  const abs = resolve(file)
  const dir = dirname(abs)
  const raw = readJson(abs) as Record<string, unknown>
  const parsed = PackConfig.safeParse(raw)
  if (!parsed.success) throw issues(abs, parsed.error)
  const config = parsed.data
  config.target = interpolateEnv(config.target, env, missingVars)

  const files = [
    ...new Set(
      config.datasets.flatMap((pattern) => {
        const found = pattern.includes('*')
          ? globSync(pattern, { cwd: dir }).map((f) => resolve(dir, f))
          : [resolve(dir, pattern)]
        if (!found.length) throw new ConfigError(`No dataset files match ${pattern}`)
        return found.sort()
      }),
    ),
  ]
  const seen = new Map<string, string>()
  const cases: LoadedCase[] = []
  for (const f of files) {
    const ds = DatasetFile.safeParse(readJson(f))
    if (!ds.success) throw issues(f, ds.error)
    const name = relative(dir, f)
    for (const c of ds.data.cases) {
      const dup = seen.get(c.id)
      if (dup) throw new ConfigError(`Case id ${c.id} appears in both ${dup} and ${name}`)
      seen.set(c.id, name)
      cases.push({ ...c, tags: [...new Set([...ds.data.tags, ...c.tags])], dataset: ds.data.name })
    }
  }

  let responseSchema: z.ZodType | null = null
  if (config.target.responseSchema) {
    const schemaFile = isAbsolute(config.target.responseSchema)
      ? config.target.responseSchema
      : resolve(dir, config.target.responseSchema)
    try {
      responseSchema = z.fromJSONSchema(
        readJson(schemaFile) as Parameters<typeof z.fromJSONSchema>[0],
      )
    } catch (err) {
      throw new ConfigError(`${schemaFile}: not a usable JSON Schema (${(err as Error).message})`)
    }
  }
  return { file: abs, dir, config, cases, responseSchema }
}

export interface CaseFilter {
  ids?: string[] | undefined
  /** Any of these tags. */
  tags?: string[] | undefined
  smoke?: boolean | undefined
}

export function selectCases(cases: LoadedCase[], f: CaseFilter): LoadedCase[] {
  if (f.ids?.length) {
    const unknown = f.ids.filter((id) => !cases.some((c) => c.id === id))
    if (unknown.length) throw new ConfigError(`Unknown case id: ${unknown.join(', ')}`)
  }
  return cases.filter(
    (c) =>
      (!f.ids?.length || f.ids.includes(c.id)) &&
      (!f.tags?.length || c.tags.some((t) => f.tags?.includes(t))) &&
      (!f.smoke || c.smoke),
  )
}
