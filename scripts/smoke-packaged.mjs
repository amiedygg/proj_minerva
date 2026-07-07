/**
 * Smoke test e2e del EMPAQUETADO (T24) vía CDP, contra el binario real de
 * electron-builder (AppImage o dist/linux-unpacked/minerva), lanzado con:
 *
 *   MINERVA_MOCK=1 ./dist/Minerva-<v>.AppImage --remote-debugging-port=5175
 *
 * Diferencias vs smoke-e2e.mjs (dev): el target CDP es la URL file:// del
 * renderer empaquetado (en dev es localhost:5173) — que el target sea file://
 * es en sí la prueba de que corre el build empaquetado y no el dev server.
 *
 * Uso: node scripts/smoke-packaged.mjs [salida-captura.png]
 *      MINERVA_CDP_PORT para cambiar el puerto (default 5175, para no chocar
 *      con una instancia dev en 9222).
 */
import { writeFileSync } from 'node:fs'
import WebSocket from 'ws'

const CDP_BASE = `http://127.0.0.1:${process.env.MINERVA_CDP_PORT ?? 5175}`
const SCREENSHOT = process.argv[2] ?? ''
const results = []

function ok(name) {
  results.push(['PASS', name])
  console.log(`PASS  ${name}`)
}
function fail(name, extra) {
  results.push(['FAIL', name])
  console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`)
}

async function getPageTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${CDP_BASE}/json/list`)
      const targets = await res.json()
      const page = targets.find(
        (t) =>
          t.type === 'page' &&
          t.url.startsWith('file://') &&
          t.url.includes('index.html') &&
          !t.url.includes('#didactic'),
      )
      if (page) return page
    } catch {
      /* aún no arriba */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(
    `No apareció el target file:// en CDP (${CDP_BASE}). ¿AppImage corriendo con --remote-debugging-port?`,
  )
}

let msgId = 0
function createRpc(ws) {
  const pending = new Map()
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  })
  return async function send(method, params = {}, timeoutMs = 15000) {
    const id = ++msgId
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`timeout en ${method}`))
        }
      }, timeoutMs)
    })
  }
}

const CLICK_BY_TEXT = `
function clickByText(text) {
  const all = Array.from(document.querySelectorAll('button, [role="button"], a, li, div, span, h1, h2, h3, p'))
  const el = all.find((e) => e.childElementCount === 0 && (e.textContent || '').trim().includes(text))
    || all.find((e) => (e.textContent || '').trim().includes(text) && e.getBoundingClientRect().height < 200)
  if (!el) return 'NOT_FOUND: ' + text
  const clickable = el.closest('button, [role="button"], a, li, [class*="cursor-pointer"]') || el
  clickable.click()
  return 'CLICKED'
}
`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const page = await getPageTarget()
  ok(`target empaquetado encontrado (${page.url.slice(0, 60)}...)`)

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  const send = createRpc(ws)
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`excepción en página: ${result.exceptionDetails.text}`)
    }
    return result.result?.value
  }

  // 1. Preload cargó (window.minerva expuesto por contextBridge)
  const bridge = await evaluate('typeof window.minerva')
  bridge === 'object'
    ? ok('preload CJS cargado (window.minerva expuesto)')
    : fail('preload cargado', `typeof window.minerva = ${bridge}`)

  // 2. La lista de PRs mock cargó vía IPC (fixtures de main dentro del asar)
  let text = ''
  for (let i = 0; i < 20; i++) {
    text = await evaluate('document.body.innerText')
    if (text.includes('apply-coupon')) break
    await sleep(500)
  }
  text.includes('apply-coupon') && text.includes('SHOPWAVE')
    ? ok('lista de PRs mock cargada vía IPC (main del asar responde)')
    : fail('lista de PRs mock', 'no aparece contenido de fixtures')

  // 3. Indicador de conexión IPC
  text.includes('Conectado')
    ? ok('indicador "Conectado" (ping IPC ok)')
    : fail('indicador "Conectado"', 'no visible')

  // 4. Seleccionar un PR y ver el detalle
  const clicked = await evaluate(`${CLICK_BY_TEXT}; clickByText('Add refunds table and migration')`)
  if (clicked !== 'CLICKED') fail('click en PR de la lista', clicked)
  await sleep(1200)
  text = await evaluate('document.body.innerText')
  text.includes('#479')
    ? ok('detalle del PR renderiza (#479)')
    : fail('detalle del PR', 'no aparece #479 tras el click')

  // 5. Tab Archivos (diff parseado + Shiki desde el bundle del renderer)
  await evaluate(`${CLICK_BY_TEXT}; clickByText('Archivos')`)
  await sleep(1000)
  text = await evaluate('document.body.innerText')
  ;/migrations|refunds|\.sql|\.ts/.test(text)
    ? ok('tab Archivos lista los DiffFiles del PR')
    : fail('tab Archivos', 'no se ven archivos del PR')

  // 6. Captura para la verificación visual del orquestador
  if (SCREENSHOT) {
    await send('Page.enable')
    const shot = await send('Page.captureScreenshot', { format: 'png' }, 30000)
    if (shot?.data) {
      writeFileSync(SCREENSHOT, Buffer.from(shot.data, 'base64'))
      ok(`captura guardada en ${SCREENSHOT}`)
    } else {
      fail('captura CDP', JSON.stringify(shot).slice(0, 200))
    }
  }

  ws.close()
  const failed = results.filter(([s]) => s === 'FAIL').length
  console.log(`\n${results.length - failed}/${results.length} checks OK`)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error('ERROR:', err.message)
  process.exit(1)
})
