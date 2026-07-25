import { test as base, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'

/**
 * Fixture base de e2e: lanza la app construida (`out/main/index.js`; el
 * script `test:e2e` corre `electron-vite build` antes) con:
 *
 * - `MINERVA_MOCK=1` + `MINERVA_MOCK_AI=1`: universo shopwave + IA mock
 *   determinista (mismo contrato que las suites smoke legacy).
 * - `MINERVA_USER_DATA_DIR` apuntando al outputPath del test: settings,
 *   cache de análisis y snapshots parten de CERO en cada test y no pisan el
 *   userData real. Esto reemplaza toda la limpieza manual de estado que las
 *   suites CDP hacían al arrancar (buscador, invalidateAnalysis, PR neutral).
 *
 * `window` es la ventana principal; la didáctica desacoplada se obtiene con
 * `electronApp.waitForEvent('window')` desde el test que la necesite.
 */
export const test = base.extend<{ electronApp: ElectronApplication; window: Page }>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use, testInfo) => {
    const app = await electron.launch({
      args: ['out/main/index.js'],
      env: {
        ...(process.env as Record<string, string>),
        MINERVA_MOCK: '1',
        MINERVA_MOCK_AI: '1',
        MINERVA_USER_DATA_DIR: testInfo.outputPath('user-data'),
      },
    })
    await use(app)
    await app.close()
  },
  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await use(window)
  },
})

export { expect }
export type { ElectronApplication, Page }
