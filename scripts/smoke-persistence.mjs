/**
 * Smoke e2e de persistencia del análisis + sellado headSha/generatedWith (F9 T40).
 * Requiere la app corriendo con MINERVA_MOCK=1 OPENROUTER_API_KEY= (mock AI) y
 * --remote-debugging-port=9222.
 *
 * Modos (argv[2]):
 *   provider-openrouter : fuerza provider=openrouter (para usar el mock AI)
 *   analyze             : invalida + analiza #482 y verifica cached + headSha + generatedWith
 *   check               : SOLO getAnalysisState(#482) — debe dar cached SIN analizar (post-reinicio)
 *   restore             : restaura provider=claude-code (limpieza)
 */
import WebSocket from 'ws'

const MODE = process.argv[2] || 'analyze'
const REPO = { owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }
const NUMBER = 482

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
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    const i = ++id
    pending.set(i, (r) =>
      r.exceptionDetails
        ? reject(new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)))
        : resolve(r.result?.value),
    )
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
  })

const repoLit = JSON.stringify(REPO)
const checks = []
const check = (name, cond, extra) => {
  checks.push(cond)
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (!cond && extra ? ' — ' + extra : ''))
}

if (MODE === 'provider-openrouter') {
  const info = await evaluate(`window.minerva.settings.setAiProvider({ provider: 'openrouter' })`)
  check('provider=openrouter', info?.provider === 'openrouter', JSON.stringify(info?.provider))
} else if (MODE === 'restore') {
  const info = await evaluate(`window.minerva.settings.setAiProvider({ provider: 'claude-code' })`)
  check('provider=claude-code', info?.provider === 'claude-code', JSON.stringify(info?.provider))
} else if (MODE === 'analyze') {
  await evaluate(`window.minerva.ai.invalidateAnalysis({ repo: ${repoLit}, number: ${NUMBER} })`)
  const analysis = await evaluate(
    `window.minerva.ai.analyzePullRequest({ repo: ${repoLit}, number: ${NUMBER} })`,
  )
  check('análisis devuelto', !!analysis && Array.isArray(analysis.sections), 'sin sections')
  check(
    'headSha sellado = a482f001…',
    typeof analysis?.headSha === 'string' && analysis.headSha.startsWith('a482f001'),
    JSON.stringify(analysis?.headSha),
  )
  check(
    'generatedWith.provider = openrouter',
    analysis?.generatedWith?.provider === 'openrouter',
    JSON.stringify(analysis?.generatedWith),
  )
  check(
    'generatedWith.model presente',
    typeof analysis?.generatedWith?.model === 'string' && analysis.generatedWith.model.length > 0,
    JSON.stringify(analysis?.generatedWith?.model),
  )
  const state = await evaluate(
    `window.minerva.ai.getAnalysisState({ repo: ${repoLit}, number: ${NUMBER} })`,
  )
  check('estado = cached', state?.status === 'cached', JSON.stringify(state?.status))
} else if (MODE === 'check') {
  // Post-reinicio: NO analizamos. La cache debe hidratar de disco.
  const state = await evaluate(
    `window.minerva.ai.getAnalysisState({ repo: ${repoLit}, number: ${NUMBER} })`,
  )
  check('cached tras reinicio (hidratado de disco)', state?.status === 'cached', JSON.stringify(state?.status))
  check(
    'headSha persistido = a482f001…',
    state?.analysis?.headSha?.startsWith('a482f001'),
    JSON.stringify(state?.analysis?.headSha),
  )
  check(
    'generatedWith persistido = openrouter',
    state?.analysis?.generatedWith?.provider === 'openrouter',
    JSON.stringify(state?.analysis?.generatedWith),
  )
}

ws.close()
const ok = checks.every(Boolean) && checks.length > 0
console.log(ok ? '\nSMOKE OK' : '\nSMOKE FAIL')
process.exit(ok ? 0 : 1)
