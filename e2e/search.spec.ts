import { test, expect } from './fixtures'

/** Port de scripts/smoke-search.mjs: la búsqueda del TitleBar filtra vía IPC. */

test('la búsqueda filtra la lista de PRs vía IPC', async ({ window }) => {
  await expect(window.getByText('Add dark mode toggle').first()).toBeVisible()

  // Input controlado de React: fill dispara los eventos correctos (la suite
  // legacy tenía que invocar el setter nativo a mano).
  await window.locator('input').first().fill('refunds')

  // Debounce 250ms + IPC + latencia mock: auto-wait de las aserciones.
  await expect(window.getByText('Add refunds table').first()).toBeVisible()
  await expect(window.getByText('Add dark mode toggle')).toHaveCount(0)

  // Limpiar restaura la lista completa.
  await window.locator('input').first().fill('')
  await expect(window.getByText('Add dark mode toggle').first()).toBeVisible()
})
