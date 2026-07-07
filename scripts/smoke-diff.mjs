/**
 * Smoke e2e de la vista de diff (T7) vía CDP.
 * Flujo: seleccionar PR #201 → tab Archivos → árbol de archivos → diff split →
 * toggle inline → toggle list/tree. Requiere --remote-debugging-port=9222.
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
        ? reject(new Error(r.exceptionDetails.text))
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

const CLICK = `
function clickByText(text) {
  const all = Array.from(document.querySelectorAll('button, [role="button"], a, li, div, span, h1, h2, h3, p'))
  const el = all.find((e) => e.childElementCount === 0 && (e.textContent || '').trim().includes(text))
    || all.find((e) => (e.textContent || '').trim().includes(text) && e.getBoundingClientRect().height < 200)
  if (!el) return 'NOT_FOUND: ' + text
  const clickable = el.closest('button, [role="button"], a, li, [class*="cursor-pointer"]') || el
  clickable.click()
  return 'CLICKED'
}
function clickByTitle(t) {
  const el = document.querySelector('[title*="' + t + '"], [aria-label*="' + t + '"]')
  if (!el) return 'NOT_FOUND_TITLE: ' + t
  el.click()
  return 'CLICKED'
}
`

const checks = []
const check = (name, cond, extra) => {
  checks.push(cond)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? ' — ' + extra : ''}`)
}

// esperar lista
for (let i = 0; i < 20; i++) {
  const t = await evaluate('document.body.innerText')
  if (t.includes('Refactor checkout')) break
  await sleep(500)
}

await evaluate(`${CLICK}; clickByText('Refactor checkout state machine')`)
await sleep(1200)
await evaluate(`${CLICK}; clickByText('Archivos')`)
await sleep(1500)

let text = await evaluate('document.body.innerText')
check('tab Archivos muestra archivos del PR #201', /checkout-validation|checkout-state/.test(text), text.slice(0, 200))

// diff visible: números de línea + contenido con marcas de hunk
check('separadores de hunk @@ visibles', text.includes('@@'))

// contar filas add/del renderizadas (por estilo de fondo)
const counts = await evaluate(`
  (() => {
    const spans = document.querySelectorAll('[class*="diff"], td, [data-kind]')
    const t = document.body.innerText
    return { hasPlusMinus: /\\+\\d+/.test(t) && /-\\d+/.test(t) }
  })()
`)
check('contador +N −M en toolbar', counts.hasPlusMinus)

// toggle a inline
const inl = await evaluate(`${CLICK}; clickByTitle('nline') === 'CLICKED' ? 'CLICKED' : clickByText('Inline')`)
await sleep(600)
check('toggle a vista inline', inl === 'CLICKED', inl)

// toggle word wrap si existe
const ww = await evaluate(`${CLICK}; clickByTitle('rap')`)
check('toggle word wrap', ww === 'CLICKED', ww)

// archivo renombrado en el árbol
text = await evaluate('document.body.innerText')
check('archivo renombrado listado', text.includes('checkout-state'))

// seleccionar el archivo renombrado → mensaje sin preview
await evaluate(`${CLICK}; clickByText('checkout-state.ts')`)
await sleep(600)
text = await evaluate('document.body.innerText')
check('renamed sin patch → mensaje sin vista previa', /[Ss]in vista previa/.test(text))

ws.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
