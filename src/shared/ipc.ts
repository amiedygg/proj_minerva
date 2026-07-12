/**
 * Contrato IPC: única fuente de verdad para los canales `main` <-> `renderer`.
 *
 * Cada entrada de `IpcContract` define la forma de request/response de un canal.
 * `preload` deriva `MinervaApi` de aquí (sin repetir tipos a mano) y `main/ipc`
 * valida en runtime contra `IPC_CHANNELS`.
 */

import type {
  AiProviderStatus,
  AiSettingsInfo,
  AnalysisState,
  AuthStatus,
  CommentThread,
  DidacticAnalysis,
  DiffFile,
  OpenRouterKeyStatus,
  PrComment,
  PrStateFilter,
  PullRequestDetail,
  PullRequestSummary,
  RepoRef,
} from './types'
import type { AiModelOption, AiProviderId } from './ai-providers'
import type { AnalysisProgressEvent, PrListChangedEvent } from './events'

export interface IpcContract {
  'minerva:ping': { req: void; res: string }

  'auth:getStatus': { req: void; res: AuthStatus }
  'auth:startDeviceFlow': { req: void; res: AuthStatus }
  'auth:signOut': { req: void; res: AuthStatus }

  /**
   * `state` (T50, F10): filtro de estado (`PrStateFilter`, `./types.ts`),
   * opcional — default `'open'` (comportamiento previo). La respuesta trae
   * cada summary decorado con `unread` (`main/ipc/handlers.ts` contra
   * `seen-store.ts`); los servicios `GithubService` no conocen ese campo.
   */
  'github:listPullRequests': {
    req: { search?: string; state?: PrStateFilter }
    res: PullRequestSummary[]
  }
  /**
   * Sella el estado "visto" de un PR (T50/T51, F10) contra
   * `main/github/seen-store.ts`: se llama al abrir el PR en el detalle, con
   * el `updatedAt`/`commentCount` ACTUALES del summary (no valores futuros) —
   * si luego el PR cambia, `computeUnread` vuelve a marcarlo no visto.
   */
  'github:markPrSeen': {
    req: { prId: string; updatedAt: string; commentCount: number }
    res: { ok: true }
  }
  'github:getPullRequestDetail': {
    req: { repo: RepoRef; number: number }
    res: PullRequestDetail
  }
  'github:getPullRequestFiles': { req: { repo: RepoRef; number: number }; res: DiffFile[] }
  'github:getCommentThreads': { req: { repo: RepoRef; number: number }; res: CommentThread[] }
  'github:postComment': {
    req: {
      repo: RepoRef
      number: number
      bodyMarkdown: string
      threadId?: string
      path?: string
      line?: number
      /** Lado del diff al que pertenece `line`; solo aplica a hilos nuevos por línea. */
      side?: 'LEFT' | 'RIGHT'
    }
    res: PrComment
  }

  'ai:analyzePullRequest': { req: { repo: RepoRef; number: number }; res: DidacticAnalysis }
  /**
   * Lectura pura del cache de análisis en main (T14, `../main/ai/analysis-cache.ts`):
   * a diferencia de `ai:analyzePullRequest`, NUNCA dispara un análisis nuevo ni
   * llama al `AiService` — solo devuelve lo que ya haya cacheado, o `null` si no
   * hay nada. La usa la ventana didáctica desacoplada para mostrar un análisis
   * ya pagado sin volver a pedirlo.
   */
  'ai:getCachedAnalysis': { req: { repo: RepoRef; number: number }; res: DidacticAnalysis | null }
  /**
   * Descarta la entrada de cache de ese PR (si había). No relanza el análisis
   * por sí sola: el botón "Re-analizar" la llama y, a continuación, invoca
   * `ai:analyzePullRequest` normalmente (que al no encontrar cache, sí llama
   * al `AiService`).
   */
  'ai:invalidateAnalysis': { req: { repo: RepoRef; number: number }; res: void }
  /**
   * Estado actual de un análisis para un PR, sin dispararlo ni esperar el
   * resultado completo (T22, `AnalysisState` en `./types.ts`): `cached` si
   * `analysisCache` ya lo tiene, `streaming` con el último snapshot conocido
   * si hay un análisis EN CURSO para ese PR (registro in-flight de
   * `../main/ipc/handlers.ts`), `idle` si no hay ni una cosa ni la otra. Lo
   * consulta el hook del renderer al montar (panel acoplado o ventana
   * desacoplada) para engancharse a un streaming ya empezado en vez de
   * mostrar el placeholder hasta que alguien pulse "Analizar PR".
   */
  'ai:getAnalysisState': { req: { repo: RepoRef; number: number }; res: AnalysisState }

  /**
   * Estado de login por proveedor de IA (T27), sin disparar ningún análisis:
   * un `Record` con los TRES proveedores del catálogo (`../shared/ai-providers.ts`),
   * cada uno con su `AiProviderStatus` (`./types.ts`). OpenRouter se resuelve
   * de forma síncrona (¿hay `OPENROUTER_API_KEY`?, `main/ai/env.ts`); Claude
   * Code/Codex vía un probe de CLI con timeout corto y cache TTL, NUNCA
   * bloqueante (`main/ai/providers/cli-probe.ts`) — ver
   * `main/ai/providers/provider-status.ts` para el agregado. Nunca incluye
   * tokens/keys, a lo sumo `account.email`/`account.plan` de exhibición.
   */
  'ai:getProviderStatus': { req: void; res: Record<AiProviderId, AiProviderStatus> }

  /**
   * Modelos disponibles para `provider` (T35, F8): estáticos (catálogo
   * curado, T26/T34) para OpenRouter/Claude Code; DINÁMICOS vía la RPC
   * `model/list` de `codex app-server` para Codex, con fallback al curado y
   * cache TTL en main si el CLI falla/no hay sesión (ver
   * `../main/ai/providers/provider-models.ts`). A propósito es un canal
   * SEPARADO de `settings:get` (síncrono, T26): resolver los modelos de
   * Codex puede tardar (o fallar) por spawnear un proceso externo, y eso NO
   * debe bloquear ni romper la carga del resto de Settings.
   */
  'ai:getProviderModels': { req: { provider: AiProviderId }; res: readonly AiModelOption[] }

  /**
   * Selección efectiva de proveedor+modelo (T26) más el catálogo completo de
   * proveedores/modelos, para que la UI pinte las opciones sin un roundtrip
   * adicional. Ver `AiSettingsInfo` (`./types.ts`) y `getAiSettingsInfo`
   * (`../main/ai/env.ts`).
   */
  'settings:get': { req: void; res: AiSettingsInfo }
  /** Compat (pre-T26): persiste el modelo para OpenRouter sin tocar el proveedor activo. */
  'settings:setAiModel': { req: { aiModel: string }; res: AiSettingsInfo }
  /** Cambia el proveedor ACTIVO (T26); no toca los modelos ya elegidos por cada proveedor. */
  'settings:setAiProvider': { req: { provider: AiProviderId }; res: AiSettingsInfo }
  /** Persiste el modelo elegido para `provider` (T26), sea o no el proveedor activo. */
  'settings:setProviderModel': {
    req: { provider: AiProviderId; model: string }
    res: AiSettingsInfo
  }
  /**
   * Persiste el valor elegido para una opción de modelo (T34, F8 — p. ej.
   * `{ provider: 'codex', optionId: 'effort', value: 'high' }`) de
   * `provider`, sea o no el proveedor activo. No valida `value` contra las
   * choices del descriptor: esa validación "robusta" ocurre en la LECTURA
   * (`getEffectiveAiSelection`, `main/ai/env.ts`) para que cambiar de modelo
   * después no deje un valor huérfano bloqueado. Responde el
   * `AiSettingsInfo` actualizado (mismo patrón que `setAiProvider`/
   * `setProviderModel`) para que la UI (T37) refresque sin un roundtrip
   * adicional.
   */
  'settings:setModelOption': {
    req: { provider: AiProviderId; optionId: string; value: string }
    res: AiSettingsInfo
  }
  /**
   * Guarda o borra la key de OpenRouter persistida con `safeStorage` (T32,
   * `../main/ai/openrouter-key-store.ts`): `key` no vacía (tras `trim()`) se
   * cifra y persiste (`saveApiKey`); `key` vacía o solo espacios borra lo
   * persistido (`clearApiKey`) — el mismo canal sirve para las dos acciones,
   * así la UI de Settings (T30) no necesita un canal aparte para "borrar".
   * Responde el status actualizado (`getOpenRouterKeyStatus`, mismo tipo que
   * `settings:getOpenRouterKeyStatus`) para que la UI refresque sin un
   * roundtrip adicional. La key NUNCA viaja de vuelta al renderer.
   */
  'settings:setOpenRouterKey': { req: { key: string }; res: OpenRouterKeyStatus }
  /**
   * Estado de configuración de la key de OpenRouter (T32): `configured` +
   * `source` (`'safeStorage' | 'env' | 'none'`, ver `OpenRouterKeyStatus` en
   * `./types.ts`), NUNCA la key en claro. Lo consume la card de OpenRouter en
   * Settings (T30) para pintar "Configurada (safeStorage) / Tomada de .env /
   * No configurada".
   */
  'settings:getOpenRouterKeyStatus': { req: void; res: OpenRouterKeyStatus }

  /**
   * Abre (o enfoca, si ya hay una) la ventana didáctica desacoplada (T14,
   * `../main/windows/didactic-window.ts`) sincronizada con `repo`/`number`.
   * Solo existe UNA ventana didáctica a la vez: pedir este canal con un PR
   * distinto mientras ya hay una abierta la navega a ese PR nuevo en vez de
   * abrir una segunda ventana. `title` es el título humano del PR (lo trae
   * quien ya lo tiene a mano, `selectedPr.title`): viaja en el hash de la URL
   * que carga la ventana para que el header se pinte al instante, sin
   * depender de que la ventana pida `github:getPullRequestDetail` primero.
   */
  'window:openDidactic': { req: { repo: RepoRef; number: number; title: string }; res: void }
}

export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['req']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['res']

/**
 * Lista de canales en runtime, para poder iterar/validar (p. ej. en el registro de
 * handlers de main). El tipado de abajo obliga a que esta lista sea exhaustiva
 * respecto a `IpcChannel`: si `IpcContract` gana o pierde un canal y esta lista no
 * se actualiza, `_assertChannelsCoverContract` deja de tipar.
 */
export const IPC_CHANNELS = [
  'minerva:ping',
  'auth:getStatus',
  'auth:startDeviceFlow',
  'auth:signOut',
  'github:listPullRequests',
  'github:markPrSeen',
  'github:getPullRequestDetail',
  'github:getPullRequestFiles',
  'github:getCommentThreads',
  'github:postComment',
  'ai:analyzePullRequest',
  'ai:getCachedAnalysis',
  'ai:invalidateAnalysis',
  'ai:getAnalysisState',
  'ai:getProviderStatus',
  'ai:getProviderModels',
  'settings:get',
  'settings:setAiModel',
  'settings:setAiProvider',
  'settings:setProviderModel',
  'settings:setModelOption',
  'settings:setOpenRouterKey',
  'settings:getOpenRouterKeyStatus',
  'window:openDidactic',
] as const satisfies readonly IpcChannel[]

type AssertNoMissingChannel = [IpcChannel] extends [(typeof IPC_CHANNELS)[number]] ? true : never
const _assertChannelsCoverContract: AssertNoMissingChannel = true
void _assertChannelsCoverContract

/**
 * API tipada expuesta en `window.minerva`, agrupada por namespace.
 * Se deriva de `IpcContract`: el prefijo antes de `:` en el nombre del canal es el
 * namespace (con el alias `minerva` -> `system`), y el sufijo es el nombre del método.
 */
type NamespaceAliasMap = { minerva: 'system' }

type ChannelAction<C extends IpcChannel> = C extends `${string}:${infer Action}` ? Action : never

// `C` debe quedar "naked" en el `extends` para que el condicional distribuya
// miembro a miembro sobre la unión `IpcChannel` (si se envolviera en otro alias
// antes de compararlo, TS lo trataría como un solo tipo y no por canal).
type ApiNamespace<C extends IpcChannel> = C extends `${infer NS}:${string}`
  ? NS extends keyof NamespaceAliasMap
    ? NamespaceAliasMap[NS]
    : NS
  : never

type InvokeApi = {
  [NS in ApiNamespace<IpcChannel>]: {
    [C in IpcChannel as ApiNamespace<C> extends NS ? ChannelAction<C> : never]: (
      req: IpcRequest<C>,
    ) => Promise<IpcResponse<C>>
  }
}

/**
 * `events` NO se deriva de `IpcContract` (esos son canales invoke/response
 * uno-a-uno; los eventos push de `../shared/events.ts` tienen otra forma:
 * `main` los empuja por su cuenta, sin que el renderer los pida). Un método
 * concreto por evento (nunca un `on(channel, cb)` genérico, ver el
 * comentario de cabecera de `events.ts` y `src/preload/index.ts`), que
 * devuelve la función de desuscripción.
 */
interface EventsApi {
  onAnalysisProgress(callback: (payload: AnalysisProgressEvent) => void): () => void
  /**
   * Suscripción al watcher de PRs (T50/T51, F10): se dispara con los cambios
   * detectados contra el snapshot anterior (`main/github/pr-watcher.ts`) —
   * nunca en el primer tick (baseline silencioso). Mismo patrón que
   * `onAnalysisProgress`: método concreto, no un `on(channel, cb)` genérico.
   */
  onPrListChanged(callback: (payload: PrListChangedEvent) => void): () => void
}

export type MinervaApi = InvokeApi & { events: EventsApi }
