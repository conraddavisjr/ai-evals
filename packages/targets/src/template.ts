/**
 * Environment and body templating for config packs.
 *
 * `${VAR}` / `${VAR:-default}` come from the environment when the config loads,
 * so secrets never sit in the file. `{{input.prompt}}` comes from the case when
 * the request is built; a string that is only a placeholder keeps the value's
 * type (a number stays a number), and a placeholder with no value drops its key.
 */

export class MissingEnvError extends Error {
  constructor(readonly names: string[]) {
    super(`Missing environment variable${names.length === 1 ? '' : 's'}: ${names.join(', ')}`)
    this.name = 'MissingEnvError'
  }
}

const ENV = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g

/** Replace `${VAR}` everywhere in a JSON value; throws once, naming every missing variable. */
export function interpolateEnv<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  const missing = new Set<string>()
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string')
      return v.replace(ENV, (_m, name: string, fallback: string | undefined) => {
        const got = env[name]
        if (got !== undefined && got !== '') return got
        if (fallback !== undefined) return fallback
        missing.add(name)
        return ''
      })
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  const out = walk(value) as T
  if (missing.size) throw new MissingEnvError([...missing])
  return out
}

const WHOLE = /^\{\{\s*([\w.]+)\s*\}\}$/
const PART = /\{\{\s*([\w.]+)\s*\}\}/g

function lookup(ctx: Record<string, unknown>, path: string): unknown {
  let cur: unknown = ctx
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** Build a request body from a template and the case context. */
export function fillTemplate(template: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof template === 'string') {
    const whole = WHOLE.exec(template)
    if (whole?.[1]) return lookup(ctx, whole[1])
    return template.replace(PART, (_m, path: string) => {
      const v = lookup(ctx, path)
      return v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
    })
  }
  if (Array.isArray(template))
    return template.map((t) => fillTemplate(t, ctx)).filter((v) => v !== undefined)
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, t] of Object.entries(template)) {
      const v = fillTemplate(t, ctx)
      if (v !== undefined) out[k] = v
    }
    return out
  }
  return template
}
