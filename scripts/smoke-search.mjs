/**
 * Smoke corto: la búsqueda del TitleBar filtra vía IPC (search en main).
 * Requiere la app corriendo con --remote-debugging-port=9222.
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
const ws = new WebSocket(page.webSocketDebuggerUrl)
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
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, (r) => resolve(r.result?.value))
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// esperar lista inicial
for (let i = 0; i < 20; i++) {
  const t = await evaluate('document.body.innerText')
  if (t.includes('apply-coupon')) break
  await sleep(500)
}

// escribir en el buscador (input controlado de React)
await evaluate(`
  (() => {
    const input = document.querySelector('input[type="text"], input[type="search"], input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'refunds')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()
`)
await sleep(1200) // debounce 250ms + IPC + latencia mock

const after = await evaluate('document.body.innerText')
const stillHasRefunds = after.includes('Add refunds table')
const filteredOutOthers = !after.includes('Add dark mode toggle')
if (stillHasRefunds && filteredOutOthers) {
  console.log('PASS  búsqueda filtra vía IPC (solo "refunds" visible)')
  process.exit(0)
} else {
  console.error(
    `FAIL  búsqueda: refunds=${stillHasRefunds} otrosFuera=${filteredOutOthers}`,
  )
  process.exit(1)
}
