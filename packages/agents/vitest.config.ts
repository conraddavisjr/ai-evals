import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { name: 'agents', include: ['src/**/*.test.ts'], fileParallelism: false },
})
