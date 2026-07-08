/**
 * Smoke e2e UI de F9 vía CDP. Requiere app con MINERVA_MOCK=1 OPENROUTER_API_KEY=
 * (mock AI) y --remote-debugging-port=9222.
 *
 * Modos (argv[2]):
 *   banner      : Issue 1 — el banner del panel sella la config de generación.
 *                 Analiza #482 con provider=openrouter; luego cambia la config
 *                 vigente a claude-code (persist + reload) y verifica que el
 *                 banner del análisis YA generado sigue mostrando OpenRouter.
 *   stale-check : Issue 2 — con una entrada persistida de #482 con headSha viejo
 *                 (la escribe el orquestador antes de lanzar), al abrir el panel
 *                 aparece la barra "commits nuevos"; "Actualizar" la limpia.
 */
import WebSocket from 'ws'

const MODE = process.argv[2] || 'banner'
const REPO = { owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }
const NUMBER = 482
const repoLit = JSON.stringify(REPO)

const connect = async () => {
  const res = await fetch('http://127.0.0.1:9222/json/list')
  const page = (await res.json()).find(
    (t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('#didactic'),
  )
  if (!page) throw new Error('sin target CDP')
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
  return { ws, evaluate }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const checks = []
const check = (name, cond, extra) => {
  checks.push(cond)
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (!cond && extra ? ' — ' + extra : ''))
}

const CBT = `
function cbt(t) {
  const a = Array.from(document.querySelectorAll('button,[role=button],a,li,div,span,p'))
  const e = a.find((x) => x.childElementCount === 0 && (x.textContent || '').trim().includes(t))
    || a.find((x) => (x.textContent || '').trim().includes(t) && x.getBoundingClientRect().height < 200)
  if (!e) return 'NF: ' + t
  ;(e.closest('button,[role=button],a,li,[class*=cursor-pointer]') || e).click()
  return 'OK'
}
`

const clearSearch = (evaluate) =>
  evaluate(`
  (() => {
    const input = document.querySelector('input')
    if (!input || !input.value) return 'ya limpio'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'limpiado'
  })()
`)

const waitAnalyzeDone = async (evaluate) => {
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const done = await evaluate(`
      (() => {
        const b = Array.from(document.querySelectorAll('button')).find((x) => /Re-?analizar/i.test(x.textContent || ''))
        return Boolean(b) && !b.disabled
      })()
    `)
    if (done === true) return true
  }
  return false
}

const bannerText = (evaluate) =>
  evaluate(`
  (() => {
    const el = Array.from(document.querySelectorAll('span[title]')).find((s) =>
      (s.getAttribute('title') || '').includes('Proveedor y modelo activos'))
    return el ? el.textContent.trim() : 'SIN_BANNER'
  })()
`)

if (MODE === 'banner') {
  let { ws, evaluate } = await connect()

  // 1. provider=openrouter (main persiste) + reload para alinear el store del renderer.
  await evaluate(`window.minerva.settings.setAiProvider({ provider: 'openrouter' })`)
  await evaluate(`window.minerva.ai.invalidateAnalysis({ repo: ${repoLit}, number: ${NUMBER} })`)
  await evaluate('location.reload()')
  ws.close()
  await sleep(2500)
  ;({ ws, evaluate } = await connect())

  await clearSearch(evaluate)
  await sleep(600)
  await evaluate(`${CBT}; cbt('Add POST /carts/:id/apply-coupon')`)
  await sleep(1200)
  const b = await evaluate(`${CBT}; cbt('Analizar PR')`)
  check('análisis #482 lanzado', b === 'OK', String(b))
  const done = await waitAnalyzeDone(evaluate)
  check('análisis #482 terminó', done)

  const banner1 = await bannerText(evaluate)
  check('banner tras generar = OpenRouter · glm-5.2', /OpenRouter/.test(banner1) && /glm-5\.2/.test(banner1), banner1)

  // 2. Cambiar la config VIGENTE a claude-code (persist + reload) y reabrir #482.
  const info = await evaluate(`window.minerva.settings.setAiProvider({ provider: 'claude-code' })`)
  check('config vigente ahora = claude-code', info?.provider === 'claude-code', JSON.stringify(info?.provider))
  await evaluate('location.reload()')
  ws.close()
  await sleep(2500)
  ;({ ws, evaluate } = await connect())

  await clearSearch(evaluate)
  await sleep(600)
  await evaluate(`${CBT}; cbt('Add POST /carts/:id/apply-coupon')`)
  await sleep(1500) // auto-attach del análisis cacheado

  const banner2 = await bannerText(evaluate)
  check(
    'banner SIGUE sellado = OpenRouter · glm-5.2 (no claude-code)',
    /OpenRouter/.test(banner2) && /glm-5\.2/.test(banner2) && !/Claude Code/.test(banner2),
    banner2,
  )
  ws.close()
} else if (MODE === 'stale-check') {
  const { ws, evaluate } = await connect()
  await clearSearch(evaluate)
  await sleep(600)
  await evaluate(`${CBT}; cbt('Add POST /carts/:id/apply-coupon')`)
  await sleep(1800) // auto-attach del análisis persistido (headSha viejo)

  const bodyText = await evaluate('document.body.innerText')
  check(
    'barra de staleness visible',
    /commits nuevos/.test(bodyText),
    bodyText.slice(0, 200),
  )
  const hasUpdate = await evaluate(`
    (() => Array.from(document.querySelectorAll('button')).some((b) => (b.textContent||'').trim() === 'Actualizar'))()
  `)
  check('botón "Actualizar" presente', hasUpdate === true)

  // Pulsar Actualizar → reanaliza (mock) → sella headSha del fixture == current → barra se va.
  await evaluate(`${CBT}; cbt('Actualizar')`)
  await waitAnalyzeDone(evaluate)
  await sleep(1500)
  const bodyText2 = await evaluate('document.body.innerText')
  check('barra desaparece tras Actualizar', !/commits nuevos/.test(bodyText2))
  ws.close()
}

const ok = checks.every(Boolean) && checks.length > 0
console.log(ok ? '\nSMOKE OK' : '\nSMOKE FAIL')
process.exit(ok ? 0 : 1)
