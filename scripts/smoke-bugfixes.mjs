/**
 * Smoke e2e de los bugfixes de 2026-07-06:
 *  1. Botones Copiar/Expandir de snippets ya no se superponen (ambos cliqueables).
 *  2. Comentarios y descripción del PR se renderizan como Markdown.
 *  3. Visor de recursos muestra el diagrama Mermaid (SVG con tamaño real) y
 *     la CSP permite data: (icono de persona C4) — sin violaciones img-src.
 * Requiere la app corriendo con --remote-debugging-port=9222 (modo mock).
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
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    const i = ++id
    pending.set(i, (r) =>
      r.exceptionDetails
        ? resolve('EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
        : resolve(r.result?.value),
    )
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
    setTimeout(() => reject(new Error('timeout')), 120000)
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

// Estado global limpio (regla de las suites): buscador vacío y cache del PR
// bajo prueba invalidado, para que "Analizar PR" streamee de verdad.
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
await evaluate(
  `window.minerva.ai.invalidateAnalysis({repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:482})`,
)
// Contador de violaciones CSP de imágenes desde YA (captura el render del
// person icon base64 del C4 más adelante).
await evaluate(`
  (() => {
    if (window.__imgCspViolations === undefined) {
      window.__imgCspViolations = []
      document.addEventListener('securitypolicyviolation', (e) => {
        if (e.violatedDirective.startsWith('img-src')) {
          window.__imgCspViolations.push(e.blockedURI.slice(0, 40))
        }
      })
    }
    return 'ok'
  })()
`)
await sleep(500)

for (let i = 0; i < 20; i++) {
  const t = await evaluate('document.body.innerText')
  if (t && t.includes('apply-coupon')) break
  await sleep(500)
}

// Reset del panel didáctico vía PR neutral (regla de las suites, igual que
// smoke-didactic): si #482 ya está seleccionado con un análisis desplegado,
// no hay botón "Analizar PR" y la suite evaluaría el análisis viejo.
await evaluate(`${CBT}; cbt('Add dark mode toggle')`)
await sleep(1200)

// --- Bug 2: markdown en descripción y comentarios ---
await evaluate(`${CBT}; cbt('Add POST /carts/:id/apply-coupon')`)
await sleep(1000)
await evaluate(`${CBT}; cbt('Conversación')`)
await sleep(800)

const mdBody = await evaluate(`
  (() => {
    const article = document.querySelector('article')
    if (!article) return { err: 'sin article' }
    return {
      h2: Array.from(article.querySelectorAll('h2')).map((h) => h.textContent),
      hasPre: Boolean(article.querySelector('pre')),
      rawHashes: (article.innerText.match(/## /g) || []).length,
    }
  })()
`)
check(
  'descripción del PR renderiza Markdown (h2 reales, sin "##" crudos)',
  Array.isArray(mdBody?.h2) && mdBody.h2.length >= 2 && mdBody.rawHashes === 0,
  JSON.stringify(mdBody),
)

const mdComment = await evaluate(`
  (() => {
    const codes = Array.from(document.querySelectorAll('ul code'))
    return codes.some((c) => c.textContent.includes('coupon.discountRate'))
  })()
`)
check('comentario de hilo renderiza inline code como <code>', mdComment === true, String(mdComment))

// --- Bug 1: botones Copiar y Expandir del snippet no se superponen ---
await evaluate(`${CBT}; cbt('Analizar PR')`)
// Con IA real (OPENROUTER_API_KEY presente) el análisis puede tardar >15s.
// Esperar a que TERMINE (botón "Re-analizar" habilitado), no a que aparezca
// el primer snippet: durante el streaming el layout sigue moviéndose y el
// check de clickability (elementFromPoint) da falsos negativos.
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
await sleep(1500)

const buttons = await evaluate(`
  (() => {
    const expand = document.querySelector('button[aria-label="Expandir snippet"]')
    if (!expand) return { err: 'sin botón expandir snippet' }
    expand.scrollIntoView({ block: 'center' })
    const header = expand.closest('div.flex')?.parentElement
    const copy = Array.from((header ?? document).querySelectorAll('button')).find((b) =>
      /Copiar|Copiado/.test(b.textContent),
    )
    if (!copy) return { err: 'sin botón copiar' }
    const a = copy.getBoundingClientRect()
    const b = expand.getBoundingClientRect()
    const overlap = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
    const centerHits = (r, el) => {
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return el.contains(hit) || hit === el
    }
    return { overlap, copyClickable: centerHits(a, copy), expandClickable: centerHits(b, expand) }
  })()
`)
check(
  'snippet: Copiar y Expandir separados y ambos cliqueables',
  buttons && buttons.overlap === false && buttons.copyClickable && buttons.expandClickable,
  JSON.stringify(buttons),
)

// --- Bug 3: visor muestra el diagrama con tamaño real ---
// Con IA real, que el análisis de #482 traiga sección con diagrama depende
// del modelo. Si no trae, se busca un PR que sí (479/201 suelen estar
// cacheados con diagrama por smoke-didactic; si no, se analizan de verdad).
const clickExpandDiagram = () =>
  evaluate(`
    (() => {
      const btn = document.querySelector('button[aria-label="Expandir diagrama"]')
      if (!btn) return 'NO_BTN'
      btn.click()
      return 'OK'
    })()
  `)
const waitAnalysisDone = async () => {
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
  await sleep(2000)
}
let openViewer = await clickExpandDiagram()
if (openViewer === 'NO_BTN') {
  for (const alt of ['Add refunds table and migration', 'Refactor checkout state machine']) {
    console.log(`INFO  análisis sin diagrama; probando visor con: ${alt}`)
    await evaluate(`${CBT}; cbt('${alt}')`)
    await sleep(1200)
    await evaluate(`${CBT}; cbt('Analizar PR')`)
    await waitAnalysisDone()
    openViewer = await clickExpandDiagram()
    if (openViewer === 'OK') break
  }
}
await sleep(1500)
const viewer = await evaluate(`
  (() => {
    const zoomLabel = Array.from(document.querySelectorAll('span')).find((s) =>
      /^\\d+%$/.test(s.textContent.trim()),
    )
    const overlay = document.querySelector('.fixed.inset-0')
    // OJO: no usar querySelector('svg') a secas — pesca los iconos lucide
    // (X de cerrar, 16x16) antes que el diagrama. El de mermaid tiene id.
    const svg = overlay?.querySelector('svg[id*="mermaid"], svg[aria-roledescription]')
    if (!svg) return { err: 'sin svg de mermaid en el visor' }
    // Altura REAL del área de zoom: getBoundingClientRect del svg ignora el
    // clipping — con el diálogo colapsado a 0px de alto este check pasaba
    // mientras el usuario veía un visor vacío (bug T15-bis). El contenedor
    // del zoom (ancestro overflow-hidden) debe tener altura de verdad.
    const zoomArea = svg.closest('[class*="overflow-hidden"]')
    const zoomAreaH = zoomArea ? Math.round(zoomArea.getBoundingClientRect().height) : 0
    const r = svg.getBoundingClientRect()
    const container = overlay.getBoundingClientRect()
    const visible =
      r.width > 100 &&
      r.height > 80 &&
      zoomAreaH > 300 &&
      r.left < container.right &&
      r.right > container.left &&
      r.top < container.bottom &&
      r.bottom > container.top
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      zoomAreaH,
      visible,
      zoom: zoomLabel?.textContent,
    }
  })()
`)
check(
  'visor: SVG del diagrama presente y con tamaño visible (área de zoom con altura real)',
  openViewer === 'OK' && viewer && viewer.visible === true,
  JSON.stringify(viewer) + ' open=' + openViewer,
)
check('visor: auto-ajuste aplicado (indicador de zoom presente)', Boolean(viewer?.zoom), JSON.stringify(viewer))

await evaluate(
  `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
)
await sleep(400)

// --- Bug 3b: CSP no bloquea el icono de persona (data:) ni imágenes https ---
const cspProbe = await evaluate(`
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve('loaded')
    img.onerror = () => resolve('error')
    img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    setTimeout(() => resolve('timeout'), 3000)
  })
`)
check('CSP permite imágenes data: (icono persona C4)', cspProbe === 'loaded', String(cspProbe))

const violations = await evaluate('window.__imgCspViolations')
check(
  'sin violaciones CSP img-src durante toda la sesión de prueba',
  Array.isArray(violations) && violations.length === 0,
  JSON.stringify(violations),
)

const personIcons = await evaluate(`
  Array.from(document.querySelectorAll('svg image')).filter((i) =>
    (i.getAttribute('xlink:href') || i.getAttribute('href') || '').startsWith('data:image'),
  ).length
`)
console.log(`INFO  <image> con data: en diagramas del panel: ${personIcons}`)

ws.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
