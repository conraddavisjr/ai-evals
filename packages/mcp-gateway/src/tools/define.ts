import type { z } from 'zod'
import type { ToolContext, ToolDef } from '../types.js'

/** Small helper so each tool file reads as data. */
// biome-ignore lint/suspicious/noExplicitAny: generic tool definition helper
export function defineTool<In extends z.ZodObject<any>, Out>(def: {
  name: string
  scope: string
  description: string
  input: In
  handler: (args: z.infer<In>, ctx: ToolContext) => Promise<Out>
}): ToolDef<In, Out> {
  return def
}

/** Errors thrown by tool handlers that represent a legitimate business "no", not a bug. */
export class DomainError extends Error {
  readonly code = 'domain' as const
}
