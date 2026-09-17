import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    name: 'server',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
  },
})
