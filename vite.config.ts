/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/Logi-web/',
  plugins: [svelte()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
