/**
 * Smoke e2e del modo de acceso a GitHub (F14, v0.5.0) vía CDP.
 *
 * Verifica: que `settings:get` expone `githubAccessMode`; la sección
 * "Acceso a GitHub" del modal de Settings (dos cards, guía de gh, nota de
 * modo demo con MINERVA_MOCK); que togglear a `gh-cli` persiste el modo
 * (segundo `settings:get`), cambia `auth:getStatus` a la rama gh
 * (`mode: 'gh-cli'`) y el TitleBar deja de ofrecer el flujo OAuth (en esta
 * máquina `gh` suele estar autenticado ⇒ badge "vía GitHub CLI" sin
 * "Cerrar sesión"; si no hay gh/sesión, se acepta el copy de `cli_*` — el
 * check es "rama gh, no rama oauth"); y que volver a `oauth` restaura el
 * flujo original.
 *
 * Estado global: la suite escribe en el settings.json REAL de userData —
 * snapshotea `githubAccessMode` al arrancar y lo RESTAURA en un `finally`
 * (también si un check revienta a mitad). Con MINERVA_MOCK=1 los DATOS son
 * mock, pero el probe de `gh` es real: este smoke ejercita de verdad
 * `gh-cli-auth.ts` (resolveCliPath + execFile + GET /user).
 *
 * Requiere: app corriendo con --remote-debugging-port=9222 y MINERVA_MOCK=1
 * (+ MINERVA_MOCK_AI=1 para determinismo, aunque esta suite no analiza nada).
 */
import WebSocket from 'ws'

const res = await fetch('http://127.0.0.1:9222/json/list')
const page = (await res.json()).find(
  (t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('#didactic'),
)
if (!page) {
  console.error('sin target CDP')
  process.exit(2)
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
await new Promise((r, j) => (ws.on('open', r), ws.on('error', j)))
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result)
    pending.delete(m.id)
  }
})
const evaluate = (expression, timeout = 30000) =>
  new Promise((resolve, reject) => {
    const i = ++id
    pending.set(i, (r) =>
      resolve(
        r.exceptionDetails
          ? 'EXC: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? '').slice(0, 300)
          : r.result?.value,
      ),
    )
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
    setTimeout(() => reject(new Error('timeout: ' + expression.slice(0, 60))), timeout)
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'OK ' : 'FAIL'} ${name}${ok ? '' : ' -> ' + JSON.stringify(detail ?? '')}`)
  if (!ok) failures++
}

/** Espera hasta que `expr` (evaluada en la página) sea truthy, con timeout. */
async function waitFor(expr, ms = 15000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const v = await evaluate(expr)
    if (v) return v
    await sleep(300)
  }
  return null
}

const getMode = () => evaluate(`window.minerva.settings.get().then((s) => s.githubAccessMode)`)
const setMode = (mode) =>
  evaluate(
    `window.minerva.settings.setGithubAccessMode({ mode: '${mode}' }).then((s) => s.githubAccessMode)`,
  )
const getAuth = () => evaluate(`window.minerva.auth.getStatus()`)

// Estado global limpio (regla CLAUDE.md): otra suite (o una corrida anterior
// de ESTA, que restaura por IPC crudo sin pasar por el hook useSettings)
// puede haber dejado el store zustand desincronizado del settings.json real.
// El reload resetea el store; después se espera a que la UI re-monte.
await evaluate(`location.reload()`).catch(() => {})
await waitFor(`document.querySelector('button') !== null`, 20000)
await sleep(1000)

const initialMode = await getMode()
console.log(`modo inicial persistido: ${JSON.stringify(initialMode)}`)

try {
  // ── 1. contrato: settings:get expone githubAccessMode ────────────────────
  check(
    'settings:get trae githubAccessMode válido',
    initialMode === 'oauth' || initialMode === 'gh-cli',
    initialMode,
  )

  // Estado limpio: la suite razona desde `oauth` (el default de fábrica).
  if (initialMode !== 'oauth') await setMode('oauth')

  // ── 2. abrir el modal de Settings (engrane) y ver la sección nueva ───────
  await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.querySelector('svg.lucide-settings, [class*="lucide-settings"]'),
    )
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  const sectionVisible = await waitFor(`(() => {
    const h = Array.from(document.querySelectorAll('h3')).find((n) =>
      n.textContent.includes('Acceso a GitHub'),
    )
    return Boolean(h)
  })()`)
  check('sección "Acceso a GitHub" visible en el modal', Boolean(sectionVisible))

  const cards = await evaluate(`(() => {
    const labels = ['OAuth de Minerva', 'GitHub CLI (gh)']
    return labels.map((l) =>
      Boolean(Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes(l))),
    )
  })()`)
  check('card "OAuth de Minerva" presente', cards?.[0] === true, cards)
  check('card "GitHub CLI (gh)" presente', cards?.[1] === true, cards)

  const oauthActive = await evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      x.textContent.includes('OAuth de Minerva'),
    )
    return Boolean(b && b.textContent.includes('Activo'))
  })()`)
  check('con modo oauth, la card OAuth está marcada "Activo"', oauthActive === true, oauthActive)

  const demoNote = await evaluate(`document.body.textContent.includes('Modo demo (MINERVA_MOCK)')`)
  check('nota de modo demo visible (MINERVA_MOCK=1)', demoNote === true, demoNote)

  const guide = await evaluate(`document.body.textContent.includes('gh auth login')`)
  check('la guía menciona gh auth login', guide === true, guide)

  // ── 3. togglear a gh-cli VÍA UI (click en la card) ────────────────────────
  await evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      x.textContent.includes('GitHub CLI (gh)'),
    )
    if (b) b.click()
    return Boolean(b)
  })()`)
  const ghActive = await waitFor(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      x.textContent.includes('GitHub CLI (gh)'),
    )
    return Boolean(b && b.textContent.includes('Activo'))
  })()`)
  check('click en la card gh-cli la marca "Activo"', Boolean(ghActive))

  const persisted = await getMode()
  check('el modo gh-cli quedó persistido (settings:get)', persisted === 'gh-cli', persisted)

  // ── 4. auth:getStatus cambió a la rama gh ────────────────────────────────
  const auth = await getAuth()
  check('auth:getStatus reporta mode gh-cli', auth?.mode === 'gh-cli', auth)
  check(
    'estado gh es uno de los tres válidos',
    ['signed_in', 'cli_unavailable', 'cli_unauthenticated'].includes(auth?.state),
    auth,
  )
  check('AuthStatus NUNCA trae un token', auth && !('token' in auth), Object.keys(auth ?? {}))
  console.log(`   (estado real del probe de gh en esta máquina: ${auth?.state})`)

  // Feedback del estado dentro de la card (solo cuando gh es el modo activo).
  const feedback = await waitFor(`(() => {
    const t = document.body.textContent
    return (
      t.includes('vía gh') ||
      t.includes('GitHub CLI no encontrado') ||
      t.includes('Sin sesión de gh')
    )
  })()`)
  check('la card gh muestra feedback del estado del probe', Boolean(feedback))

  // ── 5. cerrar el modal y verificar la rama gh del TitleBar ───────────────
  await evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await sleep(400)
  const titleBar = await evaluate(`(() => {
    const t = document.body.textContent
    return {
      ghBadge: t.includes('vía GitHub CLI'),
      ghUnavailable: t.includes('GitHub CLI no encontrado'),
      ghWaiting: t.includes('Esperando sesión'),
      oauthSignOut: t.includes('Cerrar sesión'),
      oauthSignIn: t.includes('Iniciar sesión con GitHub'),
    }
  })()`)
  check(
    'TitleBar está en rama gh (badge/unavailable/esperando), no en rama oauth',
    titleBar &&
      (titleBar.ghBadge || titleBar.ghUnavailable || titleBar.ghWaiting) &&
      !titleBar.oauthSignOut &&
      !titleBar.oauthSignIn,
    titleBar,
  )

  // ── 6. volver a oauth VÍA UI y verificar que el flujo original regresa ───
  // Vía UI (no IPC crudo): el refresco inmediato del AuthStatus en el store
  // lo hace `useSettings().setGithubAccessMode` — un `setGithubAccessMode`
  // por IPC directo persiste bien, pero el TitleBar no se entera hasta el
  // próximo fetch (el polling está apagado a propósito con gh `signed_in`).
  await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.querySelector('svg.lucide-settings, [class*="lucide-settings"]'),
    )
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await waitFor(`(() => {
    const h = Array.from(document.querySelectorAll('h3')).find((n) =>
      n.textContent.includes('Acceso a GitHub'),
    )
    return Boolean(h)
  })()`)
  await evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      x.textContent.includes('OAuth de Minerva'),
    )
    if (b) b.click()
    return Boolean(b)
  })()`)
  const backActive = await waitFor(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      x.textContent.includes('OAuth de Minerva'),
    )
    return Boolean(b && b.textContent.includes('Activo'))
  })()`)
  check('click en la card OAuth la marca "Activo" de vuelta', Boolean(backActive))
  const back = await getMode()
  check('el modo oauth quedó persistido (settings:get)', back === 'oauth', back)
  await evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await sleep(400)
  const authBack = await waitFor(
    `window.minerva.auth.getStatus().then((s) => s.mode === 'oauth')`,
  )
  check('auth:getStatus volvió a la rama oauth', Boolean(authBack))
  const oauthUiBack = await waitFor(`(() => {
    const t = document.body.textContent
    return !t.includes('vía GitHub CLI') && !t.includes('Esperando sesión')
  })()`)
  check('el TitleBar salió de la rama gh al volver a oauth', Boolean(oauthUiBack))
} finally {
  // Restaurar SIEMPRE el modo persistido original (la suite escribe en el
  // settings.json real de userData).
  const restored = await setMode(initialMode).catch(() => null)
  console.log(`modo restaurado a: ${JSON.stringify(restored)}`)
  ws.close()
}

console.log(failures === 0 ? 'SMOKE GITHUB-MODE: OK' : `SMOKE GITHUB-MODE: ${failures} FALLAS`)
process.exit(failures === 0 ? 0 : 1)
