/**
 * Watcher de PRs en background (T50/T51, F10): pollea `listPullRequests` a
 * intervalos regulares y emite `prListChanged` (`../../shared/events.ts`)
 * cuando detecta diferencias contra el snapshot del tick anterior. Vive en
 * `main` porque es quien tiene la instancia de `GithubService` y quien puede
 * empujar eventos a todas las ventanas — el renderer solo escucha
 * (`window.minerva.events.onPrListChanged`).
 *
 * Diseño deliberado (ver `.agents/PLAN.md` § "Iteración actual"):
 * - El PRIMER tick exitoso solo establece el snapshot baseline, SIN emitir
 *   evento — de lo contrario cada arranque de la app dispararía un aluvión
 *   de "PR nuevo" para todos los PRs existentes.
 * - Un PR produce A LO SUMO un `PrChange` por tick, con esta prioridad:
 *   cierre/merge > nuevos comentarios > cualquier otro `updatedAt` distinto.
 * - PRs que desaparecen del top-50 de la respuesta (paginado, archivado,
 *   etc.) NO generan `PrChange`: no hay forma de saber por qué desaparecieron
 *   y arriesgarse a reportar "cerrado" sería un falso positivo.
 * - `setTimeout` re-armado en vez de `setInterval`: permite variar el
 *   intervalo efectivo (backoff ante rate limit) sin acumular ticks
 *   superpuestos si un tick tarda más que el intervalo nominal.
 */
import type { PrChange, PrListChangedEvent } from '../../shared/events'
import type { PullRequestSummary } from '../../shared/types'

const DEFAULT_INTERVAL_MS = 60_000
const MAX_BACKOFF_MS = 15 * 60_000

export interface PrWatcherDeps {
  /**
   * Pide el listado completo de PRs (típicamente `{ state: 'all' }`). SÍ
   * puede rechazar — `tick()` envuelve la llamada en su propio `try/catch` y
   * clasifica el `message` del error (no-autenticado / rate limit / otro,
   * ver `isUnauthenticatedMessage`/`isRateLimitMessage` más abajo) para
   * decidir cómo reaccionar sin tumbar el timer.
   */
  list: () => Promise<PullRequestSummary[]>
  /** Empuja `prListChanged` a todas las ventanas; no-op si no hay ninguna. */
  broadcast: (event: PrListChangedEvent) => void
  /** Intervalo nominal entre ticks exitosos (ms). Default 60s. */
  intervalMs?: number
}

export interface PrWatcher {
  start(): void
  stop(): void
}

function isRateLimitMessage(message: string): boolean {
  return message.toLowerCase().includes('rate limit')
}

function isUnauthenticatedMessage(message: string): boolean {
  return message.includes('No autenticado')
}

/** Un solo `PrChange` por PR, con la prioridad cierre/merge > comentarios nuevos > cualquier otro cambio de `updatedAt`. */
function diffPr(previous: PullRequestSummary, next: PullRequestSummary): PrChange | null {
  const base = { prId: next.id, number: next.number, title: next.title, repo: next.repo }

  if (previous.state === 'open' && next.state === 'closed') {
    return { ...base, type: 'pr_closed' }
  }
  if (previous.state === 'open' && next.state === 'merged') {
    return { ...base, type: 'pr_merged' }
  }
  if (next.state === previous.state && next.commentCount > previous.commentCount) {
    return { ...base, type: 'new_comments' }
  }
  if (next.updatedAt !== previous.updatedAt) {
    return { ...base, type: 'updated' }
  }
  return null
}

/** Compara el snapshot anterior contra el nuevo y produce los `PrChange` (PRs nuevos, cerrados/mergeados, con comentarios/updates nuevos). */
function diffSnapshots(
  previous: Map<string, PullRequestSummary>,
  next: PullRequestSummary[],
): PrChange[] {
  const changes: PrChange[] = []
  for (const pr of next) {
    const prev = previous.get(pr.id)
    if (!prev) {
      changes.push({
        type: 'new_pr',
        prId: pr.id,
        number: pr.number,
        title: pr.title,
        repo: pr.repo,
      })
      continue
    }
    const change = diffPr(prev, pr)
    if (change) changes.push(change)
  }
  return changes
}

export function createPrWatcher(deps: PrWatcherDeps): PrWatcher {
  const nominalIntervalMs =
    deps.intervalMs && deps.intervalMs > 0 ? deps.intervalMs : DEFAULT_INTERVAL_MS

  let timer: ReturnType<typeof setTimeout> | null = null
  let snapshot: Map<string, PullRequestSummary> | null = null
  let currentBackoffMs = nominalIntervalMs
  let stopped = true

  function scheduleNext(delayMs: number): void {
    if (stopped) return
    timer = setTimeout(() => {
      void tick()
    }, delayMs)
  }

  async function tick(): Promise<void> {
    try {
      const prs = await deps.list()
      // Éxito: resetea cualquier backoff acumulado por rate limit previo.
      currentBackoffMs = nominalIntervalMs

      const nextSnapshot = new Map(prs.map((pr) => [pr.id, pr]))
      if (!snapshot) {
        // Primer tick exitoso: solo baseline, sin broadcast.
        snapshot = nextSnapshot
      } else {
        const changes = diffSnapshots(snapshot, prs)
        snapshot = nextSnapshot
        if (changes.length > 0) {
          deps.broadcast({ changes })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isUnauthenticatedMessage(message)) {
        // Sin sesión: skip silencioso, se reintenta al próximo tick con el
        // intervalo nominal (no es un problema transitorio de la API).
      } else if (isRateLimitMessage(message)) {
        currentBackoffMs = Math.min(currentBackoffMs * 2, MAX_BACKOFF_MS)
        console.warn('[pr-watcher] rate limit, backoff a', currentBackoffMs, 'ms')
      } else {
        console.error('[pr-watcher] error en tick, se reintenta en el próximo intervalo:', error)
      }
    } finally {
      scheduleNext(currentBackoffMs)
    }
  }

  return {
    start(): void {
      if (!stopped) return
      stopped = false
      void tick()
    },
    stop(): void {
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
