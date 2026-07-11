/**
 * Smoke e2e del botón "copiar URL del comentario" (v0.2.3) vía CDP:
 * cada comentario de un hilo (Conversación e inline en el diff) ofrece un
 * botón que copia su URL de github.com al portapapeles, con feedback
 * "Copiado". Requiere la app corriendo con --remote-debugging-port=9222.
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
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, resolve)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const COPY_LABEL = 'Copiar URL del comentario en GitHub'
const HELPERS = `
function cbt(t) {
  const a = Array.from(document.querySelectorAll('button,[role=button],a,li,div,span,p'))
  const e = a.find((x) => x.childElementCount === 0 && (x.textContent || '').trim().includes(t))
    || a.find((x) => (x.textContent || '').trim().includes(t) && x.getBoundingClientRect().height < 200)
  if (!e) return 'NF: ' + t
  ;(e.closest('button,[role=button],a,li,[class*=cursor-pointer]') || e).click()
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

// Estado limpio: PR neutral primero, luego el PR bajo prueba.
await evaluate(`${HELPERS}; cbt('Add refunds table and migration')`)
await sleep(1300)
await evaluate(`${HELPERS}; cbt('Add POST /carts/:id/apply-coupon')`)
await sleep(1300)

// 1. Botones de copiar presentes en Conversación (#482): uno por comentario visible.
const btnCount = await evaluate(
  `document.querySelectorAll('button[aria-label="${COPY_LABEL}"]').length`,
)
check('botones de copiar URL presentes en Conversación (#482)', Number(btnCount) >= 3, `count=${btnCount}`)

// 2. Click en el primero → el portapapeles tiene la URL github.com del comentario.
// navigator.clipboard (write y read) exige documento CON FOCO: sin esto, el
// write falla silencioso (sin "Copiado") y el read tira NotAllowedError.
await send('Page.bringToFront')
await sleep(400)
const copied = await evaluate(`
  (async () => {
    const btn = document.querySelector('button[aria-label="${COPY_LABEL}"]')
    if (!btn) return 'NO_BTN'
    btn.click()
    await new Promise((r) => setTimeout(r, 300))
    try {
      return await navigator.clipboard.readText()
    } catch (err) {
      return 'READ_FAIL: ' + err
    }
  })()
`)
const urlOk = /^https:\/\/github\.com\/shopwave\/.+\/pull\/482#(discussion_r|issuecomment-)/.test(
  String(copied),
)
check('clipboard contiene URL github.com del comentario', urlOk, `clipboard=${String(copied).slice(0, 120)}`)

// 3. Feedback "Copiado" visible tras el click (señal inequívoca: no existe antes).
const feedback = await evaluate('document.body.innerText.includes("Copiado")')
check('feedback "Copiado" visible tras copiar', feedback === true)

// 4. El feedback es transitorio (1.5s): desaparece solo.
await sleep(2000)
const feedbackGone = await evaluate('document.body.innerText.includes("Copiado")')
check('feedback "Copiado" desaparece tras ~1.5s', feedbackGone === false)

// 5. ThreadCard inline en el diff (chip → Archivos) también ofrece el botón.
await evaluate(`
  (() => {
    const chip = Array.from(document.querySelectorAll('[role="link"]')).find((b) =>
      /coupon-service\\.ts:\\d+/.test(b.textContent || ''),
    )
    if (chip) chip.click()
  })()
`)
await sleep(1800)
const inlineBtns = await evaluate(
  `document.querySelectorAll('button[aria-label="${COPY_LABEL}"]').length`,
)
check('botón de copiar URL en hilo inline del diff', Number(inlineBtns) > 0, `count=${inlineBtns}`)

ws.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
