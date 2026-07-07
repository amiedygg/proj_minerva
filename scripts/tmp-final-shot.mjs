import WebSocket from 'ws'
import { writeFileSync } from 'node:fs'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('#didactic'))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((r, j) => (ws.on('open', r), ws.on('error', j)))
let id = 0; const pending = new Map()
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
// dejar el panel en 520px para que la captura muestre un ancho distinto al default
await evaluate(`
  (() => {
    const h = document.querySelector('[aria-label="Redimensionar panel didáctico"]')
    return Boolean(h)
  })()
`)
const g = await evaluate(`
  (() => {
    const h = document.querySelector('[aria-label="Redimensionar panel didáctico"]')
    const r = h.getBoundingClientRect()
    return { x: r.left + 3, y: r.top + r.height / 2 }
  })()
`)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x - 140, y: g.y, button: 'left', buttons: 1, pointerType: 'mouse' })
await new Promise((r) => setTimeout(r, 200))
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x - 140, y: g.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
await new Promise((r) => setTimeout(r, 400))
await send('Page.enable')
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('/home/edygg/.claude/jobs/18b28a3d/tmp/t23-panel-resized.png', Buffer.from(shot.result.data, 'base64'))
console.log('ancho final:', await evaluate(`document.querySelector('[aria-label="Redimensionar panel didáctico"]').closest('aside').getBoundingClientRect().width`))
ws.close()
