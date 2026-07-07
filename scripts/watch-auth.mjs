import WebSocket from 'ws'

const deadline = Date.now() + 12 * 60 * 1000
async function status() {
  const res = await fetch('http://127.0.0.1:9222/json/list')
  const page = (await res.json()).find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) return { state: 'app_gone' }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => (ws.on('open', r), ws.on('error', j)))
  let id = 0
  const pend = new Map()
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id) }
  })
  const st = await new Promise((r) => {
    const i = ++id
    pend.set(i, (x) => r(x.result?.value))
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: 'window.minerva.auth.getStatus()', awaitPromise: true, returnByValue: true } }))
  })
  ws.close()
  return st
}
while (Date.now() < deadline) {
  try {
    const st = await status()
    console.log(new Date().toISOString(), JSON.stringify(st))
    if (st.state === 'signed_in') { console.log('LOGIN COMPLETADO:', st.user?.login); process.exit(0) }
    if (st.state === 'app_gone') { console.log('APP CERRADA'); process.exit(2) }
    if (st.state === 'signed_out') { console.log('FLOW EXPIRADO O CANCELADO'); process.exit(3) }
  } catch (e) { console.log('err', e.message) }
  await new Promise((r) => setTimeout(r, 5000))
}
console.log('TIMEOUT sin autorizar')
process.exit(1)
