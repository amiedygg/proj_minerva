import { test, expect, attachScreenshot, closeMinerva, launchMinerva, mainWindow } from './fixtures'
import type { Page } from './fixtures'

/**
 * Acceso a GitHub (F14, v0.5.0; reescrito en F18).
 *
 * F14 probaba el toggle OAuth ⇄ gh-cli. F18 lo retira: `gh` es el único modo
 * con UI y lo que queda por ejercitar es (a) que el default de fábrica sea
 * `gh-cli` sin rastro de OAuth en Settings, (b) el selector de CUENTA, y (c)
 * que el escape hatch por env siga llevando a la rama oauth.
 *
 * Con MINERVA_MOCK=1 los DATOS son mock, pero el probe de `gh` es REAL
 * (gh-cli-auth.ts: resolveCliPath + execFile + GET /user) — por eso los
 * checks de estado aceptan los resultados válidos del probe según la máquina
 * (signed_in / cli_unavailable / cli_unauthenticated): se verifica "rama gh,
 * no rama oauth", no una sesión concreta.
 *
 * El paso de cuenta usa un login que NO existe en ningún `gh` (`--user` con
 * una cuenta desconocida falla siempre), así que es determinista sin importar
 * qué cuentas tenga la máquina que corre la suite.
 */

const GHOST_ACCOUNT = 'minerva-e2e-cuenta-inexistente'

const openSettingsModal = async (page: Page) => {
  await page
    .locator('button:has(svg.lucide-settings), button:has([class*="lucide-settings"])')
    .first()
    .click()
  await expect(page.getByText('Acceso a GitHub').first()).toBeVisible()
}

const card = (page: Page, label: string) => page.locator('button', { hasText: label }).first()

test('modo gh-cli por defecto, sin OAuth en Settings, y selector de cuenta', async ({
  window,
}, testInfo) => {
  // 1. Contrato: settings:get expone el modo vigente y la cuenta elegida.
  const initial = await window.evaluate(() =>
    window.minerva.settings
      .get()
      .then((s: { githubAccessMode: string; githubAccount: string | null }) => ({
        mode: s.githubAccessMode,
        account: s.githubAccount,
      })),
  )
  expect(initial.mode, 'default de fábrica (F18)').toBe('gh-cli')
  expect(initial.account, 'sin cuenta elegida: se sigue la activa de gh').toBeNull()

  // 2. auth:getStatus nace en la rama gh, sin pasar por ningún toggle.
  const auth = await window.evaluate(() => window.minerva.auth.getStatus())
  expect(auth.mode, 'auth:getStatus en rama gh').toBe('gh-cli')
  expect(
    ['signed_in', 'cli_unavailable', 'cli_unauthenticated'],
    'estado gh válido (probe real de esta máquina)',
  ).toContain(auth.state)
  expect('token' in auth, 'AuthStatus NUNCA trae un token').toBe(false)

  // 3. Sección "Acceso a GitHub": guía de gh, feedback de estado y selector,
  //    y NINGUNA card de OAuth.
  await openSettingsModal(window)
  await expect(window.getByText('Modo demo (MINERVA_MOCK)').first()).toBeVisible()
  await expect(window.getByText('cli.github.com').first()).toBeVisible()
  await expect(window.getByText('gh auth login').first()).toBeVisible()
  await expect(
    window.getByText(/vía gh|GitHub CLI no encontrado|Sin sesión de gh/).first(),
    'feedback del probe real',
  ).toBeVisible()
  await expect(
    window.getByText('OAuth de Minerva'),
    'el toggle OAuth ya no existe en Settings',
  ).toHaveCount(0)
  await expect(card(window, 'Cuenta activa de gh'), 'default marcado Activa').toContainText(
    'Activa',
  )
  await attachScreenshot(window, testInfo, 'github-access-gh-cli')

  // 4. Elegir una cuenta concreta: se persiste, y el probe la reporta en
  //    `ghAccount` para que el mensaje de error pueda nombrarla. Se hace por
  //    IPC porque las cuentas reales de la máquina no son predecibles.
  await window.evaluate(
    (login) => window.minerva.settings.setGithubAccount({ login }),
    GHOST_ACCOUNT,
  )
  const withAccount = await window.evaluate(() => window.minerva.auth.getStatus())
  expect(withAccount.mode).toBe('gh-cli')
  expect(withAccount.ghAccount, 'el status dice CUÁL cuenta se pidió').toBe(GHOST_ACCOUNT)
  expect(
    ['cli_unavailable', 'cli_unauthenticated'],
    'una cuenta inexistente nunca puede quedar signed_in',
  ).toContain(withAccount.state)
  expect('token' in withAccount, 'AuthStatus NUNCA trae un token').toBe(false)

  // 5. La UI muestra esa cuenta huérfana en vez de dejar la selección
  //    invisible. Hace falta recargar: el paso 4 escribió por IPC crudo, que
  //    NO refresca el store del renderer (eso lo hace `useSettings`). La
  //    recarga además MODELA el caso real de esta card — elegiste una cuenta,
  //    después la borraste de `gh`, y al volver a abrir Minerva la selección
  //    apunta a algo que ya no existe.
  await window.reload()
  await expect(window.getByText('apply-coupon').first()).toBeVisible({ timeout: 20_000 })
  await openSettingsModal(window)
  await expect(card(window, GHOST_ACCOUNT)).toBeVisible()
  await expect(card(window, GHOST_ACCOUNT)).toContainText('Ya no está en gh')
  await attachScreenshot(window, testInfo, 'github-access-cuenta-huerfana')

  // 6. Volver a "cuenta activa de gh" VÍA UI (no IPC crudo: el refresco
  //    inmediato del AuthStatus en el store lo hace useSettings().setGithubAccount).
  await card(window, 'Cuenta activa de gh').click()
  await expect(card(window, 'Cuenta activa de gh')).toContainText('Activa')
  const cleared = await window.evaluate(() =>
    window.minerva.settings.get().then((s: { githubAccount: string | null }) => s.githubAccount),
  )
  expect(cleared, 'la cuenta elegida se borró').toBeNull()
  await expect
    .poll(
      () =>
        window.evaluate(() =>
          window.minerva.auth
            .getStatus()
            .then((s: { ghAccount?: string }) => s.ghAccount ?? null),
        ),
      { message: 'el status ya no nombra ninguna cuenta' },
    )
    .toBeNull()

  // 7. Cerrar el modal: el TitleBar está en rama gh, no en rama oauth.
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
            oauth: t.includes('Iniciar sesión con GitHub'),
          }
        }),
      { message: 'TitleBar en rama gh (badge/unavailable/esperando), sin rama oauth' },
    )
    .toEqual({ gh: true, oauth: false })
})

// eslint-disable-next-line no-empty-pattern
test('MINERVA_GITHUB_ACCESS=oauth: escape hatch a la rama oauth', async ({}, testInfo) => {
  // App propia: el modo se decide en el arranque de main desde el entorno, así
  // que no se puede cambiar en caliente como hacía el toggle de F14.
  const app = await launchMinerva(testInfo.outputPath('user-data-oauth'), {
    env: { MINERVA_GITHUB_ACCESS: 'oauth' },
  })
  try {
    const window = await mainWindow(app)

    const mode = await window.evaluate(() =>
      window.minerva.settings.get().then((s: { githubAccessMode: string }) => s.githubAccessMode),
    )
    expect(mode, 'la env fuerza el modo').toBe('oauth')

    const auth = await window.evaluate(() => window.minerva.auth.getStatus())
    expect(auth.mode, 'auth:getStatus en rama oauth').toBe('oauth')
    expect(auth.state, 'userData aislado: nunca hubo login').toBe('signed_out')

    await openSettingsModal(window)
    await expect(
      window.getByText('MINERVA_GITHUB_ACCESS=oauth').first(),
      'Settings explica por qué no hay controles de gh',
    ).toBeVisible()
    await expect(
      window.getByText('Cuenta activa de gh'),
      'el selector de cuenta no aplica en modo oauth',
    ).toHaveCount(0)
    await attachScreenshot(window, testInfo, 'github-access-oauth-forzado')

    await window.keyboard.press('Escape')
    await expect(window.getByText('Iniciar sesión con GitHub').first()).toBeVisible()
  } finally {
    await closeMinerva(app)
  }
})
