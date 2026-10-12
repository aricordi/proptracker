import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Rules tests share one emulator, so run test files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
  },
})
