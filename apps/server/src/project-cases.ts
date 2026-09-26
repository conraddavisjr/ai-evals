import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { CafeStore } from '@cafe/db'
import { DOMAIN_PACKS } from '@cafe/domains'
import type { TargetRunInfo } from '@cafe/protocol'
import { type CasesView, type CaseView, casesView, loadPack } from '@cafe/targets'

const run = promisify(execFile)

/** Where a project's cases were read from, for the page to say so. */
export interface CasesSource {
  kind: 'file' | 'github' | 'builtin'
  /** "conraddavisjr/ai-recipe-builder @ evals-front-door · evals/stardust.config.json" */
  label: string
  ref: string | null
  /** Branches to pick from: main, open pull requests, branches runs came from, with their case counts. */
  refs: Array<{ ref: string; total: number | null; openPr: boolean }>
}

export type ProjectCases = CasesView & { source: CasesSource }

/**
 * A local override, for reading a project's pack straight from a checkout:
 * projects.local.json (or STARDUST_PROJECTS) maps { "palate": { "pack": "../recipe-builder/evals/stardust.config.json" } }.
 */
function localPack(project: string): string | null {
  const file = process.env.STARDUST_PROJECTS ?? resolve(process.cwd(), '../../projects.local.json')
  if (!existsSync(file)) return null
  try {
    const map = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { pack?: string }>
    const pack = map[project]?.pack
    if (!pack) return null
    const abs = isAbsolute(pack) ? pack : resolve(dirname(file), pack)
    return existsSync(abs) ? abs : null
  } catch {
    return null
  }
}

async function gh(path: string): Promise<unknown> {
  const { stdout } = await run('gh', ['api', path], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 20_000,
  })
  return JSON.parse(stdout)
}

/** Head branches of a repo's open pull requests, most recently updated first. */
async function openBranches(repo: string): Promise<string[]> {
  try {
    const prs = (await gh(
      `repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=20`,
    )) as Array<{
      head: { ref: string }
    }>
    return prs.map((p) => p.head.ref)
  } catch {
    return []
  }
}

async function ghFile(repo: string, path: string, ref: string): Promise<string> {
  const res = (await gh(`repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`)) as {
    content?: string
    encoding?: string
  }
  if (!res.content) throw new Error(`${path} is not a file in ${repo}@${ref}`)
  return Buffer.from(res.content, 'base64').toString('utf8')
}

const cache = new Map<string, { at: number; file: string }>()

/**
 * Copy a pack (its config, the dataset files its globs name, its response schema)
 * from GitHub into a temp folder with the same layout, so the one loader reads it.
 * Uses the machine's `gh` login; a hosted dashboard would use a token instead.
 */
async function githubPack(repo: string, packPath: string, ref: string): Promise<string> {
  const key = `${repo}@${ref}:${packPath}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 60_000 && existsSync(hit.file)) return hit.file
  const root = join(
    tmpdir(),
    'stardust-packs',
    `${repo.replace('/', '__')}@${ref.replace(/[^\w.-]/g, '_')}`,
  )
  const put = (rel: string, text: string) => {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text)
  }
  const configText = await ghFile(repo, packPath, ref)
  put(packPath, configText)
  const config = JSON.parse(configText) as {
    datasets?: string[]
    target?: { responseSchema?: string }
  }
  const packDir = dirname(packPath)
  for (const pattern of config.datasets ?? []) {
    const rel = join(packDir, pattern)
    if (!pattern.includes('*')) {
      put(rel, await ghFile(repo, rel, ref))
      continue
    }
    const dir = dirname(rel)
    const re = new RegExp(`^${relative(dir, rel).replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`)
    const list = (await gh(
      `repos/${repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`,
    )) as Array<{
      name: string
      type: string
    }>
    for (const f of list)
      if (f.type === 'file' && re.test(f.name))
        put(join(dir, f.name), await ghFile(repo, join(dir, f.name), ref))
  }
  if (config.target?.responseSchema) {
    const rel = join(packDir, config.target.responseSchema)
    put(rel, await ghFile(repo, rel, ref))
  }
  const file = join(root, packPath)
  cache.set(key, { at: Date.now(), file })
  return file
}

export class ProjectNotFound extends Error {}

/** A project's golden cases, read-only, from a local checkout override or its repo on GitHub. */
export async function projectCases(
  store: CafeStore,
  project: string,
  ref?: string,
): Promise<ProjectCases> {
  if (project === 'simulations') return simulationCases()
  const runs = await store.runs.listForProject(project, 50)
  const target = runs.find((r) => r.config.target)?.config.target as TargetRunInfo | undefined
  if (!target) throw new ProjectNotFound(`No runs for project ${project}`)
  const runRefs = runs.flatMap((r) =>
    r.config.target?.git.branch ? [r.config.target.git.branch] : [],
  )
  const local = ref ? null : localPack(project)
  if (local) {
    const pack = loadPack(local, process.env, 'keep')
    return {
      ...casesView(pack.config, pack.cases),
      source: {
        kind: 'file',
        label: local,
        ref: null,
        refs: [...new Set(['main', ...runRefs])].map((r) => ({
          ref: r,
          total: null,
          openPr: false,
        })),
      },
    }
  }
  const repo = target.git.repo
  if (!repo)
    throw new ProjectNotFound(
      `Project ${project} has no repository on record; add it to projects.local.json`,
    )
  // Open pull requests, newest first: where unmerged case changes live.
  const open = await openBranches(repo)
  const refs = [...new Set(['main', ...open, ...runRefs])]
  let at = ref
  let file: string | null = null
  if (at) file = await githubPack(repo, target.pack, at)
  // main when the pack is merged there, else the newest open PR that has it, else the latest run's branch
  else
    for (const candidate of refs) {
      try {
        file = await githubPack(repo, target.pack, candidate)
        at = candidate
        break
      } catch {}
    }
  if (!file || !at) throw new ProjectNotFound(`No branch of ${repo} has ${target.pack}`)
  // Each branch's case count, so an open PR that adds cases is visible from the default view.
  const counted = await Promise.all(
    refs.map(async (r) => {
      try {
        const f = await githubPack(repo, target.pack, r)
        return {
          ref: r,
          total: loadPack(f, process.env, 'keep').cases.length,
          openPr: open.includes(r),
        }
      } catch {
        return { ref: r, total: null, openPr: open.includes(r) }
      }
    }),
  )
  const pack = loadPack(file, process.env, 'keep')
  return {
    ...casesView(pack.config, pack.cases),
    source: {
      kind: 'github',
      label: `${repo} @ ${at} · ${target.pack}`,
      ref: at,
      // branches without the pack have nothing to show
      refs: counted.filter((r) => r.total !== null),
    },
  }
}

/** The built-in domains' golden datasets, in the same shape. */
function simulationCases(): ProjectCases {
  const cases: CaseView[] = DOMAIN_PACKS.flatMap((p) =>
    p.dataset.scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      dataset: p.dataset.name,
      tags: s.tags,
      smoke: false,
      prompt: s.customer.utterances[0] ?? '',
      input: { persona: s.customer.name },
      expect: {
        outcomes: [s.expected.expectedOutcome ?? (s.expected.shouldRefuse ? 'refused' : 'served')],
        reasons: null,
        checks: [
          ...(s.expected.items.length
            ? [
                `items: ${s.expected.items.map((i) => [i.size, i.name].filter(Boolean).join(' ')).join(', ')}`,
              ]
            : []),
          ...(s.expected.totalCents !== undefined
            ? [`total ${(s.expected.totalCents / 100).toFixed(2)}`]
            : []),
          ...(s.expected.cashierTools.length
            ? [`agent 1 tools: ${s.expected.cashierTools.join(', ')}`]
            : []),
          ...(s.expected.baristaTools.length
            ? [`agent 2 tools: ${s.expected.baristaTools.join(', ')}`]
            : []),
        ],
      },
      judge: [],
      skipJudge: false,
      rubric: s.expected.rubric ?? null,
    })),
  )
  const datasets = DOMAIN_PACKS.map((p) => ({
    name: p.dataset.name,
    count: p.dataset.scenarios.length,
    smoke: 0,
  }))
  return {
    name: 'Simulations',
    target: null,
    judge: null,
    thresholds: { overall: null, byTag: {} },
    datasets,
    cases,
    total: cases.length,
    smoke: 0,
    source: {
      kind: 'builtin',
      label: 'the built-in domain packs (packages/domains)',
      ref: null,
      refs: [],
    },
  }
}
