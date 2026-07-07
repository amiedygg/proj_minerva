/**
 * Smoke e2e de settings (T12) vía CDP. Verifica: modal, default GLM 5.2,
 * guardar modelo, persistencia en disco, y que el análisis usa el modelo
 * elegido (guardando un modelo inválido y esperando el error de OpenRouter).
 * Requiere: app corriendo con --remote-debugging-port=9222 y OPENROUTER_API_KEY.
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
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? ' — ' + extra : ''}`)
}

for (let i = 0; i < 20; i++) {
  const t = await evaluate('document.body.innerText')
  if (typeof t === 'string' && t.includes('apply-coupon')) break
  await sleep(500)
}

// 1. settings:get inicial → GLM 5.2. `source` es 'default' SOLO en un perfil
// virgen: esta misma suite persiste 'z-ai/glm-5.2' al final (paso 5), así que
// en corridas repetidas la fuente legítima es 'settings' con el mismo valor.
const initial = await evaluate('window.minerva.settings.get()')
check(
  'modelo inicial es z-ai/glm-5.2 (default o persistido por corrida previa)',
  initial?.aiModel === 'z-ai/glm-5.2' &&
    (initial?.aiModelSource === 'default' || initial?.aiModelSource === 'settings'),
  JSON.stringify(initial),
)

// 2. guardar modelo inválido (vía IPC — mismo camino que la UI)
const bad = await evaluate(
  `window.minerva.settings.setAiModel({ aiModel: 'proj-minerva/invalid-model-e2e' })`,
)
check(
  'setAiModel persiste y devuelve source settings',
  bad?.aiModel === 'proj-minerva/invalid-model-e2e' && bad?.aiModelSource === 'settings',
  JSON.stringify(bad),
)

// 3. persistencia en disco
let onDisk
try {
  const p = join(homedir(), '.config', 'proj-minerva', 'settings.json')
  onDisk = JSON.parse(readFileSync(p, 'utf8'))
} catch (e) {
  onDisk = { error: e.message }
}
check(
  'settings.json en userData contiene el modelo',
  onDisk?.aiModel === 'proj-minerva/invalid-model-e2e',
  JSON.stringify(onDisk),
)

// 4. el análisis usa el modelo de settings → OpenRouter debe rechazarlo.
// Invalidar el cache de #470 primero: un cache-hit devolvería OK sin tocar
// OpenRouter y el check daría INESPERADO_OK sin que haya bug.
await evaluate(
  `window.minerva.ai.invalidateAnalysis({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:470})`,
)
const err = await evaluate(
  `window.minerva.ai.analyzePullRequest({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:470}).then(() => 'INESPERADO_OK').catch((e) => e.message)`,
)
check(
  'análisis con modelo inválido falla (prueba que usa settings)',
  typeof err === 'string' && err !== 'INESPERADO_OK',
  String(err).slice(0, 120),
)
console.log('   error recibido:', String(err).slice(0, 140))

// 5. volver a GLM 5.2 y analizar de verdad
await evaluate(`window.minerva.settings.setAiModel({ aiModel: 'z-ai/glm-5.2' })`)
const ok = await evaluate(
  `window.minerva.ai.analyzePullRequest({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:470}).then((a) => ({kinds: a.sections.map(s=>s.kind)})).catch((e) => 'ERR: ' + e.message)`,
)
check(
  'análisis real con GLM 5.2 funciona',
  ok && typeof ok === 'object' && Array.isArray(ok.kinds) && ok.kinds.length > 0,
  JSON.stringify(ok).slice(0, 150),
)
console.log('   secciones:', JSON.stringify(ok?.kinds ?? ok))

// 6. UI: engrane abre modal con GLM 5.2 seleccionado
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
  'modal de settings abre con la lista curada',
  modalText.includes('GLM 5.2') &&
    modalText.includes('Kimi K2.7') &&
    modalText.includes('GPT-5.5') &&
    modalText.includes('Claude Opus 4.8'),
)

ws.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
