/**
 * Smoke e2e de la sección didáctica "Infraestructura cloud" (F15/T78) vía CDP.
 * Requiere la app corriendo con --remote-debugging-port=9222 y, para checks
 * deterministas, MINERVA_MOCK=1 MINERVA_MOCK_AI=1 (fixture: sección cloud en
 * shopwave/checkout-service#77 con DOS diagramas architecture-beta).
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
  // Señal de término: botón "Re-analizar" habilitado (existe solo con
  // resultado). Con IA real puede tardar >15s: hasta 120s de margen.
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
  // margen para el render lazy de mermaid + icon packs (chunk de ~7MB la 1ª vez)
  await sleep(3000)
  return btn
}

// --- limpieza de estado global (regla de CLAUDE.md) ---
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
  if (t && t.includes('payment webhook')) break
  await sleep(500)
}

// invalidar cache de los PRs bajo prueba y partir de un PR neutral
for (const pr of [
  `{repo:{owner:'shopwave',name:'checkout-service',fullName:'shopwave/checkout-service'},number:77}`,
  `{repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:482}`,
]) {
  await evaluate(`window.minerva.ai.invalidateAnalysis(${pr})`)
}
await evaluate(`${CBT}; cbt('Add dark mode toggle')`)
await sleep(1200)

// --- PR #77 (checkout-service): DEBE traer la sección cloud ---
const b1 = await analyze('Fix race condition in payment webhook')
check('#77 análisis lanzado', b1 === 'OK', b1)

// La card entera, no el body: evita falsos PASS por texto de otras secciones.
const cloudCard = await evaluate(`
  (() => {
    const card = Array.from(document.querySelectorAll('section')).find((s) =>
      (s.querySelector('header')?.textContent || '').includes('Infraestructura cloud'),
    )
    if (!card) return { found: false }
    const t = card.innerText
    const svgs = Array.from(card.querySelectorAll('svg')).filter(
      (s) => s.id && s.id.includes('mermaid'),
    )
    return {
      found: true,
      subtitles: t.includes('Sistema completo') && t.includes('Dónde incide este PR'),
      svgCount: svgs.length,
      // contenido real, no solo presencia: cada architecture-beta de la
      // fixture tiene ≥3 servicios ⇒ decenas de nodos DOM dentro del SVG
      svgNodes: svgs.map((s) => s.querySelectorAll('*').length),
      // los SVG deben estar VISIBLES (el gotcha del visor colapsado a 0px)
      svgHeights: svgs.map((s) => Math.round(s.getBoundingClientRect().height)),
      // logos de iconify inlineados: la fixture usa logos:aws-* en ambos
      // diagramas — el body del icono de Lambda/DynamoDB queda en el markup
      hasIconMarkup: svgs.some((s) => s.innerHTML.length > 3000),
      markdown: t.includes('Lambda') && (t.includes('sistema desplegado') || t.includes('Dónde incide')),
    }
  })()
`)
check('#77 card "Infraestructura cloud" presente', cloudCard.found === true)
check('#77 subtítulos big picture + zoom', cloudCard.subtitles === true, JSON.stringify(cloudCard))
// Con IA mock la fixture trae exactamente 2; con IA real pueden ser 1 o 2.
check(
  '#77 dos diagramas architecture-beta renderizados (SVG mermaid)',
  Number(cloudCard.svgCount) === 2,
  `svgCount=${cloudCard.svgCount}`,
)
check(
  '#77 diagramas con contenido y visibles (no colapsados)',
  Array.isArray(cloudCard.svgNodes) &&
    cloudCard.svgNodes.every((n) => Number(n) > 20) &&
    cloudCard.svgHeights.every((h) => Number(h) > 50),
  JSON.stringify({ nodes: cloudCard.svgNodes, heights: cloudCard.svgHeights }),
)
check('#77 iconos inlineados en el SVG (packs locales cargados)', cloudCard.hasIconMarkup === true)
check('#77 markdown didáctico de la sección', cloudCard.markdown === true)

// El zoom marca los servicios tocados con sufijo "PR" en el label (la
// convención " (PR)" con paréntesis es INVÁLIDA en architecture-beta).
const prMark = await evaluate(`
  (() => {
    const card = Array.from(document.querySelectorAll('section')).find((s) =>
      (s.querySelector('header')?.textContent || '').includes('Infraestructura cloud'),
    )
    if (!card) return false
    return /Webhook Handler PR|Handler PR/.test(card.innerText)
  })()
`)
check('#77 zoom con servicios marcados "PR"', prMark === true)

// --- PR #482 (api): caso negativo, NO debe traer sección cloud ---
await analyze('Add POST /carts/:id/apply-coupon')
const negative = await evaluate(`
  (() => {
    const card = Array.from(document.querySelectorAll('section')).find((s) =>
      (s.querySelector('header')?.textContent || '').includes('Infraestructura cloud'),
    )
    return card ? 'PRESENTE' : 'AUSENTE'
  })()
`)
check('#482 sin infra ⇒ sin card cloud (caso negativo)', negative === 'AUSENTE', negative)

ws.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
