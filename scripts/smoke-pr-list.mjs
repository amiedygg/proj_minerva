/**
 * Smoke F10 (v0.3.0): filtro de estado, refresh manual, dots de no-visto y
 * watcher de cambios de la lista de PRs.
 *
 * Requiere la app corriendo con:
 *   MINERVA_MOCK=1 MINERVA_WATCH_INTERVAL_MS=1500 npm run dev -- -- --remote-debugging-port=9222
 *
 * El intervalo corto del watcher es NECESARIO para el caso (6); con el default
 * de 60s el caso fallaría por timeout.
 */
import WebSocket from 'ws'

const res = await fetch('http://127.0.0.1:9222/json/list')
const page = (await res.json()).find(
  (t) => t.type === 'page' && t.url.includes('localhost:5173') && !t.url.includes('#didactic'),
)
if (!page) {
  console.error('sin target CDP')
  process.exit(2)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
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
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, (r) => resolve(r.result?.value))
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`PASS  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// Títulos de fixtures del universo shopwave usados como señales.
const OPEN_PR = 'apply-coupon' // #482 shopwave/api, open, commentCount 2
const CLOSED_PR = 'GraphQL gateway proxy' // #455 shopwave/api, closed
const MERGED_PR_A = 'pagination to order history' // #185 shopwave/web, merged
const MERGED_PR_B = 'multi-currency support' // #68 shopwave/checkout-service, merged
const WATCHED_PR = 'race condition in payment webhook' // open, para el caso del watcher

// --- Estado limpio: reload resetea el store zustand (gotcha T49) ---
await evaluate('location.reload()')
for (let i = 0; i < 30; i++) {
  await sleep(500)
  const t = await evaluate('document.body.innerText')
  if (typeof t === 'string' && t.includes(OPEN_PR)) break
}

const bodyText = () => evaluate('document.body.innerText')

const clickButtonByText = (label) =>
  evaluate(
    `(() => {
      const btn = [...document.querySelectorAll('aside button')]
        .find((b) => b.textContent.trim() === ${JSON.stringify(label)})
      if (!btn) return 'not-found'
      btn.click()
      return 'clicked'
    })()`,
  )

// Item de PR (button) cuyo texto contiene el título dado; devuelve datos de dots/contador.
const itemInfo = (title) =>
  evaluate(
    `(() => {
      const item = [...document.querySelectorAll('aside button')]
        .find((b) => b.innerText.includes(${JSON.stringify(title)}))
      if (!item) return null
      // Contador de comentarios: ÚNICO span del item que envuelve un svg y
      // cuyo texto es solo dígitos (MessageSquare + count). No usar
      // includes(dígito) sobre el texto completo: +adds/-dels y #número
      // producen falsos positivos (lección de la 1ª corrida de esta suite).
      const counter = [...item.querySelectorAll('span')].find(
        (s) => s.querySelector('svg') && /^\\d+$/.test(s.innerText.trim()),
      )
      return {
        unseenDot: Boolean(item.querySelector('span[title="Cambios sin ver"]')),
        commentsDot: Boolean(item.querySelector('span[title="Comentarios nuevos"]')),
        commentCount: counter ? counter.innerText.trim() : null,
        text: item.innerText,
      }
    })()`,
  )

// --- (1) Filtro "Abiertos" (default): sin closed/merged ---
{
  const t = await bodyText()
  check(
    'filtro Abiertos por defecto (open visible, closed/merged fuera)',
    t.includes(OPEN_PR) && !t.includes(CLOSED_PR) && !t.includes(MERGED_PR_A),
  )
}

// --- (2) Filtro "Cerrados": solo closed+merged, con badges ---
{
  await clickButtonByText('Cerrados')
  await sleep(900) // fetch inmediato (sin debounce) + latencia mock 220ms
  const t = await bodyText()
  const badges = await evaluate(
    `(() => {
      const spans = [...document.querySelectorAll('aside span')]
      return {
        merged: spans.filter((s) => s.textContent.trim() === 'merged').length,
        closed: spans.filter((s) => s.textContent.trim() === 'closed').length,
      }
    })()`,
  )
  check(
    'filtro Cerrados muestra closed+merged y oculta open',
    t.includes(CLOSED_PR) && t.includes(MERGED_PR_A) && t.includes(MERGED_PR_B) && !t.includes(OPEN_PR),
  )
  check(
    'badges de estado en Cerrados (>=2 merged, >=1 closed)',
    badges && badges.merged >= 2 && badges.closed >= 1,
    JSON.stringify(badges),
  )
}

// --- (3) Filtro "Todos": open y closed conviven ---
{
  await clickButtonByText('Todos')
  await sleep(900)
  const t = await bodyText()
  check('filtro Todos muestra open y closed', t.includes(OPEN_PR) && t.includes(CLOSED_PR))
}

// --- volver a Abiertos para el resto ---
await clickButtonByText('Abiertos')
await sleep(900)

// --- (4) Refresh manual: botón presente, click repuebla sin error ---
{
  const clicked = await evaluate(
    `(() => {
      const btn = document.querySelector('aside button[aria-label="Actualizar"], aside button[title="Actualizar"]')
      if (!btn) return 'not-found'
      btn.click()
      return 'clicked'
    })()`,
  )
  await sleep(900)
  const t = await bodyText()
  check(
    'refresh manual (botón Actualizar re-fetchea sin error)',
    clicked === 'clicked' && t.includes(OPEN_PR) && !t.includes('No se pudo cargar'),
    `click=${clicked}`,
  )
}

// --- (5) Dots de no-visto + markPrSeen ---
// Sellar "visto" con valores VIEJOS fuerza un estado unread determinístico
// (updatedAt actual > sellado ⇒ hasUpdates; commentCount 2 > 0 ⇒ hasNewComments),
// inmune a lo que hayan dejado corridas anteriores en pr-seen.json.
{
  const target = await evaluate(
    `(async () => {
      const prs = await window.minerva.github.listPullRequests({ state: 'open' })
      const pr = prs.find((p) => p.title.includes(${JSON.stringify(OPEN_PR)}))
      if (!pr) return null
      await window.minerva.github.markPrSeen({
        prId: pr.id,
        updatedAt: '2020-01-01T00:00:00Z',
        commentCount: 0,
      })
      const again = await window.minerva.github.listPullRequests({ state: 'open' })
      return again.find((p) => p.id === pr.id)?.unread ?? null
    })()`,
  )
  check(
    'unread por IPC tras sellar visto viejo (hasUpdates + hasNewComments)',
    target && target.isNew === false && target.hasUpdates === true && target.hasNewComments === true,
    JSON.stringify(target),
  )

  // refetch de la UI para que pinte los dots
  await evaluate(
    `document.querySelector('aside button[aria-label="Actualizar"], aside button[title="Actualizar"]').click()`,
  )
  await sleep(900)
  const before = await itemInfo(OPEN_PR)
  check(
    'dot rojo de cambios sin ver + dot de comentarios visibles en el item',
    before && before.unseenDot && before.commentsDot,
    JSON.stringify(before),
  )

  // seleccionar el PR = marcar visto ⇒ dots se apagan (optimista, sin refetch)
  await evaluate(
    `[...document.querySelectorAll('aside button')]
      .find((b) => b.innerText.includes(${JSON.stringify(OPEN_PR)}))
      .click()`,
  )
  await sleep(600)
  const after = await itemInfo(OPEN_PR)
  check(
    'seleccionar el PR apaga ambos dots (clear optimista)',
    after && !after.unseenDot && !after.commentsDot,
    JSON.stringify(after),
  )

  const persisted = await evaluate(
    `(async () => {
      const prs = await window.minerva.github.listPullRequests({ state: 'open' })
      return prs.find((p) => p.title.includes(${JSON.stringify(OPEN_PR)}))?.unread ?? null
    })()`,
  )
  check(
    'markPrSeen persistió en main (unread limpio en nueva query)',
    persisted &&
      persisted.isNew === false &&
      persisted.hasUpdates === false &&
      persisted.hasNewComments === false,
    JSON.stringify(persisted),
  )
}

// --- (6) Watcher: un comentario nuevo refresca la lista SIN refresh manual ---
{
  const seed = await evaluate(
    `(async () => {
      const prs = await window.minerva.github.listPullRequests({ state: 'open' })
      const pr = prs.find((p) => p.title.includes(${JSON.stringify(WATCHED_PR)}))
      if (!pr) return null
      await window.minerva.github.postComment({
        repo: pr.repo,
        number: pr.number,
        bodyMarkdown: 'comentario del smoke pr-list (watcher)',
      })
      return { commentCount: pr.commentCount }
    })()`,
  )
  if (!seed) {
    check('watcher: fixture objetivo encontrado', false, WATCHED_PR)
  } else {
    const expected = `${seed.commentCount + 1}`
    let updated = null
    // El watcher (1.5s) debe detectar commentCount+1 y el hook refetchear solo.
    for (let i = 0; i < 16; i++) {
      await sleep(750)
      const info = await itemInfo(WATCHED_PR)
      if (info && info.commentCount === expected) {
        updated = info
        break
      }
    }
    check(
      `watcher refresca la lista solo (contador ${seed.commentCount} -> ${expected} sin click)`,
      Boolean(updated),
      updated ? '' : 'timeout 12s esperando el refetch del evento prListChanged',
    )
  }
}

ws.close()
if (failures > 0) {
  console.error(`\n${failures} caso(s) FAIL`)
  process.exit(1)
}
console.log('\nsmoke-pr-list: todos los casos PASS')
process.exit(0)
