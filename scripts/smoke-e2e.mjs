/**
 * Smoke test e2e vía Chrome DevTools Protocol contra la app corriendo en dev
 * con `--remote-debugging-port=9222`.
 *
 * Verifica el flujo T4: lista de PRs vía IPC → seleccionar PR → detalle →
 * tab Archivos → publicar comentario general end-to-end.
 *
 * Uso: node scripts/smoke-e2e.mjs
 */
import WebSocket from 'ws'

const CDP_BASE = 'http://127.0.0.1:9222'
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
        (t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('#didactic'),
      )
      if (page) return page
    } catch {
      /* aún no arriba */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('No apareció el target de página en CDP (¿app corriendo con --remote-debugging-port=9222?)')
}

let msgId = 0
function createEvaluator(ws) {
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
  return async function evaluate(expression) {
    const id = ++msgId
    const result = await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      )
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`timeout evaluando: ${expression.slice(0, 80)}`))
        }
      }, 15000)
    })
    if (result.exceptionDetails) {
      throw new Error(
        `excepción en página: ${result.exceptionDetails.text} ${JSON.stringify(result.exceptionDetails.exception?.description ?? '').slice(0, 300)}`,
      )
    }
    return result.result?.value
  }
}

// Helper inyectable: busca un elemento cuyo texto contenga `text` y clickea el
// ancestro clickeable más cercano.
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
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  const evaluate = createEvaluator(ws)

  // 1. La lista de PRs (vía IPC main→mock) cargó
  let text = ''
  for (let i = 0; i < 20; i++) {
    text = await evaluate('document.body.innerText')
    if (text.includes('apply-coupon')) break
    await sleep(500)
  }
  text.includes('apply-coupon') && text.includes('SHOPWAVE')
    ? ok('lista de PRs cargada vía IPC (fixtures de main visibles)')
    : fail('lista de PRs cargada vía IPC', 'no aparece contenido de fixtures')

  // 2. Indicador de conexión IPC
  text.includes('Conectado')
    ? ok('indicador "Conectado" (ping IPC ok)')
    : fail('indicador "Conectado"', 'no visible')

  // 3. Seleccionar un PR
  const clicked = await evaluate(
    `${CLICK_BY_TEXT}; clickByText('Add refunds table and migration')`,
  )
  if (clicked !== 'CLICKED') fail('click en PR de la lista', clicked)
  await sleep(1200) // latencia mock 180-320ms + render

  text = await evaluate('document.body.innerText')
  text.includes('#479')
    ? ok('detalle del PR seleccionado renderiza (header con #479)')
    : fail('detalle del PR seleccionado', 'no aparece #479 tras el click')

  // 4. Tab Archivos
  await evaluate(`${CLICK_BY_TEXT}; clickByText('Archivos')`)
  await sleep(1000)
  text = await evaluate('document.body.innerText')
  const hasFiles = /migrations|refunds|\.sql|\.ts/.test(text)
  hasFiles
    ? ok('tab Archivos lista DiffFiles del PR (vía IPC)')
    : fail('tab Archivos', 'no se ven archivos del PR')

  // 5. Volver a Conversación y publicar comentario
  await evaluate(`${CLICK_BY_TEXT}; clickByText('Conversación')`)
  await sleep(800)
  const posted = await evaluate(`
    (async () => {
      // Desde T8 hay varios textareas (replies de hilos): usar el composer
      // general, identificado por su placeholder.
      const ta = Array.from(document.querySelectorAll('textarea')).find((t) =>
        /Escribe un comentario/i.test(t.placeholder || ''),
      )
      if (!ta) return 'NO_TEXTAREA_GENERAL'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, 'Comentario de humo e2e — publicado vía CDP')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 200))
      const btns = Array.from(document.querySelectorAll('button'))
      // Coincidencia EXACTA: /comentar/i también matchea "· 1 comentario" en el
      // header colapsable de los hilos (aprendido a la mala).
      const btn = btns.find((b) => /^(Comentar|Publicar)$/.test((b.textContent || '').trim()))
      if (!btn) return 'NO_BUTTON: ' + btns.map((b) => b.textContent.trim()).filter(Boolean).join('|')
      btn.click()
      return 'SUBMITTED'
    })()
  `)
  if (posted !== 'SUBMITTED') fail('envío de comentario', posted)
  await sleep(1500) // postComment + recarga de hilos

  text = await evaluate('document.body.innerText')
  text.includes('Comentario de humo e2e')
    ? ok('comentario publicado y visible tras recargar hilos (postComment e2e)')
    : fail('comentario publicado', 'el texto no aparece en los hilos')

  ws.close()
  const failed = results.filter(([s]) => s === 'FAIL').length
  console.log(`\n${results.length - failed}/${results.length} checks OK`)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error('ERROR:', err.message)
  process.exit(2)
})
