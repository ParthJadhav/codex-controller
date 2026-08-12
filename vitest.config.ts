import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/renderer/src/test/setup.ts'],
    // Agent worktrees live under .claude/worktrees/, each a full copy of the
    // repo. Without this the runner collects every worktree's suite alongside
    // this one and reports another branch's failures as ours.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/renderer/src/core/**/*.ts', 'src/shared/**/*.ts']
    }
  },
  resolve: {
    alias: {
      '@renderer': new URL('./src/renderer/src', import.meta.url).pathname,
      '@shared': new URL('./src/shared', import.meta.url).pathname
    }
  }
})
