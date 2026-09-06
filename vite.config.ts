import { defineConfig } from 'vitest/config'
import { defaultClientConditions } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The worker explicitly supplies version-matched JSEP assets for the tested
  // JS WebGPU/WASM backend. Do not also bundle ORT's default asset imports.
  resolve: {
    conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
})
