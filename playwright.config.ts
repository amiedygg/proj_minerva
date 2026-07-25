import { defineConfig } from '@playwright/test'

/**
 * E2E con Playwright + soporte Electron (_electron): cada test lanza la app
 * CONSTRUIDA (out/) con GitHub e IA mock y un userData aislado — ver
 * `e2e/fixtures.ts`. Correr con `npm run test:e2e` (hace el build antes).
 *
 * Convive con las suites smoke legacy de `scripts/smoke-*.mjs` (CDP a mano
 * contra la app dev) mientras dura la migración incremental.
 */
export default defineConfig({
  testDir: './e2e',
  // La IA es mock (~1s) pero el análisis descarga snapshot + renderiza
  // mermaid lazy; margen amplio por test.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Una sola instancia de Electron a la vez: los tests comparten pantalla y
  // los lanzamientos concurrentes de la app se pelean por recursos gráficos.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results',
})
