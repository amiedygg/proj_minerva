import { defineConfig } from 'vitest/config'

/**
 * Vitest solo corre los tests de lógica pura del renderer (parsers de diff,
 * árbol de archivos, inferencia de lenguaje para syntax highlighting). No
 * necesita DOM (jsdom) porque esos módulos viven en `lib/` sin React.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
