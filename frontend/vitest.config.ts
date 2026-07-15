import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './__tests__/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        '__tests__/',
        '.next/',
        'electron/',
        '*.config.*',
        '**/*.d.ts'
      ],
      include: ['components/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}']
    },
    // Ignore some patterns that might be in the codebase
    exclude: [
      '**/node_modules/**',
      '**/theia/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/e2e/**'
    ]
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './')
    }
  }
})
