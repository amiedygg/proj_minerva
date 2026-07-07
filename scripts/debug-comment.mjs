import WebSocket from 'ws'

const res = await fetch('http://127.0.0.1:9222/json/list')
const page = (await res.json()).find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
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
        x.exceptionDetails ? 'EXC ' + JSON.stringify(x.exceptionDetails).slice(0, 200) : x.result?.value,
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

await ev(`
  (() => {
    const all = Array.from(document.querySelectorAll('div,span,p'))
    const el = all.find((e) => e.childElementCount === 0 && (e.textContent || '').includes('Add refunds table'))
    ;(el.closest('button,li,[class*=cursor-pointer]') || el).click()
  })()
`)
await sleep(1400)

// replicar smoke-e2e: pasar por Archivos y volver a Conversación
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
console.log('tab Archivos:', await ev(`${CBT}; cbt('Archivos')`))
await sleep(1000)
console.log('tab Conversación:', await ev(`${CBT}; cbt('Conversación')`))
await sleep(800)

const info = await ev(`
  (() => {
    const tas = Array.from(document.querySelectorAll('textarea')).map((t) => ({
      ph: t.placeholder,
      disabled: t.disabled,
    }))
    const btns = Array.from(document.querySelectorAll('button'))
      .filter((b) => /comentar|responder|publicar/i.test(b.textContent || ''))
      .map((b) => ({ txt: b.textContent.trim(), disabled: b.disabled }))
    return { tas, btns }
  })()
`)
console.log('estado inicial:', JSON.stringify(info, null, 1))

// set del ÚLTIMO textarea y estado del botón después
const after = await ev(`
  (async () => {
    const tas = Array.from(document.querySelectorAll('textarea'))
    const ta = tas[tas.length - 1]
    const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    s.call(ta, 'Comentario de humo e2e')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    const btns = Array.from(document.querySelectorAll('button'))
      .filter((b) => /comentar|publicar|comment/i.test(b.textContent || ''))
      .map((b) => ({ txt: b.textContent.trim(), disabled: b.disabled }))
    return { taPh: ta.placeholder, btns }
  })()
`)
console.log('tras escribir:', JSON.stringify(after, null, 1))

const click = await ev(`
  (() => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'Comentar' && !b.disabled,
    )
    if (!btn) return 'NO_ENABLED_BTN'
    btn.click()
    return 'CLICKED ' + btn.textContent.trim()
  })()
`)
console.log('click:', click)
await sleep(1800)
const vis = await ev(`document.body.innerText.includes('Comentario de humo e2e')`)
console.log('comentario visible:', vis)
const errs = await ev(`document.body.innerText.match(/No se pudo publicar[^\\n]*/g)`)
console.log('errores UI:', JSON.stringify(errs))

ws.close()
process.exit(0)
