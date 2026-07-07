/**
 * Smoke e2e de streaming (T13) vía CDP: se suscribe a onAnalysisProgress en la
 * página, dispara un análisis y verifica que llegan eventos progresivos antes
 * del resultado final. Funciona en modo mock-IA (sin key) y real (con key).
 * Requiere la app corriendo con --remote-debugging-port=9222.
 */
import WebSocket from 'ws'

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
const evaluate = (expression, timeout = 180000) =>
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
    setTimeout(() => reject(new Error('timeout')), timeout)
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

// Invalidar el cache del PR bajo prueba (regla de las suites: estado global
// limpio al arrancar): si otra suite ya analizó #482 en esta sesión, el
// análisis sería un cache-hit instantáneo SIN eventos y todos los checks de
// streaming fallarían sin que haya bug.
await evaluate(
  `window.minerva.ai.invalidateAnalysis({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:482})`,
)

// Suscribirse, disparar análisis y recolectar eventos con timestamps
const result = await evaluate(`
  (async () => {
    const events = []
    const t0 = Date.now()
    const unsub = window.minerva.events.onAnalysisProgress((ev) => {
      events.push({
        t: Date.now() - t0,
        done: ev.done,
        nSections: ev.sections.length,
        mdLen: ev.sections.reduce((a, s) => a + (s.markdown?.length ?? 0), 0),
        pr: ev.number,
      })
    })
    let final, error
    try {
      final = await window.minerva.ai.analyzePullRequest({
        repo: { owner: 'shopwave', name: 'api', fullName: 'shopwave/api' },
        number: 482,
      })
    } catch (e) {
      error = e.message
    }
    unsub()
    return {
      error: error ?? null,
      finalKinds: final ? final.sections.map((s) => s.kind) : null,
      totalMs: Date.now() - t0,
      firstEventMs: events[0]?.t ?? null,
      nEvents: events.length,
      progressive: events.length >= 2 && events.some((e, i) => i > 0 && e.mdLen > events[i - 1].mdLen),
      lastDone: events.length > 0 ? events[events.length - 1].done : null,
      growth: events.map((e) => e.mdLen).slice(0, 12),
    }
  })()
`)

console.log('resumen:', JSON.stringify(result, null, 1))
check('análisis terminó sin error', result && result.error === null, result?.error)
check('llegaron ≥2 eventos de progreso', result?.nEvents >= 2, `n=${result?.nEvents}`)
check('el contenido crece progresivamente', result?.progressive === true)
check('último evento tiene done:true', result?.lastDone === true)
check(
  'primer evento llega antes que el final (streaming real, no batch)',
  result?.firstEventMs !== null && result.firstEventMs < result.totalMs * 0.8,
  `first=${result?.firstEventMs}ms total=${result?.totalMs}ms`,
)
check(
  'resultado final con secciones válidas',
  Array.isArray(result?.finalKinds) && result.finalKinds.includes('summary'),
  JSON.stringify(result?.finalKinds),
)

ws.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
