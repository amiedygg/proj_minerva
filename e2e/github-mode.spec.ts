import { test, expect, attachScreenshot } from './fixtures'
import type { Page } from './fixtures'

/**
 * Port de scripts/smoke-github-mode.mjs (F14, v0.5.0): modo de acceso a
 * GitHub. Con MINERVA_MOCK=1 los DATOS son mock, pero el probe de `gh` es
 * REAL (gh-cli-auth.ts: resolveCliPath + execFile + GET /user) — por eso los
 * checks de estado aceptan los tres resultados válidos del probe según la
 * máquina (signed_in / cli_unavailable / cli_unauthenticated): lo que se
 * verifica es "rama gh, no rama oauth", no una sesión concreta.
 *
 * userData aislado ⇒ el modo inicial es el default de fábrica (`oauth`) y no
 * hay ritual de snapshot/restauración de settings.json.
 */

const openSettingsModal = async (page: Page) => {
  await page
    .locator('button:has(svg.lucide-settings), button:has([class*="lucide-settings"])')
    .first()
    .click()
  await expect(page.getByText('Acceso a GitHub').first()).toBeVisible()
}

const card = (page: Page, label: string) =>
  page.locator('button', { hasText: label }).first()

test('toggle oauth ⇄ gh-cli: persistencia, rama gh de auth:getStatus y TitleBar', async ({
  window,
}, testInfo) => {
  // 1. Contrato: settings:get expone githubAccessMode con el default oauth.
  const initialMode = await window.evaluate(() =>
    window.minerva.settings.get().then((s: { githubAccessMode: string }) => s.githubAccessMode),
  )
  expect(initialMode, 'default de fábrica').toBe('oauth')

  // 2. Sección "Acceso a GitHub" del modal: dos cards, guía y nota de demo.
  await openSettingsModal(window)
  await expect(card(window, 'OAuth de Minerva')).toBeVisible()
  await expect(card(window, 'GitHub CLI (gh)')).toBeVisible()
  await expect(card(window, 'OAuth de Minerva'), 'card OAuth marcada Activo').toContainText(
    'Activo',
  )
  await expect(window.getByText('Modo demo (MINERVA_MOCK)').first()).toBeVisible()
  await expect(window.getByText('gh auth login').first()).toBeVisible()

  // 3. Togglear a gh-cli VÍA UI (click en la card).
  await card(window, 'GitHub CLI (gh)').click()
  await expect(card(window, 'GitHub CLI (gh)'), 'card gh marcada Activo').toContainText('Activo')
  const persisted = await window.evaluate(() =>
    window.minerva.settings.get().then((s: { githubAccessMode: string }) => s.githubAccessMode),
  )
  expect(persisted, 'modo gh-cli persistido').toBe('gh-cli')

  // 4. auth:getStatus cambió a la rama gh (estado según el probe REAL).
  const auth = await window.evaluate(() => window.minerva.auth.getStatus())
  expect(auth.mode, 'auth:getStatus en rama gh').toBe('gh-cli')
  expect(
    ['signed_in', 'cli_unavailable', 'cli_unauthenticated'],
    'estado gh válido (probe real de esta máquina)',
  ).toContain(auth.state)
  expect('token' in auth, 'AuthStatus NUNCA trae un token').toBe(false)

  // Feedback del estado dentro de la card (solo con gh como modo activo).
  await expect(
    window.getByText(/vía gh|GitHub CLI no encontrado|Sin sesión de gh/).first(),
  ).toBeVisible()
  await attachScreenshot(window, testInfo, 'github-mode-gh-activo')

  // 5. Cerrar el modal: el TitleBar está en rama gh, no en rama oauth.
  await window.keyboard.press('Escape')
  await expect
    .poll(
      () =>
        window.evaluate(() => {
          const t = document.body.textContent ?? ''
          return {
            gh:
              t.includes('vía GitHub CLI') ||
              t.includes('GitHub CLI no encontrado') ||
              t.includes('Esperando sesión'),
            oauth: t.includes('Cerrar sesión') || t.includes('Iniciar sesión con GitHub'),
          }
        }),
      { message: 'TitleBar en rama gh (badge/unavailable/esperando), sin rama oauth' },
    )
    .toEqual({ gh: true, oauth: false })

  // 6. Volver a oauth VÍA UI (no IPC crudo: el refresco inmediato del
  // AuthStatus en el store lo hace useSettings().setGithubAccessMode).
  await openSettingsModal(window)
  await card(window, 'OAuth de Minerva').click()
  await expect(card(window, 'OAuth de Minerva'), 'card OAuth Activo de vuelta').toContainText(
    'Activo',
  )
  const backMode = await window.evaluate(() =>
    window.minerva.settings.get().then((s: { githubAccessMode: string }) => s.githubAccessMode),
  )
  expect(backMode, 'modo oauth persistido').toBe('oauth')
  await window.keyboard.press('Escape')

  await expect
    .poll(
      () => window.evaluate(() => window.minerva.auth.getStatus().then((s: { mode: string }) => s.mode)),
      { message: 'auth:getStatus volvió a la rama oauth' },
    )
    .toBe('oauth')
  await expect
    .poll(
      () =>
        window.evaluate(() => {
          const t = document.body.textContent ?? ''
          return !t.includes('vía GitHub CLI') && !t.includes('Esperando sesión')
        }),
      { message: 'el TitleBar salió de la rama gh' },
    )
    .toBe(true)
})
