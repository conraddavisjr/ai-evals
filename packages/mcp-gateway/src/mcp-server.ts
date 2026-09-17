import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Gateway } from './gateway.js'
import type { Capability } from './types.js'

/**
 * Expose one capability's tool slice as a real MCP server. External MCP clients
 * (Claude Desktop, an inspector, another agent framework) connect over any SDK
 * transport and see only what that capability allows.
 */
export function createMcpServer(gateway: Gateway, cap: Capability): McpServer {
  const server = new McpServer({ name: `stardust-cafe/${cap.role}`, version: '0.1.0' })
  for (const tool of gateway.toolsFor(cap)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input.shape },
      async (args: unknown) => {
        const res = await gateway.call(cap, tool.name, args)
        if (res.ok)
          return { content: [{ type: 'text' as const, text: JSON.stringify(res.result) }] }
        return { isError: true, content: [{ type: 'text' as const, text: res.error }] }
      },
    )
  }
  return server
}
