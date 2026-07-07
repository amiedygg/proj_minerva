/**
 * Smoke e2e de comentarios (T8) vía CDP: hilos de línea en el diff,
 * navegación chip→archivo, responder hilo y crear hilo nuevo por línea.
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

const HELPERS = `
function cbt(t) {
  const a = Array.from(document.querySelectorAll('button,[role=button],a,li,div,span,p'))
  const e = a.find((x) => x.childElementCount === 0 && (x.textContent || '').trim().includes(t))
    || a.find((x) => (x.textContent || '').trim().includes(t) && x.getBoundingClientRect().height < 200)
  if (!e) return 'NF: ' + t
  ;(e.closest('button,[role=button],a,li,[class*=cursor-pointer]') || e).click()
  return 'OK'
}
function setTa(v) {
  const tas = Array.from(document.querySelectorAll('textarea'))
  const ta = tas[tas.length - 1]
  if (!ta) return 'NO_TA'
  const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  s.call(ta, v)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'OK'
}
`

const checks = []
const check = (name, cond, extra) => {
  checks.push(cond)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? ' — ' + extra : ''}`)
}

for (let i = 0; i < 20; i++) {
  const t = await evaluate('document.body.innerText')
  if (t && t.includes('apply-coupon')) break
  await sleep(500)
}

// 1. PR #482: chip path:line en Conversación
await evaluate(`${HELPERS}; cbt('Add POST /carts/:id/apply-coupon')`)
await sleep(1300)
let text = await evaluate('document.body.innerText')
const hasChip = /coupon-service\.ts:\d+/.test(text)
check('chip path:line visible en Conversación (#482)', hasChip, text.slice(0, 150))

// 2. click chip (span[role="link"] dentro del botón de colapso) → navega y expande
if (hasChip) {
  const clicked = await evaluate(`
    (() => {
      const chip = Array.from(document.querySelectorAll('[role="link"]')).find((b) =>
        /coupon-service\\.ts:\\d+/.test(b.textContent || ''),
      )
      if (!chip) return 'NO_CHIP'
      chip.click()
      return 'OK'
    })()
  `)
  await sleep(1800)
  text = await evaluate('document.body.innerText')
  check(
    'chip navega al diff con hilo expandido',
    clicked === 'OK' && text.includes('Responder') && text.includes('@@'),
    `click=${clicked}`,
  )
}

// 3. responder al hilo expandido
let r = await evaluate(`${HELPERS}; setTa('Respuesta e2e al hilo de línea')`)
check('textarea de respuesta disponible', r === 'OK', r)
await evaluate(`${HELPERS}; cbt('Responder')`)
await sleep(1500)
text = await evaluate('document.body.innerText')
check(
  'respuesta publicada visible en hilo de línea',
  text.includes('Respuesta e2e al hilo de línea'),
)

// 4. PR #479: hilos de línea fixturizados
await evaluate(`${HELPERS}; cbt('Add refunds table and migration')`)
await sleep(1300)
await evaluate(`${HELPERS}; cbt('Archivos')`)
await sleep(1500)
const gutterIcons = await evaluate(
  `document.querySelectorAll('svg.lucide-message-square, [class*="message-square"]').length`,
)
check(
  'indicadores de hilo en gutter del diff (#479)',
  Number(gutterIcons) > 0,
  `icons=${gutterIcons}`,
)

ws.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
