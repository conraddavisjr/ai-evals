import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { z } from 'zod'
import { DomainError } from './tools/define.js'
import type { ToolDef } from './types.js'

export interface RemoteToolSource {
  tools: ToolDef[]
  close(): Promise<void>
}

/**
 * Turn any MCP server into a tool catalogue for the gateway. Every remote tool
 * becomes a ToolDef whose handler forwards the call over MCP, so scope checks,
 * timing, chaos, events and spans all still happen here, while the work (and the
 * real database behind it) happens on the other side of the wire.
 *
 * `scopeOf` decides which scope a remote tool needs; pair it with
 * GatewayOptions.roleScopes to say which roles hold which of those scopes.
 */
export async function connectRemoteTools(input: {
  /** Any SDK transport (streamable HTTP, stdio, in-memory for tests). */
  transport: Parameters<Client['connect']>[0]
  scopeOf: (toolName: string) => string
  clientName?: string
}): Promise<RemoteToolSource> {
  const client = new Client({ name: input.clientName ?? 'evals-cafe-gateway', version: '0.1.0' })
  await client.connect(input.transport)
  const listed = await client.listTools()
  const tools: ToolDef[] = listed.tools.map((t) => ({
    name: t.name,
    scope: input.scopeOf(t.name),
    description: t.description ?? t.name,
    // the remote schema is what the model sees; locally anything object-shaped passes through
    input: z.object({}).passthrough(),
    inputJsonSchema: t.inputSchema as Record<string, unknown>,
    handler: async (args) => {
      const res = await client.callTool({
        name: t.name,
        arguments: args as Record<string, unknown>,
      })
      const text = contentText(res.content)
      if (res.isError) throw new DomainError(text || `${t.name} failed`)
      if (res.structuredContent !== undefined) return res.structuredContent
      try {
        return JSON.parse(text) as unknown
      } catch {
        return text
      }
    },
  }))
  return { tools, close: () => client.close() }
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((c) =>
      c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '',
    )
    .filter(Boolean)
    .join('\n')
}
