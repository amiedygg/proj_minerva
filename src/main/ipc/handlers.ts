import { BrowserWindow } from 'electron'
import { handle } from './register'
import { createGithubService } from '../github'
import { createPrWatcher, type PrWatcher } from '../github/pr-watcher'
import { seenStore } from '../github/seen-store'
import { createAiService } from '../ai'
import { getAiSettingsInfo, getEffectiveAiSelection } from '../ai/env'
import { getAiProviderStatusMap } from '../ai/providers/provider-status'
import { getProviderModels } from '../ai/providers/provider-models'
import { analysisCache } from '../ai/analysis-cache'
import { settingsStore } from '../settings/store'
import { authManager } from '../auth/auth-manager'
import { openDidacticWindow } from '../windows/didactic-window'
import {
  MINERVA_EVENTS,
  type AnalysisProgressEvent,
  type DraftDidacticSection,
  type PrListChangedEvent,
} from '../../shared/events'
import type { IpcResponse } from '../../shared/ipc'
import type { DidacticAnalysis, RepoRef } from '../../shared/types'

/**
 * Clave del registro de análisis EN CURSO (T22): mismo criterio
 * (`owner/name#number`) que `../ai/analysis-cache.ts` y `../ai/mock-service.ts`,
 * repetido acá en vez de importado porque `AnalysisCache` no expone su
 * formato de clave (encapsulado a propósito, no hace falta acoplar los dos).
 */
function prKey(repo: RepoRef, number: number): string {
  return repo.owner + '/' + repo.name + '#' + number
}

/** Empuja un snapshot de progreso a TODAS las ventanas abiertas (T13); el filtro por PR es cosa del hook del renderer, no de acá. */
function broadcastProgress(payload: AnalysisProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(MINERVA_EVENTS.analysisProgress, payload)
    }
  }
}

/** Empuja los cambios detectados por el watcher de PRs (T51, F10) a TODAS las ventanas abiertas; mismo patrón que `broadcastProgress`. */
function broadcastPrListChanged(payload: PrListChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(MINERVA_EVENTS.prListChanged, payload)
    }
  }
}

/**
 * Intervalo del watcher de PRs (T51, F10): `MINERVA_WATCH_INTERVAL_MS` lo
 * overridea (los smokes e2e lo usan para no esperar 60s reales), `undefined`
 * deja que `createPrWatcher` aplique su propio default. Solo se acepta un
 * override si parsea a un entero positivo; cualquier otra cosa se ignora en
 * vez de tumbar el arranque de la app.
 */
function resolveWatchIntervalMs(): number | undefined {
  const raw = process.env.MINERVA_WATCH_INTERVAL_MS
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Registra los handlers IPC disponibles hoy. Los canales `github:*`/`ai:*`
 * delegan a una única instancia de `GithubService`/`AiService` (real con
 * Octokit desde T6 salvo `MINERVA_MOCK=1`; `AiService` real con el proveedor
 * de IA activo — Claude Code/Codex/OpenCode, ver `../ai/index.ts`).
 * `createAiService` recibe `githubService` (la misma instancia usada por los
 * canales `github:*`) para que el pipeline de IA pida el detalle/archivos del
 * PR a lo que sea que esté activo, mock o real. Los canales `auth:*` delegan
 * al `AuthManager` singleton (`../auth/auth-manager.ts`) — quien llama a
 * `registerIpcHandlers` debe haber esperado `authManager.init()` antes, para
 * que `auth:getStatus` refleje el token persistido (si lo hay) desde la
 * primera llamada. `settings:get` (T12, reestructurado en T26 a
 * multi-proveedor) expone la selección efectiva de proveedor+modelo más el
 * catálogo completo (`getAiSettingsInfo`, `../ai/env.ts`);
 * `settings:setAiProvider` y `settings:setProviderModel` persisten la
 * elección (`settingsStore`, `../settings/store.ts`) y devuelven la misma
 * forma agregada. No delegan a una instancia de servicio porque no hay
 * estado por-request que mantener.
 *
 * ASYNC desde T28: `createAiService` puede necesitar consultar el probe de
 * login de un proveedor `cli` (`../ai/providers/cli-probe.ts`, spawnea
 * `claude --version` con timeout corto) antes de decidir qué `AiService`
 * instanciar — quien llama debe `await`earlo, igual que ya hacía con
 * `authManager.init()` (ver `../index.ts`).
 *
 * Devuelve `{ stopPrWatcher }` (T51, F10) para que `../index.ts` pueda parar
 * el watcher de PRs en `app.on('before-quit')` — sin esto el timer seguiría
 * re-armándose después de que las ventanas ya se destruyeron.
 */
export async function registerIpcHandlers(): Promise<{ stopPrWatcher: () => void }> {
  handle('minerva:ping', () => 'pong from main @ electron ' + process.versions.electron)

  handle('auth:getStatus', () => authManager.getStatus())
  handle('auth:startDeviceFlow', () => authManager.startDeviceFlow())
  handle('auth:signOut', () => authManager.signOut())

  const githubService = createGithubService()
  // `unread` (T51, F10) se decora ACÁ, en el handler — no en el servicio: los
  // `GithubService` (real/mock) quedan puros y ajenos al estado de lectura,
  // que vive en `seenStore` (`../github/seen-store.ts`). Spread inmutable
  // (no se muta el summary que devuelve el servicio).
  handle('github:listPullRequests', async (req) => {
    const summaries = await githubService.listPullRequests(req)
    return summaries.map((pr) => ({ ...pr, unread: seenStore.computeUnread(pr) }))
  })
  handle('github:markPrSeen', (req) => {
    seenStore.markSeen(req.prId, { updatedAt: req.updatedAt, commentCount: req.commentCount })
    return { ok: true as const }
  })
  handle('github:getPullRequestDetail', (req) => githubService.getPullRequestDetail(req))
  handle('github:getPullRequestFiles', (req) => githubService.getPullRequestFiles(req))
  handle('github:getCommentThreads', (req) => githubService.getCommentThreads(req))
  handle('github:postComment', (req) => githubService.postComment(req))

  // Watcher de PRs en background (T51, F10, `../github/pr-watcher.ts`): pide
  // `listPullRequests({ state: 'all' })` a la MISMA instancia de
  // `githubService` a intervalos regulares y empuja `prListChanged` cuando
  // detecta cambios. Los summaries que diffea el watcher NO pasan por la
  // decoración de `unread` de arriba (no la necesitan, solo comparan
  // estado/updatedAt/commentCount entre dos snapshots). `start()` de
  // inmediato; `stop()` la llama `../index.ts` en `before-quit`.
  const prWatcher: PrWatcher = createPrWatcher({
    list: () => githubService.listPullRequests({ state: 'all' }),
    broadcast: broadcastPrListChanged,
    intervalMs: resolveWatchIntervalMs(),
  })
  prWatcher.start()

  /**
   * Registro de análisis EN CURSO por PR (T22). Sin esto, dos solicitudes
   * simultáneas del mismo PR —un re-click de "Analizar PR" mientras el
   * primero sigue en vuelo, o una ventana desacoplada abierta a mitad de un
   * streaming— disparaban una SEGUNDA llamada al LLM cada una: el cache de
   * abajo (`analysisCache`) solo ve análisis ya COMPLETOS, nunca uno a medio
   * hacer. Vive local a esta función (no a nivel de módulo) porque
   * conceptualmente es estado del registro de handlers, igual que
   * `githubService` de arriba.
   */
  const inFlightAnalyses = new Map<
    string,
    { promise: Promise<IpcResponse<'ai:analyzePullRequest'>>; snapshot: DraftDidacticSection[] }
  >()

  handle('ai:analyzePullRequest', (req) => {
    // Cache hit: como hoy, sin tocar el registro in-flight (ya está
    // completo, no hay nada en vuelo que registrar).
    const cached = analysisCache.get(req.repo, req.number)
    if (cached) return Promise.resolve(cached)

    const key = prKey(req.repo, req.number)

    // In-flight hit: devolver LA MISMA promesa. Cero llamadas al AiService
    // adicionales — así una ventana desacoplada abierta a mitad de un
    // streaming, o un doble-click de "Analizar PR", no pagan el LLM dos veces.
    const existing = inFlightAnalyses.get(key)
    if (existing) return existing.promise

    // `snapshotBox` se declara ANTES de arrancar el análisis: el mock
    // (`../ai/mock-service.ts`) llama a `onProgress` de forma SÍNCRONA en su
    // primer chunk, y esa llamada puede ocurrir mientras la promesa de abajo
    // todavía se está construyendo (antes de que `entry` termine de
    // registrarse en el Map) — mutar un objeto que ya existe evita cualquier
    // orden de inicialización delicado.
    const snapshotBox: { current: DraftDidacticSection[] } = { current: [] }

    const promise = (async (): Promise<IpcResponse<'ai:analyzePullRequest'>> => {
      try {
        // Se resuelve el AiService POR ANÁLISIS, no una sola vez al arrancar:
        // desde T27 el PROVEEDOR activo (OpenRouter/Claude Code/Codex, ver
        // `../ai/index.ts`) sale de Settings y puede cambiar en runtime, así
        // que capturarlo en el closure del registro dejaría al panel usando el
        // proveedor viejo hasta reiniciar. Solo se llega acá en un análisis
        // NUEVO (los cache/in-flight hits retornan antes), y `createAiService`
        // consulta el probe de login ya cacheado (TTL corto), así que el costo
        // por llamada es mínimo.
        // El sello `generatedWith` se captura ACÁ, al arrancar, no al terminar
        // (T65, F12): los servicios leen la selección efectiva UNA vez al
        // inicio de su `analyzePullRequest` (opencode-service.ts:215,
        // claude-code-service.ts:182, codex-service.ts:170), así que un cambio
        // de Settings a mitad de un análisis (30-60s con proveedores
        // agénticos) no afecta la generación en vuelo — pero sellar con
        // `getEffectiveAiSelection()` DESPUÉS del await hacía mentir a la
        // metadata: un análisis generado por opencode/big-pickle quedaba
        // cacheado/persistido como si lo hubiera hecho la config nueva
        // (verificado empíricamente en F12; es la variante DURANTE del mismo
        // problema que T41 arregló para cambios POSTERIORES al análisis).
        // Queda una ventana teórica de milisegundos entre esta captura y la
        // lectura interna del servicio — irrelevante frente a la de 30-60s.
        const selectionAtStart = getEffectiveAiSelection()
        const aiService = await createAiService(githubService)
        const generated = await aiService.analyzePullRequest(req, {
          onProgress: (sections, meta) => {
            snapshotBox.current = sections
            // El `{ done: true }` que emite el servicio en éxito se SUPRIME
            // acá: se re-emite manualmente más abajo, DESPUÉS de poblar
            // `analysisCache`, para garantizar que quien reciba `done: true`
            // sin `error` ya encuentre el cache poblado (T22 — una ventana
            // enganchada al streaming no debe ver nunca un "terminó" que
            // todavía no se puede leer de `ai:getCachedAnalysis`).
            if (meta.done) return
            // `meta.phase` (T60): "exploring"/"writing" para proveedores
            // agénticos, `undefined` para el mock — se propaga tal cual, sin
            // interpretarlo acá.
            broadcastProgress({
              repo: req.repo,
              number: req.number,
              sections,
              done: false,
              phase: meta.phase,
            })
          },
        })

        // Sellado (T39/T40): el `AiService` produce `GeneratedAnalysis` (sin
        // `headSha`/`generatedWith`, ver `../ai/service.ts`); acá se enriquece
        // a `DidacticAnalysis` completo antes de cachear/persistir/devolver.
        // `generatedWith` usa `selectionAtStart` (capturada ANTES de crear el
        // servicio, ver arriba) — la selección REAL con la que se generó,
        // aunque Settings haya cambiado durante el análisis (T65).
        // `headSha` (T40) sale de un fetch aparte, barato pero con I/O, del
        // detalle del PR — envuelto en su PROPIO try/catch: si fallara (red,
        // rate limit, etc.) NO debe tumbar un análisis ya generado, se cae a
        // `''` como en el sellado-puente de T39.
        let headSha = ''
        try {
          const detail = await githubService.getPullRequestDetail(req)
          headSha = detail.headSha
        } catch {
          headSha = ''
        }

        const result: DidacticAnalysis = {
          ...generated,
          headSha,
          generatedWith: selectionAtStart,
        }

        analysisCache.set(req.repo, req.number, result)
        broadcastProgress({
          repo: req.repo,
          number: req.number,
          sections: snapshotBox.current,
          done: true,
        })
        return result
      } catch (error) {
        // Los `AiService` reales/mock NUNCA llaman a `onProgress` en el
        // camino de error (solo lanzan) — sin este evento terminal manual,
        // una ventana enganchada a este streaming se quedaría mostrando
        // "analizando…" para siempre ante un fallo.
        broadcastProgress({
          repo: req.repo,
          number: req.number,
          sections: snapshotBox.current,
          done: true,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        inFlightAnalyses.delete(key)
      }
    })()

    // `snapshot` es un getter sobre `snapshotBox.current`, no una copia: así
    // `ai:getAnalysisState` (abajo) siempre lee el último valor, aunque haya
    // llegado después de que esta entrada se registrara en el Map.
    inFlightAnalyses.set(key, {
      promise,
      get snapshot() {
        return snapshotBox.current
      },
    })

    return promise
  })

  /**
   * Estado actual de un análisis sin dispararlo ni pedir el resultado
   * completo (T22): lo consulta el hook del renderer al montar para decidir
   * entre quedarse en el placeholder (`idle`), engancharse a un streaming ya
   * en curso mostrando el último snapshot conocido (`streaming`) o pintar
   * directo un resultado ya pagado (`cached`).
   */
  handle('ai:getAnalysisState', (req) => {
    const cached = analysisCache.get(req.repo, req.number)
    if (cached) return { status: 'cached' as const, analysis: cached }

    const inFlight = inFlightAnalyses.get(prKey(req.repo, req.number))
    if (inFlight) return { status: 'streaming' as const, sections: inFlight.snapshot }

    return { status: 'idle' as const }
  })

  // Lectura pura del cache (T14): la usa la ventana desacoplada para pintar
  // un análisis ya pagado al montar, sin pasar por `ai:analyzePullRequest`
  // (que además de leer el cache sabe cómo generar uno nuevo si hace falta,
  // responsabilidad que este canal no necesita).
  handle('ai:getCachedAnalysis', (req) => analysisCache.get(req.repo, req.number))
  handle('ai:invalidateAnalysis', (req) => {
    analysisCache.invalidate(req.repo, req.number)
  })

  // Estado de login por proveedor (T27, `../ai/providers/provider-status.ts`):
  // los tres proveedores son `cli` — se resuelven vía un probe cacheado con
  // TTL corto, nunca bloqueante.
  handle('ai:getProviderStatus', () => getAiProviderStatusMap())

  // Modelos disponibles por proveedor (T35, F8): estático para Claude Code,
  // dinámicos (con cache TTL + fallback al curado) para Codex/OpenCode — ver
  // `../ai/providers/provider-models.ts`. Canal SEPARADO de `settings:get`
  // (síncrono): esto puede tardar/fallar por spawnear un proceso externo.
  handle('ai:getProviderModels', (req) => getProviderModels(req.provider))

  handle('settings:get', () => getAiSettingsInfo())
  handle('settings:setAiProvider', (req) => {
    settingsStore.setAiProvider(req.provider)
    return getAiSettingsInfo()
  })
  handle('settings:setProviderModel', (req) => {
    settingsStore.setProviderModel(req.provider, req.model)
    return getAiSettingsInfo()
  })
  // Opción de modelo (T34, F8 — p. ej. `effort`): persiste el valor elegido
  // para `provider`/`optionId` (`settingsStore.setModelOption`) y responde el
  // `AiSettingsInfo` actualizado, mismo patrón que los dos handlers de arriba.
  handle('settings:setModelOption', (req) => {
    settingsStore.setModelOption(req.provider, req.optionId, req.value)
    return getAiSettingsInfo()
  })

  // Ventana didáctica desacoplada (T14, `../windows/didactic-window.ts`): una
  // sola instancia a la vez, mismo preload/webPreferences que la principal.
  handle('window:openDidactic', (req) => {
    openDidacticWindow(req.repo, req.number, req.title)
  })

  return { stopPrWatcher: () => prWatcher.stop() }
}
