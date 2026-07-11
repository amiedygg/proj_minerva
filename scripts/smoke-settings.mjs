/**
 * Smoke e2e de settings vía CDP — versión multi-proveedor (T46; reemplaza la
 * suite T12, que quedó obsoleta con el refactor T26: validaba el campo legacy
 * `aiModel` que `settings:get` ya no devuelve y ASUMÍA OpenRouter como
 * proveedor activo, así que fallaba por estado persistido, no por bugs).
 *
 * Verifica: forma multi-proveedor de `settings:get`, catálogo curado (incluida
 * la familia GPT-5.6 de T46), cambio de proveedor activo, persistencia de
 * modelo por proveedor en disco, opciones de modelo (effort, T34), que el
 * análisis usa el modelo de settings (modelo inválido → error de OpenRouter;
 * modelo válido → análisis real), y el modal de la UI.
 *
 * Estado global: la suite NO asume el proveedor/modelo activo — snapshotea la
 * selección al arrancar y la RESTAURA en un `finally` (también si un check
 * revienta a mitad), porque escribe en el settings.json REAL de userData.
 * Único residuo tolerado (documentado): si el perfil era virgen, al restaurar
 * quedan persistidos el proveedor y modelo por defecto (mismo valor efectivo).
 *
 * Requiere: app corriendo con --remote-debugging-port=9222, MINERVA_MOCK=1 y
 * key de OpenRouter configurada (se verifica vía ai:getProviderStatus antes de
 * los pasos de análisis, para no confundir "sin key" con "usa el modelo malo").
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

// Snapshot para restaurar en el finally: proveedor activo y modelo persistido
// de OpenRouter (los dos únicos campos que esta suite muta).
const snapshot = await evaluate('window.minerva.settings.get()')
if (!snapshot || typeof snapshot !== 'object' || !snapshot.provider) {
  console.error('settings.get() no devolvió AiSettingsInfo:', JSON.stringify(snapshot).slice(0, 200))
  process.exit(2)
}
const originalProvider = snapshot.provider
const originalOpenRouterModel = snapshot.perProviderModel?.openrouter ?? 'z-ai/glm-5.2'

try {
  // 1. Forma multi-proveedor de settings:get (T26): selección efectiva +
  // catálogo completo de los 3 proveedores. NO se asume cuál está activo.
  check(
    'settings:get devuelve la forma multi-proveedor (provider/model/catalog de 3)',
    ['openrouter', 'claude-code', 'codex'].includes(snapshot.provider) &&
      typeof snapshot.model === 'string' &&
      snapshot.model.length > 0 &&
      ['settings', 'env', 'default'].includes(snapshot.modelSource) &&
      ['openrouter', 'claude-code', 'codex'].every((p) => Array.isArray(snapshot.catalog?.[p]?.models)),
    snapshot,
  )

  // 2. Catálogo curado al día (regresión T46): familia GPT-5.6 en Codex (con
  // el effort nuevo `ultra` en Sol) y en OpenRouter.
  const codexIds = (snapshot.catalog?.codex?.models ?? []).map((m) => m.id)
  const sol = (snapshot.catalog?.codex?.models ?? []).find((m) => m.id === 'gpt-5.6-sol')
  const solEfforts = (sol?.options?.find((o) => o.id === 'effort')?.choices ?? []).map((c) => c.value)
  const openrouterIds = (snapshot.catalog?.openrouter?.models ?? []).map((m) => m.id)
  check(
    'catálogo curado incluye GPT-5.6 (Sol/Terra/Luna en codex con ultra, Sol en openrouter)',
    ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].every((m) => codexIds.includes(m)) &&
      solEfforts.includes('ultra') &&
      openrouterIds.includes('openai/gpt-5.6-sol'),
    { codexIds, solEfforts, openrouterIds },
  )

  // Los pasos de análisis prueban el pipeline de OpenRouter: si no hay key,
  // fallarían por "sin key" y no por el modelo elegido — mejor cortar acá con
  // un mensaje claro que reportar FAILs engañosos.
  const status = await evaluate('window.minerva.ai.getProviderStatus()')
  if (status?.openrouter?.status !== 'authenticated') {
    console.error('OpenRouter sin key configurada (status: ' + JSON.stringify(status?.openrouter) + ') — configúrala y reintenta')
    process.exit(2)
  }

  // 3. Cambiar el proveedor ACTIVO a openrouter (no se asume que ya lo esté).
  const swapped = await evaluate("window.minerva.settings.setAiProvider({ provider: 'openrouter' })")
  check('setAiProvider cambia el proveedor activo a openrouter', swapped?.provider === 'openrouter', swapped)

  // 4. Persistir un modelo inválido para openrouter (vía IPC, mismo camino que
  // la UI) y verificar que la selección efectiva lo refleja.
  const bad = await evaluate(
    "window.minerva.settings.setProviderModel({ provider: 'openrouter', model: 'proj-minerva/invalid-model-e2e' })",
  )
  check(
    'setProviderModel persiste y la selección efectiva lo refleja (source settings)',
    bad?.model === 'proj-minerva/invalid-model-e2e' &&
      bad?.modelSource === 'settings' &&
      bad?.perProviderModel?.openrouter === 'proj-minerva/invalid-model-e2e',
    bad,
  )

  // 5. Persistencia en disco: settings.json de userData con el mapa por proveedor.
  let onDisk
  try {
    onDisk = JSON.parse(readFileSync(join(homedir(), '.config', 'proj-minerva', 'settings.json'), 'utf8'))
  } catch (e) {
    onDisk = { error: e.message }
  }
  check(
    'settings.json en userData persiste proveedor activo y modelo por proveedor',
    onDisk?.aiProvider === 'openrouter' && onDisk?.models?.openrouter === 'proj-minerva/invalid-model-e2e',
    onDisk,
  )

  // 6. Opciones de modelo (T34): con gpt-5.5 activo (tiene descriptor effort),
  // setModelOption persiste y selectedOptions refleja el valor resuelto.
  await evaluate("window.minerva.settings.setProviderModel({ provider: 'openrouter', model: 'openai/gpt-5.5' })")
  const withEffort = await evaluate(
    "window.minerva.settings.setModelOption({ provider: 'openrouter', optionId: 'effort', value: 'high' })",
  )
  check(
    'setModelOption persiste el effort y selectedOptions lo resuelve',
    withEffort?.selectedOptions?.openrouter?.effort === 'high',
    withEffort?.selectedOptions,
  )
  // Volver el effort al default del descriptor para no dejar preferencia nueva.
  await evaluate("window.minerva.settings.setModelOption({ provider: 'openrouter', optionId: 'effort', value: 'medium' })")

  // 7. El análisis usa el modelo de settings → con el inválido OpenRouter debe
  // rechazarlo. Invalidar el cache de #470 primero: un cache-hit devolvería OK
  // sin tocar OpenRouter y el check daría INESPERADO_OK sin que haya bug.
  await evaluate("window.minerva.settings.setProviderModel({ provider: 'openrouter', model: 'proj-minerva/invalid-model-e2e' })")
  await evaluate(
    "window.minerva.ai.invalidateAnalysis({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:470})",
  )
  const err = await evaluate(
    "window.minerva.ai.analyzePullRequest({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:470}).then(() => 'INESPERADO_OK').catch((e) => e.message)",
  )
  check(
    'análisis con modelo inválido falla (prueba que usa settings)',
    typeof err === 'string' && err !== 'INESPERADO_OK' && !err.startsWith('EXC:'),
    err,
  )
  console.log('   error recibido:', String(err).slice(0, 140))

  // 8. Con un modelo válido el análisis real funciona (streaming completo).
  await evaluate("window.minerva.settings.setProviderModel({ provider: 'openrouter', model: 'z-ai/glm-5.2' })")
  const ok = await evaluate(
    "window.minerva.ai.analyzePullRequest({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:470}).then((a) => ({kinds: a.sections.map(s=>s.kind)})).catch((e) => 'ERR: ' + e.message)",
  )
  check(
    'análisis real con GLM 5.2 funciona',
    ok && typeof ok === 'object' && Array.isArray(ok.kinds) && ok.kinds.length > 0,
    ok,
  )
  console.log('   secciones:', JSON.stringify(ok?.kinds ?? ok))

  // 9. UI: el engrane abre el modal y lista el catálogo curado del proveedor
  // activo (openrouter en este punto), incluida la familia GPT-5.6.
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
  check(
    'modal de settings abre con la lista curada (incluye GPT-5.6)',
    typeof modalText === 'string' &&
      modalText.includes('GLM 5.2') &&
      modalText.includes('GPT-5.6 Sol') &&
      modalText.includes('Claude Opus 4.8'),
  )
} finally {
  // Restaurar SIEMPRE (también si un evaluate lanzó): cerrar el modal si quedó
  // abierto y volver al proveedor/modelo openrouter del snapshot. Nada de esto
  // debe tumbar el reporte de checks: es limpieza best-effort.
  try {
    await evaluate(
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'esc'",
      10000,
    )
    await evaluate(
      `window.minerva.settings.setProviderModel({ provider: 'openrouter', model: ${JSON.stringify(originalOpenRouterModel)} })`,
      10000,
    )
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
