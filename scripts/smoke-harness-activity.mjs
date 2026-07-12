/**
 * Smoke e2e del mini-log de actividad del harness (F13) vía CDP: se suscribe
 * a onAnalysisProgress, dispara un análisis y verifica que los eventos traen
 * el buffer `activity` (running→done colapsando por id, labels en español),
 * que el terminal NO lo trae, que `ai:getAnalysisState` lo expone a mitad de
 * vuelo (late-attach) y que la UI lo pinta. DETERMINISTA solo con el mock de
 * IA: lanzar la app con MINERVA_MOCK=1 MINERVA_MOCK_AI=1 y
 * --remote-debugging-port=9222.
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

// Estado global limpio (regla de las suites): sin esto, un cache-hit de otra
// suite devolvería el análisis sin un solo evento y todo fallaría sin bug.
await evaluate(
  `window.minerva.ai.invalidateAnalysis({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:482})`,
)

// Suscribirse, disparar el análisis y recolectar los eventos + estado
// in-flight + el innerText de la UI durante la corrida (para verificar que
// el mini-log realmente se PINTA, no solo que viaja por el wire).
const result = await evaluate(`
  (async () => {
    const repo = { owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }
    const events = []
    const unsub = window.minerva.events.onAnalysisProgress((ev) => {
      if (ev.number !== 482) return
      events.push({
        done: ev.done,
        phase: ev.phase ?? null,
        nSections: ev.sections.length,
        activity: ev.activity ?? null,
      })
    })

    // El PR bajo prueba tiene que estar SELECCIONADO para que el panel
    // didáctico lo pinte: la suite dispara el análisis por IPC directo, así
    // que sin el click la UI mostraría el placeholder de otro PR. La fila de
    // la lista es un <button> (ver PrListItem) — se busca el más específico
    // (menor textContent) que mencione el PR.
    const row = [...document.querySelectorAll('button')]
      .filter((el) => el.textContent?.includes('apply-coupon'))
      .sort((a, b) => a.textContent.length - b.textContent.length)[0]
    if (row) row.click()
    await new Promise((r) => setTimeout(r, 150))

    const analysisPromise = window.minerva.ai.analyzePullRequest({ repo, number: 482 })

    // Muestrear a mitad de vuelo: estado in-flight (late-attach) + UI.
    let midState = null
    const uiSamples = []
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 120))
      const state = await window.minerva.ai.getAnalysisState({ repo, number: 482 })
      if (state.status === 'streaming' && (state.activity?.length ?? 0) > 0 && !midState) {
        midState = { status: state.status, activity: state.activity }
      }
      const panel = document.body.innerText
      uiSamples.push({
        hasLabel: /Leyó src\\/api\\/routes\\.ts|Buscó "router"|Listó la estructura|Pensando…/.test(panel),
        hasSection: panel.includes('Resumen'),
      })
    }

    let error = null
    try {
      await analysisPromise
    } catch (e) {
      error = e.message
    }
    unsub()

    // Colapso por identidad: buscar un id que aparezca primero running y
    // después done en eventos DISTINTOS, sin duplicarse dentro de un buffer.
    let collapsed = false
    let duplicated = false
    const runningSeen = new Map()
    for (const ev of events) {
      for (const item of ev.activity ?? []) {
        const ids = (ev.activity ?? []).filter((x) => x.id === item.id)
        if (ids.length > 1) duplicated = true
        if (item.status === 'running') runningSeen.set(item.id, true)
        if (item.status === 'done' && runningSeen.has(item.id)) collapsed = true
      }
    }

    const nonTerminal = events.filter((e) => !e.done)
    const terminal = events[events.length - 1] ?? null
    const allLabels = nonTerminal.flatMap((e) => (e.activity ?? []).map((i) => i.label))

    return {
      error,
      nEvents: events.length,
      withActivity: nonTerminal.filter((e) => (e.activity?.length ?? 0) > 0).length,
      exploringWithActivity: nonTerminal.some(
        (e) => e.phase === 'exploring' && (e.activity?.length ?? 0) > 0,
      ),
      writingWithActivity: nonTerminal.some(
        (e) => e.phase === 'writing' && (e.activity?.length ?? 0) > 0 && e.nSections > 0,
      ),
      collapsed,
      duplicated,
      labelSample: allLabels.slice(0, 8),
      hasSpanishLabel: allLabels.some((l) => /Leyó|Buscó|Listó|Pensando/.test(l)),
      terminalHasActivity: terminal ? terminal.activity !== null : null,
      terminalDone: terminal?.done ?? null,
      midState,
      uiSawLabel: uiSamples.some((s) => s.hasLabel),
      uiSawLabelWithSection: uiSamples.some((s) => s.hasLabel && s.hasSection),
    }
  })()
`)

console.log('resumen:', JSON.stringify(result, null, 1))
check('análisis terminó sin error', result && result.error === null, result?.error)
check('eventos no-terminales traen activity', result?.withActivity >= 1, `n=${result?.withActivity}`)
check(
  'hay activity durante la fase exploring',
  result?.exploringWithActivity === true,
)
check(
  'hay activity durante la fase writing (con secciones ya streameando)',
  result?.writingWithActivity === true,
)
check(
  'colapso por identidad: un id pasa de running a done',
  result?.collapsed === true,
)
check('ningún buffer trae un id duplicado', result?.duplicated === false)
check(
  'labels en español derivados en main',
  result?.hasSpanishLabel === true,
  JSON.stringify(result?.labelSample),
)
check(
  'el evento TERMINAL no trae activity (efímero)',
  result?.terminalDone === true && result?.terminalHasActivity === false,
  `done=${result?.terminalDone} activity=${result?.terminalHasActivity}`,
)
check(
  'ai:getAnalysisState expone activity a mitad de vuelo (late-attach)',
  result?.midState?.status === 'streaming' && (result?.midState?.activity?.length ?? 0) > 0,
  JSON.stringify(result?.midState)?.slice(0, 200),
)
check('la UI pinta un label del mini-log durante el análisis', result?.uiSawLabel === true)
check(
  'la franja de actividad convive con secciones ya pintadas (fase writing)',
  result?.uiSawLabelWithSection === true,
)

ws.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
