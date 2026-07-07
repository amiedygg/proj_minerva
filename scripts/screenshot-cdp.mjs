// T16: captura del contenido renderizado de la ventana principal vía CDP
// (Page.captureScreenshot) — independiente del workspace visible de Hyprland.
import { writeFileSync } from 'node:fs'
import WebSocket from 'ws'

const page = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).find(
  (t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('#didactic'),
)
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((r, j) => (ws.on('open', r), ws.on('error', j)))
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, resolve)
    ws.send(JSON.stringify({ id: i, method, params }))
  })

await send('Page.enable')
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (!shot.result?.data) {
  console.error('sin data:', JSON.stringify(shot).slice(0, 300))
  process.exit(1)
}
const out = process.argv[2] ?? '/tmp/minerva-cdp-shot.png'
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log(out)
ws.close()
