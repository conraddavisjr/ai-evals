import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DatasetFile, PackConfig } from '../config.js'

/**
 * Publish the config pack and dataset formats as JSON Schema, so a consumer's
 * editor validates `stardust.config.json` and dataset files as they are typed.
 * Run after changing src/config.ts: `pnpm --filter @cafe/targets schemas`.
 */
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/contracts')
mkdirSync(out, { recursive: true })
const write = (name: string, schema: z.ZodType, title: string) => {
  const json = { title, ...z.toJSONSchema(schema, { io: 'input' }) }
  writeFileSync(resolve(out, name), `${JSON.stringify(json, null, 2)}\n`)
  console.log(`wrote docs/contracts/${name}`)
}
write('stardust-config.v1.schema.json', PackConfig, 'Stardust config pack, contract 1')
write('stardust-dataset.v1.schema.json', DatasetFile, 'Stardust golden dataset')
