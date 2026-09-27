/**
 * The small slice of JSONPath packs need: `$`, `.key`, `['key']`, `[0]`, `[*]`
 * and `..key` (any depth). It always returns every match, so assertions can say
 * "every ingredient" or "some step" without a query language to learn.
 */
type Token =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'all' }
  | { kind: 'deep'; key: string }

export function parsePath(path: string): Token[] {
  if (!path.startsWith('$')) throw new Error(`JSONPath must start with $: ${path}`)
  const tokens: Token[] = []
  let i = 1
  const ident = () => {
    const m = /^[\w-]+/.exec(path.slice(i))
    if (!m) throw new Error(`Bad JSONPath at ${i}: ${path}`)
    i += m[0].length
    return m[0]
  }
  while (i < path.length) {
    if (path.startsWith('..', i)) {
      i += 2
      tokens.push({ kind: 'deep', key: ident() })
    } else if (path[i] === '.') {
      i += 1
      if (path[i] === '*') {
        i += 1
        tokens.push({ kind: 'all' })
      } else tokens.push({ kind: 'key', key: ident() })
    } else if (path[i] === '[') {
      const end = path.indexOf(']', i)
      if (end < 0) throw new Error(`Unclosed [ in JSONPath: ${path}`)
      const inner = path.slice(i + 1, end).trim()
      i = end + 1
      if (inner === '*') tokens.push({ kind: 'all' })
      else if (/^-?\d+$/.test(inner)) tokens.push({ kind: 'index', index: Number(inner) })
      else if (/^'.*'$|^".*"$/.test(inner)) tokens.push({ kind: 'key', key: inner.slice(1, -1) })
      else throw new Error(`Unsupported JSONPath selector [${inner}]: ${path}`)
    } else throw new Error(`Bad JSONPath at ${i}: ${path}`)
  }
  return tokens
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function descendants(v: unknown, key: string, out: unknown[]): void {
  if (Array.isArray(v)) for (const x of v) descendants(x, key, out)
  else if (isObj(v)) {
    if (key in v) out.push(v[key])
    for (const x of Object.values(v)) descendants(x, key, out)
  }
}

/** Every value the path selects; an empty array when nothing matches. */
export function query(doc: unknown, path: string): unknown[] {
  let cur: unknown[] = [doc]
  for (const t of parsePath(path)) {
    const next: unknown[] = []
    for (const v of cur) {
      if (t.kind === 'key') {
        if (isObj(v) && t.key in v) next.push(v[t.key])
      } else if (t.kind === 'index') {
        if (Array.isArray(v)) {
          const x = v[t.index < 0 ? v.length + t.index : t.index]
          if (x !== undefined) next.push(x)
        }
      } else if (t.kind === 'all') {
        if (Array.isArray(v)) next.push(...v)
        else if (isObj(v)) next.push(...Object.values(v))
      } else descendants(v, t.key, next)
    }
    cur = next
  }
  return cur
}

/** The first match, or undefined. */
export function first(doc: unknown, path: string): unknown {
  return query(doc, path)[0]
}
