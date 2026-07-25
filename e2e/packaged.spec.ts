import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, launchMinerva, closeMinerva, attachScreenshot } from './fixtures'

/**
 * Port de scripts/smoke-packaged.mjs (T24): la app EMPAQUETADA por
 * electron-builder, lanzada desde el binario de `dist/linux-unpacked/`.
 * Que el renderer cargue desde `file://…app.asar…` es en sí la prueba de que
 * corre el build empaquetado (main+preload+fixtures dentro del asar) y no el
 * dev server ni `out/`.
 *
 * El binario NO se construye aquí (electron-builder tarda minutos): el test
 * se auto-skipea si falta. Para cubrirlo: `npm run dist:dir` antes de la
 * suite.
 */

const PACKAGED_BINARY = join(process.cwd(), 'dist', 'linux-unpacked', 'minerva')

// eslint-disable-next-line no-empty-pattern
test('la app empaquetada arranca, expone el preload y sirve los fixtures del asar', async ({}, testInfo) => {
  test.skip(
    !existsSync(PACKAGED_BINARY),
    'no hay binario empaquetado en dist/linux-unpacked/ — correr npm run dist:dir antes',
  )

  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    executable: PACKAGED_BINARY,
    args: [],
  })
  try {
    // Ventana principal a mano (no mainWindow()): antes de esperar contenido
    // se verifica el ORIGEN del renderer, que es el punto de la suite.
    let window = app.context.pages().find((p) => !p.url().includes('#didactic'))
    if (!window) {
      window = await app.context.waitForEvent('page', { timeout: 15_000 })
    }
    await window.waitForLoadState('domcontentloaded')
    expect(window.url(), 'renderer servido desde el asar (no dev server ni out/)').toMatch(
      /^file:\/\/.*app\.asar.*index\.html/,
    )

    // Preload CJS cargado: window.minerva expuesto por contextBridge.
    expect(await window.evaluate(() => typeof window.minerva)).toBe('object')

    // Lista de PRs mock vía IPC (fixtures de main DENTRO del asar) + ping.
    await expect(window.getByText('apply-coupon').first()).toBeVisible({ timeout: 20_000 })
    await expect(window.getByText('Conectado').first()).toBeVisible()

    // Detalle + tab Archivos (diff parseado + Shiki desde el bundle).
    await window.getByText('Add refunds table and migration').first().click()
    await expect(window.getByText('#479').first()).toBeVisible()
    // Nombre de archivo del fixture, no un regex laxo: el título del PR
    // también contiene "refunds" y taparía un diff que no carga.
    await window.getByText('Archivos').first().click()
    await expect(window.getByText('2026070401_create_refunds.sql').first()).toBeVisible()

    await attachScreenshot(window, testInfo, 'packaged-archivos-479')
  } finally {
    await closeMinerva(app)
  }
})
