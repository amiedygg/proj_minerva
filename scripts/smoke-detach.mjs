/**
 * Smoke e2e T14: cache de análisis, ventana desacoplada y visor de recursos.
 * Pensado para modo mock-IA (sin OPENROUTER_API_KEY) — rápido y sin costo.
 * Requiere la app corriendo con --remote-debugging-port=9222.
 */
import WebSocket from 'ws'

const CDP = 'http://127.0.0.1:9222'

async function connect(url) {
  const ws = new WebSocket(url, { maxPayload: 64 * 1024 * 1024 })
  await new Promise((r, j) => (ws.on('open', r), ws.on('error', j)))
  const pending = new Map()
  let id = 0
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result)
      pending.delete(m.id)
    }
  })
  const evaluate = (expression, timeout = 120000) =>
    new Promise((resolve, reject) => {
      const i = ++id
      pending.set(i, (r) =>
        resolve(
          r.exceptionDetails
            ? 'EXC: ' +
                JSON.stringify(r.exceptionDetails.exception?.description ?? '').slice(0, 300)
            : r.result?.value,
        ),
      )
      ws.send(
        JSON.stringify({
          id: i,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      )
      setTimeout(() => reject(new Error('timeout')), timeout)
    })
  return { ws, evaluate }
}

const targets = async () => (await fetch(`${CDP}/json/list`)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const checks = []
const check = (name, cond, extra) => {
  checks.push(cond)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? ' — ' + extra : ''}`)
}

const mainTarget = (await targets()).find(
  (t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('#didactic'),
)
const main = await connect(mainTarget.webSocketDebuggerUrl)

for (let i = 0; i < 20; i++) {
  const t = await main.evaluate('document.body.innerText')
  if (typeof t === 'string' && t.includes('apply-coupon')) break
  await sleep(500)
}

const PR = `{repo:{owner:'shopwave',name:'api',fullName:'shopwave/api'},number:482}`

// Invalidar cache primero: si otra suite ya analizó #482 en esta sesión, el
// "primer análisis" sería cache-hit sin eventos y el check 1 fallaría.
await main.evaluate(`window.minerva.ai.invalidateAnalysis(${PR})`)

// 1. Primer análisis: streamea (mock ~1s) y llena el cache
const first = await main.evaluate(`
  (async () => {
    let events = 0
    const unsub = window.minerva.events.onAnalysisProgress(() => { events++ })
    const t0 = Date.now()
    await window.minerva.ai.analyzePullRequest(${PR})
    unsub()
    return { ms: Date.now() - t0, events }
  })()
`)
check('primer análisis streamea (eventos > 0)', first?.events > 0, JSON.stringify(first))

// 2. Segundo análisis: cache hit → instantáneo y SIN eventos
const second = await main.evaluate(`
  (async () => {
    let events = 0
    const unsub = window.minerva.events.onAnalysisProgress(() => { events++ })
    const t0 = Date.now()
    await window.minerva.ai.analyzePullRequest(${PR})
    unsub()
    return { ms: Date.now() - t0, events }
  })()
`)
check(
  'cache hit: instantáneo (<300ms) y sin eventos de streaming',
  second?.ms < 300 && second?.events === 0,
  JSON.stringify(second),
)

// 3. getCachedAnalysis devuelve el análisis
const cached = await main.evaluate(
  `window.minerva.ai.getCachedAnalysis(${PR}).then((a) => (a ? a.sections.map((s) => s.kind) : null))`,
)
check('getCachedAnalysis devuelve secciones', Array.isArray(cached) && cached.length > 0, JSON.stringify(cached))

// 4. Abrir ventana desacoplada. T22: a propósito se CLIQUEA el botón real
// "Abrir en ventana" (en vez de llamar window.minerva.window.openDidactic
// directo, como hacían las suites viejas) porque el efecto colateral nuevo
// (cerrar el panel acoplado) vive en el onClick de DidacticPanel.tsx, no en
// el canal IPC — llamarlo directo no lo hubiera ejercitado. Y ESE botón solo
// se renderiza con un PR seleccionado en la UI (los checks 1–3 usan IPC
// crudo, no seleccionan nada): primero se limpia el buscador (contaminación
// entre suites, lección de smoke-didactic) y se clickea el PR 482 en la
// lista; también lo necesita el check 8 (reabrir el panel acoplado).
await main.evaluate(`
  (() => {
    const input = document.querySelector('input')
    if (!input || !input.value) return 'ya limpio'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'limpiado'
  })()
`)
await sleep(500)
const prClicked = await main.evaluate(`
  (() => {
    const a = Array.from(document.querySelectorAll('button,[role=button],a,li,div,span,p'))
    const e = a.find((x) => x.childElementCount === 0 && (x.textContent || '').trim().includes('apply-coupon'))
      || a.find((x) => (x.textContent || '').trim().includes('apply-coupon') && x.getBoundingClientRect().height < 200)
    if (!e) return 'NF'
    ;(e.closest('button,[role=button],a,li,[class*=cursor-pointer]') || e).click()
    return 'OK'
  })()
`)
if (prClicked !== 'OK') console.log('WARN: no se pudo seleccionar el PR 482 en la lista:', prClicked)
let detachBtnReady = false
for (let i = 0; i < 10 && !detachBtnReady; i++) {
  detachBtnReady = await main.evaluate(
    `Boolean(document.querySelector('button[aria-label="Abrir en ventana"]'))`,
  )
  if (!detachBtnReady) await sleep(500)
}
await main.evaluate(`document.querySelector('button[aria-label="Abrir en ventana"]')?.click()`)
await sleep(3000)
let list = await targets()
const detached = list.find((t) => t.type === 'page' && t.url.includes('#didactic/shopwave/api/482'))
check('segunda ventana con hash #didactic aparece en CDP', Boolean(detached), JSON.stringify(list.map((t) => t.url)))

// T22: desacoplar debe CERRAR el panel acoplado (antes quedaban las dos
// superficies mostrando el mismo análisis a la vez, sin motivo). Señal
// inequívoca (regla del CLAUDE.md): el botón "Abrir panel didáctico" del
// aside colapsado (w-10) presente, y el header expandido (con "Cerrar panel
// didáctico") ausente.
check(
  'el panel acoplado se CIERRA tras desacoplar (T22)',
  await main.evaluate(`
    Boolean(document.querySelector('button[aria-label="Abrir panel didáctico"]')) &&
    !document.querySelector('button[aria-label="Cerrar panel didáctico"]')
  `),
)

let det = null
if (detached) {
  det = await connect(detached.webSocketDebuggerUrl)
  let text = ''
  for (let i = 0; i < 10; i++) {
    text = await det.evaluate('document.body.innerText')
    if (text && text.length > 100) break
    await sleep(500)
  }
  // 5. La ventana muestra el análisis desde cache sin pulsar nada
  check(
    'ventana desacoplada muestra análisis desde cache (sin click)',
    text.includes('Resumen') || text.includes('Endpoint'),
    text.slice(0, 200),
  )
  check('ventana desacoplada tiene botón Re-analizar', /Re-?analizar/i.test(text))

  // 6. Visor de recursos. Con IA REAL las secciones del análisis dependen
  // del modelo: si hay diagrama (architecture/schema en `cached`, check 3)
  // se expande por aria-label y se exige zoom + SVG visible; si no, se
  // expande un snippet o la sección y se exige el overlay del visor. (Antes
  // este check clickeaba el PRIMER botón maximize del DOM — el de "ver
  // sección en grande", sin zoom — y pasaba de casualidad por un '%' en el
  // texto del análisis.)
  const hasDiagram =
    Array.isArray(cached) && (cached.includes('architecture') || cached.includes('schema'))
  const expand = await det.evaluate(`
    (() => {
      const btn =
        document.querySelector('button[aria-label="Expandir diagrama"]') ||
        document.querySelector('button[aria-label="Expandir snippet"]') ||
        document.querySelector('button[aria-label="Ver esta sección en grande"]')
      if (!btn) return 'NO_EXPAND_BTN'
      btn.click()
      return btn.getAttribute('aria-label')
    })()
  `)
  // El render de mermaid dentro del visor es asíncrono (import lazy + parse):
  // poll en vez de un sleep fijo, hasta 6s.
  let viewerState = null
  for (let i = 0; i < 12; i++) {
    await sleep(500)
    viewerState = await det.evaluate(`
      (() => {
        const overlay = document.querySelector('.fixed.inset-0')
        const zoom = Array.from(document.querySelectorAll('span')).some((s) =>
          /^\\d+%$/.test((s.textContent || '').trim()),
        )
        const svg = overlay?.querySelector('svg[id*="mermaid"], svg[aria-roledescription]')
        const r = svg ? svg.getBoundingClientRect() : null
        // altura real del área de zoom: sin esto, un diálogo colapsado a 0px
        // pasaba el check (el rect del svg ignora clipping) — bug T15-bis
        const zoomArea = svg ? svg.closest('[class*="overflow-hidden"]') : null
        const zoomAreaH = zoomArea ? Math.round(zoomArea.getBoundingClientRect().height) : 0
        return { overlay: Boolean(overlay), zoom, svgW: r ? Math.round(r.width) : 0, zoomAreaH }
      })()
    `)
    if (
      viewerState &&
      viewerState.overlay &&
      (!hasDiagram || (viewerState.svgW > 100 && viewerState.zoomAreaH > 300))
    )
      break
  }
  const viewerOk = hasDiagram
    ? expand === 'Expandir diagrama' &&
      viewerState?.zoom === true &&
      viewerState?.svgW > 100 &&
      viewerState?.zoomAreaH > 300
    : expand !== 'NO_EXPAND_BTN' && viewerState?.overlay === true
  check(
    hasDiagram
      ? 'visor de recursos abre con zoom y el diagrama visible dentro'
      : 'visor de recursos abre (análisis sin diagrama: snippet/sección)',
    viewerOk,
    `hasDiagram=${hasDiagram} expand=${expand} ${JSON.stringify(viewerState)}`,
  )

  // Esc cierra
  await det.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await sleep(500)

  // 7. Reutilización de ventana con otro PR. Además de la URL se verifica el
  // CONTENIDO: la re-navegación con solo el hash distinto es same-document
  // (sin recarga), y durante mucho tiempo la ventana mostraba el PR anterior
  // con la URL del nuevo — el check solo-URL nunca lo detectó.
  await main.evaluate(
    `window.minerva.window.openDidactic({ repo: { owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }, number: 479, title: 'Add refunds table' })`,
  )
  await sleep(3000)
  list = await targets()
  const didacticTargets = list.filter((t) => t.type === 'page' && t.url.includes('#didactic'))
  let reusedShows479 = false
  for (let i = 0; i < 10 && !reusedShows479; i++) {
    const t = await det.evaluate('document.body.innerText')
    reusedShows479 =
      typeof t === 'string' && t.includes('Add refunds table') && !t.includes('apply-coupon')
    if (!reusedShows479) await sleep(500)
  }
  check(
    'reabrir con otro PR reutiliza la MISMA ventana Y muestra el PR nuevo (479)',
    didacticTargets.length === 1 && didacticTargets[0].url.includes('/479') && reusedShows479,
    JSON.stringify({ urls: didacticTargets.map((t) => t.url), reusedShows479 }),
  )
}

// 8. T22: reabrir el panel acoplado (quedó cerrado por el detach del check 4)
// con cache poblado (PR 482, check 1) debe mostrar el análisis directo, SIN
// pulsar "Analizar PR". Señal inequívoca: botón "Re-analizar" habilitado.
await main.evaluate(`document.querySelector('button[aria-label="Abrir panel didáctico"]')?.click()`)
let reopenedText = ''
for (let i = 0; i < 10; i++) {
  reopenedText = await main.evaluate('document.body.innerText')
  if (/Re-?analizar/i.test(reopenedText)) break
  await sleep(300)
}
check(
  'reabrir el panel acoplado con cache poblado muestra el análisis SIN pulsar "Analizar PR"',
  /Re-?analizar/i.test(reopenedText) && !/Buscando un análisis/.test(reopenedText),
  reopenedText.slice(0, 150),
)

// 9. T22: dedupe in-flight — dos `analyzePullRequest` concurrentes del MISMO
// PR (sin esperar entre ellos) deben resolver el MISMO análisis (mismo
// `generatedAt`: si hubiera una segunda llamada real al mock/LLM, el
// `generatedAt` del segundo saldría ~900ms más tarde, el tiempo que tarda el
// mock en streamear sus 6 trozos). Se usa un PR aparte (shopwave/web#201,
// intacto en esta suite hasta acá) para no pisar el estado de los checks de
// arriba.
const PR_201 = `{repo:{owner:'shopwave',name:'web',fullName:'shopwave/web'},number:201}`
await main.evaluate(`window.minerva.ai.invalidateAnalysis(${PR_201})`)
const dedupe = await main.evaluate(`
  (async () => {
    const [a, b] = await Promise.all([
      window.minerva.ai.analyzePullRequest(${PR_201}),
      window.minerva.ai.analyzePullRequest(${PR_201}),
    ])
    return {
      sameGeneratedAt: a.generatedAt === b.generatedAt,
      sameKinds: JSON.stringify(a.sections.map((s) => s.kind)) === JSON.stringify(b.sections.map((s) => s.kind)),
    }
  })()
`)
check(
  'in-flight dedupe: dos analyzePullRequest concurrentes del mismo PR resuelven el MISMO análisis (cero llamadas extra al mock/LLM)',
  dedupe?.sameGeneratedAt === true && dedupe?.sameKinds === true,
  JSON.stringify(dedupe),
)

// 10. T22: una ventana desacoplada abierta A MITAD de un streaming se
// engancha al análisis en curso (no ve el placeholder) y termina mostrando
// el resultado completo, todo sin disparar una segunda llamada. Se invalida
// de nuevo #201 y se dispara el análisis SIN esperar (el mock tarda ~900ms:
// 6 trozos * 150ms), dejando una ventana de tiempo para adjuntar a mitad de
// camino.
await main.evaluate(`window.minerva.ai.invalidateAnalysis(${PR_201})`)
void main.evaluate(`window.minerva.ai.analyzePullRequest(${PR_201})`)
await sleep(250)
const midState = await main.evaluate(`window.minerva.ai.getAnalysisState(${PR_201}).then((s) => s.status)`)
check(
  'ai:getAnalysisState devuelve "streaming" a mitad de un análisis en curso',
  midState === 'streaming',
  midState,
)

await main.evaluate(
  `window.minerva.window.openDidactic({ repo: { owner: 'shopwave', name: 'web', fullName: 'shopwave/web' }, number: 201, title: 'PR 201 en streaming' })`,
)
// Poll agresivo (no sleep fijo): el mock termina en ~900ms, cada ms de espera
// de más achica la ventana para observar el estado "adjunta a mitad de
// streaming" del check siguiente.
let attachTarget = null
for (let i = 0; i < 30 && !attachTarget; i++) {
  await sleep(100)
  list = await targets()
  attachTarget = list.find(
    (t) => t.type === 'page' && t.url.includes('#didactic/shopwave/web/201'),
  )
}
check(
  'la ventana desacoplada navega al PR que está streameando en otra ventana',
  Boolean(attachTarget),
  JSON.stringify(list.map((t) => t.url)),
)

if (attachTarget && det) {
  // Contenido PARCIAL: la señal inequívoca NO es la ausencia de
  // "Re-analizar" (ese botón se muestra también DURANTE un streaming
  // adjunto, en cuanto hay resultado que pintar — matcher ambiguo que hizo
  // fallar la primera versión de este check). La señal correcta es: la
  // ventana muestra contenido MIENTRAS `ai:getAnalysisState` sigue en
  // `streaming` (o el cursor `▍` de sección abierta está visible). Si el
  // mock terminó antes de que alcanzáramos a mirar (carrera inherente:
  // abrir la ventana tarda casi lo que dura el mock), se acepta como
  // degradado observar `cached` + contenido SIN haber pasado por el
  // placeholder ("Analizar PR" nunca visible).
  let sawPartial = false
  let sawPlaceholder = false
  let lastSample = null
  for (let i = 0; i < 30 && !sawPartial; i++) {
    const [text, state] = await Promise.all([
      det.evaluate('document.body.innerText'),
      main.evaluate(`window.minerva.ai.getAnalysisState(${PR_201}).then((s) => s.status)`),
    ])
    const hasContent = typeof text === 'string' && text.length > 80 && /Resumen|Qué cambia/.test(text)
    const hasCursor = typeof text === 'string' && text.includes('▍')
    if (typeof text === 'string' && text.includes('Analizar PR')) sawPlaceholder = true
    lastSample = { state, len: typeof text === 'string' ? text.length : -1, hasCursor }
    if (hasContent && (state === 'streaming' || hasCursor)) sawPartial = true
    if (state === 'cached' && hasContent) break
    await sleep(100)
  }
  check(
    'ventana adjunta a mitad de streaming muestra contenido parcial (nunca el placeholder)',
    sawPartial || (!sawPlaceholder && lastSample?.state === 'cached'),
    JSON.stringify({ sawPartial, sawPlaceholder, lastSample }),
  )

  // Termina mostrando el análisis completo: señal inequívoca, botón
  // "Re-analizar" habilitado (regla de suites del CLAUDE.md).
  let finalText = ''
  for (let i = 0; i < 15; i++) {
    finalText = await det.evaluate('document.body.innerText')
    if (/Re-?analizar/i.test(finalText)) break
    await sleep(300)
  }
  check(
    'ventana adjunta termina mostrando el análisis completo (botón Re-analizar habilitado)',
    /Re-?analizar/i.test(finalText),
    finalText.slice(0, 150),
  )

  // "Re-analizar" visible NO implica terminado (se muestra también durante
  // el streaming adjunto): el estado final se pollea hasta `cached`, con
  // margen de sobra sobre los ~900ms del mock.
  let finalState = null
  for (let i = 0; i < 20; i++) {
    finalState = await main.evaluate(
      `window.minerva.ai.getAnalysisState(${PR_201}).then((s) => s.status)`,
    )
    if (finalState === 'cached') break
    await sleep(250)
  }
  check(
    '`ai:getAnalysisState` pasó por streaming y terminó en cached (sin quedar colgado)',
    finalState === 'cached',
    finalState,
  )

  // 11. T22-bis (listener permanente): la ventana desacoplada YA ABIERTA en
  // un PR debe enterarse de un análisis que arranca DESPUÉS en otra
  // superficie — incluso sin remount (reutilizarla con el MISMO PR no
  // dispara `hashchange`). Bug real: la primera implementación solo se
  // suscribía al streaming al montar, y una ventana abierta en estado
  // idle/viejo quedaba SORDA mostrando contenido desactualizado mientras el
  // análisis corría delante de ella. Señal: se invalida #201 y se relanza
  // desde la ventana PRINCIPAL; la desacoplada (sin tocarla) debe terminar
  // mostrando el análisis nuevo (generatedAt distinto vía getAnalysisState).
  const beforeReplay = await main.evaluate(
    `window.minerva.ai.getCachedAnalysis(${PR_201}).then((a) => a && a.generatedAt)`,
  )
  await main.evaluate(`window.minerva.ai.invalidateAnalysis(${PR_201})`)
  void main.evaluate(`window.minerva.ai.analyzePullRequest(${PR_201})`)
  let replayed = null
  for (let i = 0; i < 30; i++) {
    await sleep(300)
    replayed = await main.evaluate(`
      window.minerva.ai.getAnalysisState(${PR_201}).then((s) =>
        s.status === 'cached' ? s.analysis.generatedAt : null,
      )
    `)
    if (replayed && replayed !== beforeReplay) break
  }
  // La desacoplada debe mostrar el análisis nuevo sin interacción: contenido
  // presente y SIN quedarse a mitad de streaming (cursor ▍ ausente al final).
  let deafText = ''
  let deafOk = false
  for (let i = 0; i < 15 && !deafOk; i++) {
    deafText = await det.evaluate('document.body.innerText')
    deafOk =
      typeof deafText === 'string' &&
      /Resumen|Qué cambia/.test(deafText) &&
      !deafText.includes('▍') &&
      !deafText.includes('Analizar PR')
    if (!deafOk) await sleep(400)
  }
  check(
    'ventana desacoplada ya abierta (sin remount) se sincroniza con un análisis lanzado después en otra superficie',
    replayed !== null && replayed !== beforeReplay && deafOk,
    JSON.stringify({ beforeReplay, replayed, snippet: (deafText || '').slice(0, 120) }),
  )
}

main.ws.close()
if (det) det.ws.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks OK`)
process.exit(failed ? 1 : 0)
