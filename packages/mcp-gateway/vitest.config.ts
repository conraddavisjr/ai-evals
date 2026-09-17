import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { name: 'mcp-gateway', include: ['src/**/*.test.ts'], fileParallelism: false },
})
