import { test, expect } from './fixtures'

/**
 * Port de scripts/smoke-comments.mjs (T8): hilos de línea en el diff,
 * navegación chip→archivo, responder hilo e indicadores de gutter.
 */

test('chip path:line navega al diff y el hilo acepta respuesta (#482)', async ({ window }) => {
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()

  // Chip path:line en Conversación.
  const chip = window.locator('[role="link"]', { hasText: /coupon-service\.ts:\d+/ }).first()
  await expect(chip).toBeVisible()

  // Click → navega al diff con el hilo expandido.
  await chip.click()
  await expect(window.getByRole('button', { name: 'Responder' }).first()).toBeVisible()
  await expect(window.getByText('@@').first()).toBeVisible()

  // Responder al hilo expandido.
  await window.locator('textarea').last().fill('Respuesta e2e al hilo de línea')
  await window.getByRole('button', { name: 'Responder' }).first().click()
  await expect(window.getByText('Respuesta e2e al hilo de línea').first()).toBeVisible()
})

test('indicadores de hilo en el gutter del diff (#479)', async ({ window }) => {
  await window.getByText('Add refunds table and migration').first().click()
  await window.getByText('Archivos').first().click()

  const gutterIcons = window.locator('svg.lucide-message-square, [class*="message-square"]')
  await expect(gutterIcons.first()).toBeVisible()
})
