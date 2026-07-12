/**
 * Smoke e2e de settings vía CDP — versión de 3 proveedores post-T59 (T61;
 * reemplaza la versión T46, que asumía `openrouter` como uno de los
 * proveedores del catálogo y verificaba su API key — ambos eliminados en T59:
 * decisión de Edilson, OpenRouter ahora se usa DENTRO de OpenCode
 * (`opencode auth login`), Minerva ya no le habla directo).
 *
 * Verifica: forma de 3 proveedores de `settings:get` (sin `openrouter` como
 * clave de catálogo), que el catálogo de `opencode` trae `opencode/big-pickle`,
 * que `setAiProvider` cambia y persiste el proveedor activo entre los 3,
 * que `setProviderModel` acepta un slug libre para opencode (campo "Otro
 * (avanzado)", `SettingsModal`) y lo refleja en `settings:get`, — SOLO si
 * `opencode` está `authenticated` (`ai:getProviderStatus`) — que un modelo
 * claramente inexistente hace RECHAZAR el análisis con un mensaje accionable
 * no vacío, y la UI REDISEÑADA del modal (F12, T62): strip "En uso", 3 tabs
 * de proveedor (`role="tab"`) donde cambiar de tab NO toca el proveedor
 * activo, y click en una card de modelo que ACTIVA proveedor+modelo juntos.
 *
 * Estado global: la suite NO asume el proveedor/modelo activo — snapshotea la
 * selección al arrancar (proveedor activo + modelo persistido de CADA uno de
 * los 3 proveedores) y la RESTAURA en un `finally` (también si un check
 * revienta a mitad), porque escribe en el settings.json REAL de userData.
 * Único residuo tolerado (documentado, igual que la versión anterior): si el
 * perfil era virgen, al restaurar quedan persistidos el proveedor y modelo
 * por defecto (mismo valor efectivo).
 *
 * Requiere: app corriendo con --remote-debugging-port=9222 y MINERVA_MOCK=1
 * (GitHub mock). El bloque de "modelo inválido" (paso 6 más abajo) necesita
 * el proveedor `opencode` REAL y `authenticated` (NO `MINERVA_MOCK_AI=1`: ese
 * flag fuerza el mock de IA y el análisis con un modelo inexistente
 * igualmente resolvería OK) — si no está autenticado, ese bloque se SKIPPEA
 * con un log claro, mismo patrón de gate que la versión anterior tenía con la
 * key de OpenRouter.
 */
import WebSocket from 'ws'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const res = await fetch('http://127.0.0.1:9222/json/list')
const page = (await res.json()).find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('#didactic'))
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
const evaluate = (expression, timeout = 120000) =>
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

const PROVIDERS = ['claude-code', 'codex', 'opencode']
const CUSTOM_OPENCODE_SLUG = 'openrouter/z-ai/glm-5.2'

const checks = []
const check = (name, cond, extra) => {
  checks.push(cond)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? ' — ' + JSON.stringify(extra).slice(0, 300) : ''}`)
}

for (let i = 0; i < 20; i++) {
  const t = await evaluate('document.body.innerText')
  if (typeof t === 'string' && t.includes('apply-coupon')) break
  await sleep(500)
}

// Snapshot para restaurar en el finally: proveedor activo + modelo persistido
// de CADA uno de los 3 proveedores (los únicos campos que esta suite muta).
const snapshot = await evaluate('window.minerva.settings.get()')
if (!snapshot || typeof snapshot !== 'object' || !snapshot.provider) {
  console.error('settings.get() no devolvió AiSettingsInfo:', JSON.stringify(snapshot).slice(0, 200))
  process.exit(2)
}
const originalProvider = snapshot.provider
const originalModelByProvider = { ...(snapshot.perProviderModel ?? {}) }

try {
  // (a) Forma de 3 proveedores de settings:get: selección efectiva + catálogo
  // de EXACTAMENTE claude-code/codex/opencode, sin `openrouter` como clave.
  const catalogKeys = Object.keys(snapshot.catalog ?? {}).sort()
  check(
    'settings:get devuelve la forma de 3 proveedores (sin openrouter en el catálogo)',
    PROVIDERS.includes(snapshot.provider) &&
      typeof snapshot.model === 'string' &&
      snapshot.model.length > 0 &&
      ['settings', 'env', 'default'].includes(snapshot.modelSource) &&
      catalogKeys.length === 3 &&
      catalogKeys.every((k) => PROVIDERS.includes(k)) &&
      PROVIDERS.every((p) => Array.isArray(snapshot.catalog?.[p]?.models)),
    { provider: snapshot.provider, model: snapshot.model, modelSource: snapshot.modelSource, catalogKeys },
  )

  // (b) Catálogo de opencode incluye el fallback opencode/big-pickle (T57).
  const opencodeIds = (snapshot.catalog?.opencode?.models ?? []).map((m) => m.id)
  check(
    'catálogo de opencode incluye opencode/big-pickle',
    opencodeIds.includes('opencode/big-pickle'),
    opencodeIds,
  )

  // (c) setAiProvider cambia y persiste el proveedor activo entre los 3.
  for (const provider of PROVIDERS) {
    const swapped = await evaluate(`window.minerva.settings.setAiProvider({ provider: ${JSON.stringify(provider)} })`)
    let onDiskProvider
    try {
      onDiskProvider = JSON.parse(
        readFileSync(join(homedir(), '.config', 'proj-minerva', 'settings.json'), 'utf8'),
      ).aiProvider
    } catch (e) {
      onDiskProvider = 'ERR: ' + e.message
    }
    check(
      `setAiProvider('${provider}') cambia la selección efectiva y persiste en disco`,
      swapped?.provider === provider && onDiskProvider === provider,
      { effective: swapped?.provider, onDisk: onDiskProvider },
    )
  }

  // (d) setProviderModel para opencode acepta un slug libre (campo "Otro
  // (avanzado)" — el único proveedor con id libre habilitado tras T59,
  // ver ModelPicker.tsx) y settings:get lo refleja.
  await evaluate(`window.minerva.settings.setAiProvider({ provider: 'opencode' })`)
  const withCustomModel = await evaluate(
    `window.minerva.settings.setProviderModel({ provider: 'opencode', model: ${JSON.stringify(CUSTOM_OPENCODE_SLUG)} })`,
  )
  check(
    'setProviderModel acepta un slug libre para opencode y la selección efectiva lo refleja',
    withCustomModel?.model === CUSTOM_OPENCODE_SLUG &&
      withCustomModel?.modelSource === 'settings' &&
      withCustomModel?.perProviderModel?.opencode === CUSTOM_OPENCODE_SLUG,
    withCustomModel,
  )
  let onDiskModel
  try {
    onDiskModel = JSON.parse(readFileSync(join(homedir(), '.config', 'proj-minerva', 'settings.json'), 'utf8'))
      .models?.opencode
  } catch (e) {
    onDiskModel = 'ERR: ' + e.message
  }
  check(
    'settings.json en userData persiste el slug libre de opencode',
    onDiskModel === CUSTOM_OPENCODE_SLUG,
    onDiskModel,
  )

  // (e) Modelo inválido → el análisis debe RECHAZAR con un error accionable
  // no vacío. Requiere opencode REAL y authenticated: con MINERVA_MOCK_AI=1
  // (o sin sesión) no hay forma de que el proveedor rechace nada, así que se
  // skippea con un log — mismo gate que la versión anterior tenía con la key
  // de OpenRouter.
  const status = await evaluate('window.minerva.ai.getProviderStatus()')
  if (status?.opencode?.status !== 'authenticated') {
    console.log(
      'SKIP  bloque de modelo inválido: opencode no está authenticated (status: ' +
        JSON.stringify(status?.opencode) +
        ') — corré con opencode real logueado y sin MINERVA_MOCK_AI para cubrir este paso.',
    )
  } else {
    const invalidModel = 'opencode/proj-minerva-invalid-model-e2e'
    await evaluate(
      `window.minerva.settings.setProviderModel({ provider: 'opencode', model: ${JSON.stringify(invalidModel)} })`,
    )
    await evaluate(
      `window.minerva.ai.invalidateAnalysis({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:482})`,
    )
    const err = await evaluate(
      `window.minerva.ai.analyzePullRequest({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:482}).then(() => 'INESPERADO_OK').catch((e) => e.message)`,
    )
    check(
      'análisis con modelo opencode inexistente RECHAZA con error no vacío (prueba que usa settings)',
      typeof err === 'string' && err !== 'INESPERADO_OK' && !err.startsWith('EXC:') && err.trim().length > 0,
      err,
    )
    console.log('   error recibido:', String(err).slice(0, 200))
  }

  // UI (F12, T62/T64): el engrane abre el modal REDISEÑADO — strip "En uso",
  // tabs por proveedor (role="tab", ver solo cambia la vista) y activación de
  // proveedor+modelo por click de card (sin radios ni botón Guardar).
  await evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.querySelector('svg.lucide-settings, [class*="lucide-settings"]'),
      )
      if (btn) btn.click()
      return btn ? 'OK' : 'NO_GEAR'
    })()
  `)
  await sleep(800)
  const modalText = await evaluate('document.body.innerText')
  // OJO: el "En uso" del strip se renderiza con `uppercase` de Tailwind y
  // document.body.innerText devuelve el texto YA transformado ("EN USO") —
  // comparar case-insensitive o el check miente (gotcha F12).
  check(
    'modal abre con strip "En uso" y los 3 proveedores (sin OpenRouter)',
    typeof modalText === 'string' &&
      /en uso/i.test(modalText) &&
      modalText.includes('OpenCode') &&
      modalText.includes('Claude Code') &&
      modalText.includes('Codex') &&
      !modalText.includes('OpenRouter'),
    modalText?.slice(0, 200),
  )

  const tabCount = await evaluate(`document.querySelectorAll('[role="tab"]').length`)
  check('hay exactamente 3 tabs de proveedor (role="tab")', tabCount === 3, tabCount)

  // Cambiar de tab es SOLO ver: el proveedor activo no se toca.
  const beforeTab = await evaluate('window.minerva.settings.get()')
  const tabClicked = await evaluate(`
    (() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
        t.textContent.includes('Claude Code'),
      )
      if (tab) tab.click()
      return tab ? 'OK' : 'NO_TAB'
    })()
  `)
  await sleep(400)
  const afterTabView = await evaluate('window.minerva.settings.get()')
  check(
    'click en el tab "Claude Code" solo cambia la vista (proveedor activo intacto)',
    tabClicked === 'OK' && afterTabView?.provider === beforeTab?.provider,
    { tabClicked, before: beforeTab?.provider, after: afterTabView?.provider },
  )

  // Click en una card de modelo del tab visto = ACTIVAR ese proveedor+modelo
  // (setProviderModel + setAiProvider en un gesto — el nuevo contrato T62).
  const targetModel = snapshot.catalog?.['claude-code']?.models?.[0]?.id
  const cardClicked = await evaluate(`
    (() => {
      const panel = document.querySelector('[role="tabpanel"]')
      const btn =
        panel &&
        Array.from(panel.querySelectorAll('button')).find((b) =>
          b.textContent.includes(${JSON.stringify(targetModel ?? '__sin_catalogo__')}),
        )
      if (btn) btn.click()
      return btn ? 'OK' : 'NO_CARD'
    })()
  `)
  let activated = null
  for (let i = 0; i < 12; i++) {
    await sleep(400)
    activated = await evaluate('window.minerva.settings.get()')
    if (activated?.provider === 'claude-code' && activated?.model === targetModel) break
  }
  check(
    'click en la card activa proveedor+modelo (claude-code/' + targetModel + ')',
    cardClicked === 'OK' && activated?.provider === 'claude-code' && activated?.model === targetModel,
    { cardClicked, provider: activated?.provider, model: activated?.model },
  )

  const modalText2 = await evaluate('document.body.innerText')
  check(
    'el strip "En uso" y el badge "Activo" reflejan la activación',
    typeof modalText2 === 'string' && modalText2.includes(targetModel ?? '') && modalText2.includes('Activo'),
    modalText2?.slice(0, 300),
  )
} finally {
  // Restaurar SIEMPRE (también si un evaluate lanzó): cerrar el modal si quedó
  // abierto y volver el modelo de cada proveedor + el proveedor activo a lo
  // que había en el snapshot.
  try {
    await evaluate(
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'esc'",
      10000,
    )
    for (const provider of PROVIDERS) {
      const originalModel = originalModelByProvider[provider]
      if (originalModel) {
        await evaluate(
          `window.minerva.settings.setProviderModel({ provider: ${JSON.stringify(provider)}, model: ${JSON.stringify(originalModel)} })`,
          10000,
        )
      }
    }
    await evaluate(
      `window.minerva.settings.setAiProvider({ provider: ${JSON.stringify(originalProvider)} })`,
      10000,
    )
  } catch (e) {
    console.error('restauración del estado falló:', e.message)
  }
  ws.close()
}

const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
