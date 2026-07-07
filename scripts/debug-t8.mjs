import WebSocket from 'ws'

const res = await fetch('http://127.0.0.1:9222/json/list')
const page = (await res.json()).find(
  (t) => t.type === 'page' && t.url.includes('localhost:5173'),
)
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
const ev = (expression) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, (x) =>
      resolve(
        x.exceptionDetails
          ? 'EXC: ' + JSON.stringify(x.exceptionDetails).slice(0, 300)
          : x.result?.value,
      ),
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

for (let i = 0; i < 20; i++) {
  const t = await ev('document.body.innerText')
  if (typeof t === 'string' && t.includes('apply-coupon')) break
  await sleep(500)
}

// click en el PR #482: leaf con el texto → ancestro clickeable (como cbt del smoke)
const sel = await ev(`
  (() => {
    const all = Array.from(document.querySelectorAll('button, [role="button"], a, li, div, span, p'))
    const el = all.find((e) => e.childElementCount === 0 && (e.textContent || '').trim().includes('apply-coupon'))
    if (!el) return 'NO_LEAF'
    const clickable = el.closest('button, [role="button"], a, li, [class*="cursor-pointer"]') || el
    clickable.click()
    return 'OK via ' + clickable.tagName
  })()
`)
console.log('select PR:', sel)
await sleep(1500)

const conv = await ev('document.body.innerText')
console.log('--- innerText tras seleccionar #482 (hilos) ---')
const idx = conv.indexOf('Conversación')
console.log(JSON.stringify(conv.slice(idx, idx + 900)))

// click en el chip: es un span[role="link"] DENTRO del botón de colapso
const chipClick = await ev(`
  (() => {
    const chip = Array.from(document.querySelectorAll('[role="link"]')).find((b) =>
      /coupon-service\\.ts:\\d+/.test(b.textContent || ''),
    )
    if (!chip) return 'NO_CHIP'
    chip.click()
    return 'OK'
  })()
`)
console.log('click chip:', chipClick)

for (const wait of [1000, 1500, 2000]) {
  await sleep(wait)
  const st = await ev(`
    (() => {
      const t = document.body.innerText
      return {
        enArchivos: t.includes('archivos') || /Archivos \\(\\d+\\)/.test(t),
        hunks: (t.match(/@@/g) || []).length,
        responder: (t.match(/Responder/g) || []).length,
        textareas: document.querySelectorAll('textarea').length,
        comentarios: t.includes('discountRate'),
      }
    })()
  `)
  console.log(`estado tras +${wait}ms:`, JSON.stringify(st))
}

console.log('--- innerText completo tras chip ---')
const full = await ev('document.body.innerText')
console.log(JSON.stringify(full.slice(0, 1600)))

// responder al hilo expandido si hay textarea
const reply = await ev(`
  (async () => {
    const tas = Array.from(document.querySelectorAll('textarea'))
    if (!tas.length) return 'NO_TA'
    const ta = tas[tas.length - 1]
    const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    s.call(ta, 'Respuesta e2e al hilo de línea')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    const btns = Array.from(document.querySelectorAll('button')).filter((b) =>
      /Responder/.test(b.textContent || ''),
    )
    if (!btns.length) return 'NO_BTN_RESPONDER'
    btns[btns.length - 1].click()
    return 'SENT (btns=' + btns.length + ')'
  })()
`)
console.log('reply:', reply)
await sleep(2000)
const fin = await ev(
  `document.body.innerText.includes('Respuesta e2e al hilo de línea')`,
)
console.log('respuesta visible:', fin)

ws.close()
process.exit(0)
