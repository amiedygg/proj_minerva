/**
 * Smoke e2e del panel didáctico (T9-mock/T10) vía CDP.
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
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    const i = ++id
    pending.set(i, (r) =>
      r.exceptionDetails
        ? reject(new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)))
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

const checks = []
const check = (name, cond, extra) => {
  checks.push(cond)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? ' — ' + extra : ''}`)
}

const analyze = async (prText) => {
  await evaluate(`${CBT}; cbt('${prText}')`)
  await sleep(1000)
  const btn = await evaluate(`${CBT}; cbt('Analizar PR')`)
  // esperar análisis: mock ~1s, pero con OPENROUTER_API_KEY presente la IA es
  // REAL y puede tardar bastante más de 15s — dar hasta 60s. Señal de
  // término: botón "Re-analizar" habilitado (existe solo con resultado y se
  // deshabilita mientras carga). OJO: NO esperar por el texto 'Resumen' — el
  // placeholder ya dice "Resumen didáctico del cambio" y cortaba al instante.
  for (let i = 0; i < 120; i++) {
    await sleep(1000)
    const done = await evaluate(`
      (() => {
        const b = Array.from(document.querySelectorAll('button')).find((x) =>
          /Re-?analizar/i.test(x.textContent || ''),
        )
        return Boolean(b) && !b.disabled
      })()
    `)
    if (done === true) break
  }
  // margen para el render lazy de mermaid tras llegar el texto
  await sleep(2000)
  return btn
}

// Limpiar el buscador: si otra suite (smoke-search) dejó un filtro activo,
// los PRs que esta suite selecciona no estarían en la lista y los clicks
// fallarían en silencio (aprendido a la mala: era la causa del 6/9 flaky).
await evaluate(`
  (() => {
    const input = document.querySelector('input')
    if (!input || !input.value) return 'ya limpio'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'limpiado'
  })()
`)
await sleep(800)

for (let i = 0; i < 20; i++) {
  const t = await evaluate('document.body.innerText')
  if (t && t.includes('apply-coupon')) break
  await sleep(500)
}

// Resetear el panel didáctico: si otra suite dejó un PR bajo prueba con su
// análisis desplegado, el botón "Analizar PR" no existe para ese PR (el área
// se resetea por remount al CAMBIAR de PR). Seleccionar un PR neutral
// garantiza que cada `analyze(...)` de abajo parta del placeholder.
// T22 endureció este requisito: el panel ahora AUTO-ADJUNTA el análisis
// cacheado al montar (esa es la feature), así que "partir del placeholder"
// exige además invalidar el cache de main de TODOS los PRs que esta suite
// toca (antes bastaba el remount, porque el estado era local al renderer) —
// sin esto, correr smoke-detach antes dejaba #482 cacheado y el botón
// "Analizar PR" nunca aparecía.
for (const pr of [
  `{repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:482}`,
  `{repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:479}`,
  `{repo:{owner:'shopwave',name:'web',fullName:'shopwave/web'},number:201}`,
  `{repo:{owner:'shopwave',name:'web',fullName:'shopwave/web'},number:190}`,
]) {
  await evaluate(`window.minerva.ai.invalidateAnalysis(${pr})`)
}
await evaluate(`${CBT}; cbt('Add dark mode toggle')`)
await sleep(1200)

// --- PR #482: summary + endpoint + arquitectura C4 ---
const b1 = await analyze('Add POST /carts/:id/apply-coupon')
let text = await evaluate('document.body.innerText')
check('#482 análisis lanzado', b1 === 'OK', b1)
check('#482 sección Resumen', text.includes('Resumen'))
check('#482 sección Endpoint con snippet', /curl/.test(text) && /Copiar/.test(text))
let svgs = await evaluate(`document.querySelectorAll('[class*="didactic"] svg[id*="mermaid"], svg[aria-roledescription]').length`)
check('#482 diagrama Mermaid C4 renderizado como SVG', Number(svgs) > 0, `svgs=${svgs}`)
// T20: card "Cómo levantar la app" con tabla de env vars nuevas y snippets
// copiables (bash + env). Se inspecciona la CARD concreta, no el body entero,
// para no dar falso PASS por texto de otra sección.
const setupCard = await evaluate(`
  (() => {
    const card = Array.from(document.querySelectorAll('section')).find((s) =>
      (s.querySelector('header')?.textContent || '').includes('Cómo levantar la app'),
    )
    if (!card) return { found: false }
    const t = card.innerText
    return {
      found: true,
      envVarFixture: t.includes('COUPON_MAX_DISCOUNT_RATE'),
      envVarTopic: /variables? de entorno/i.test(t),
      snippets: card.querySelectorAll('pre').length,
      copiar: t.includes('Copiar'),
    }
  })()
`)
check('#482 card "Cómo levantar la app" presente', setupCard.found === true)
// Estricto contra la fixture (IA mock); con IA real el texto varía por
// corrida, así que degrada a verificar el contrato: la sección setup SIEMPRE
// habla de variables de entorno (las nuevas o "no agrega ninguna").
check(
  '#482 setup: env vars documentadas',
  setupCard.envVarFixture === true || setupCard.envVarTopic === true,
  JSON.stringify(setupCard),
)
check(
  '#482 setup: snippet(s) copiable(s)',
  Number(setupCard.snippets) >= 1 && setupCard.copiar === true,
  JSON.stringify(setupCard),
)

// --- PR #479: schema + erDiagram ---
await analyze('Add refunds table and migration')
text = await evaluate('document.body.innerText')
check('#479 sección Esquema', text.includes('Esquema') || text.includes('refunds'))
svgs = await evaluate(`document.querySelectorAll('svg[aria-roledescription="er"], svg[id*="mermaid"]').length`)
check('#479 diagrama ER renderizado como SVG', Number(svgs) > 0, `svgs=${svgs}`)
// T20: caso contrario — el PR de migración declara explícitamente que NO
// agrega variables de entorno (la sección setup nunca debe omitir ese dato).
const setupNoEnv = await evaluate(`
  (() => {
    const card = Array.from(document.querySelectorAll('section')).find((s) =>
      (s.querySelector('header')?.textContent || '').includes('Cómo levantar la app'),
    )
    if (!card) return { found: false }
    const t = card.innerText
    return {
      found: true,
      noEnvFixture: t.includes('no agrega ni cambia variables de entorno'),
      envVarTopic: /variables? de entorno/i.test(t),
    }
  })()
`)
// Mismo criterio estricto-mock / laxo-real que el check de setup del #482.
check(
  '#479 setup: declara qué pasa con las env vars (aunque no haya nuevas)',
  setupNoEnv.found === true && (setupNoEnv.noEnvFixture === true || setupNoEnv.envVarTopic === true),
  JSON.stringify(setupNoEnv),
)

// --- PR #201: arquitectura C4Component ---
await analyze('Refactor checkout state machine')
text = await evaluate('document.body.innerText')
check('#201 sección Arquitectura', text.includes('Arquitectura'))
svgs = await evaluate(`document.querySelectorAll('svg[aria-roledescription], svg[id*="mermaid"]').length`)
check('#201 diagrama renderizado como SVG', Number(svgs) > 0, `svgs=${svgs}`)

// --- cambiar de PR resetea el panel ---
await evaluate(`${CBT}; cbt('Add dark mode toggle')`)
await sleep(1200)
text = await evaluate('document.body.innerText')
check('cambiar de PR resetea a placeholder con botón', text.includes('Analizar PR'))

ws.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
