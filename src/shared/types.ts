/**
 * Modelos de dominio compartidos entre `main` y `renderer`.
 * Solo tipos (interfaces / type aliases) — sin clases, sin lógica.
 */
import type { AnalysisActivityItem, DraftDidacticSection } from './events'
import type { AiProviderCatalogEntry, AiProviderId } from './ai-providers'

export interface RepoRef {
  owner: string
  name: string
  fullName: string
}

export interface UserRef {
  login: string
  avatarUrl: string
}

export type PullRequestState = 'open' | 'closed' | 'merged'

export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required' | null

export type CiStatus = 'success' | 'failure' | 'pending' | null

/**
 * Filtro de estado para `github:listPullRequests` (T50, F10): `'open'` es el
 * default (comportamiento actual, hoy hardcodeado en `real-service.ts`);
 * `'closed'` incluye tanto cerrados como mergeados (la UI distingue con un
 * badge, ver `PrListItem.tsx`); `'all'` no filtra por estado.
 */
export type PrStateFilter = 'open' | 'closed' | 'all'

/**
 * Estado de "visto" de un PR para la sidebar (T50/T51, F10), calculado por
 * `main/github/seen-store.ts` contra el snapshot sellado la última vez que el
 * usuario abrió el PR en el detalle: `isNew` (sin entrada sellada todavía),
 * `hasUpdates` (`updatedAt` avanzó desde que se selló) y `hasNewComments`
 * (`commentCount` subió desde que se selló).
 */
export interface PrUnread {
  isNew: boolean
  hasUpdates: boolean
  hasNewComments: boolean
}

export interface PullRequestSummary {
  id: string
  number: number
  title: string
  author: UserRef
  repo: RepoRef
  state: PullRequestState
  isDraft: boolean
  createdAt: string
  updatedAt: string
  headRef: string
  baseRef: string
  /**
   * SHA del último commit del head (T39). Se usa para detectar staleness de
   * un análisis ya generado (`DidacticAnalysis.headSha` sellado al generar
   * vs. este valor ACTUAL del PR, ver T41/T42). `''` si GitHub no lo
   * devolviera (defensivo, no debería pasar en la práctica).
   */
  headSha: string
  commentCount: number
  reviewDecision: ReviewDecision
  ciStatus: CiStatus
  additions: number
  deletions: number
  changedFiles: number
  /**
   * Estado de "visto" (T50/T51, F10). OPCIONAL a propósito: lo decora SOLO el
   * handler IPC (`github:listPullRequests` en `main/ipc/handlers.ts`) contra
   * `seen-store.ts` — los servicios `GithubService` (real/mock) devuelven el
   * summary sin este campo, permanecen puros y ajenos al estado de lectura.
   */
  unread?: PrUnread
}

export interface PullRequestDetail extends PullRequestSummary {
  bodyMarkdown: string
  labels: { name: string; color: string }[]
  reviewers: UserRef[]
  commits: number
}

export type DiffFileStatus = 'added' | 'modified' | 'removed' | 'renamed'

export interface DiffFile {
  path: string
  previousPath?: string
  status: DiffFileStatus
  additions: number
  deletions: number
  /** Unified diff hunks for this file; ausente para binarios. */
  patch?: string
  isBinary: boolean
}

export interface PrComment {
  id: string
  author: UserRef
  bodyMarkdown: string
  createdAt: string
  isMinimized: boolean
  /**
   * URL permanente del comentario en github.com (`#issuecomment-…` /
   * `#discussion_r…`), para copiarla y referenciar el comentario fuera de la
   * app (p. ej. en otros agentes). Opcional: sin ella la UI simplemente no
   * ofrece el botón de copiar.
   */
  htmlUrl?: string
}

export interface CommentThread {
  id: string
  isResolved: boolean
  isLineThread: boolean
  path?: string
  line?: number
  side?: 'LEFT' | 'RIGHT'
  comments: PrComment[]
}

/**
 * Modo de acceso a GitHub (F14, v0.5.0): `oauth` es el Device Flow de siempre
 * (`main/auth/auth-manager.ts`); `gh-cli` delega la autenticación al CLI `gh`
 * ya logueado del usuario (`main/auth/gh-cli-auth.ts`) — pensado para orgs
 * enterprise que bloquean la OAuth App de Minerva (*OAuth app access
 * restrictions*) pero sí permiten GitHub CLI. En ambos modos los datos
 * siguen fluyendo por el mismo `RealGithubService` (Octokit), solo cambia de
 * dónde sale el token (ver `main/github/index.ts` y `./PLAN.md` § F14).
 *
 * F18: `gh-cli` es el ÚNICO modo con UI. `oauth` sobrevive como escape hatch
 * detrás de la env `MINERVA_GITHUB_ACCESS=oauth` (`main/settings/store.ts`,
 * `resolveGithubAccessMode`) para quien no pueda instalar `gh`; ya no hay
 * toggle en Settings ni canal IPC para cambiarlo en caliente.
 */
export type GithubAccessMode = 'oauth' | 'gh-cli'

/**
 * Una cuenta que `gh` conoce en el host de GitHub (F18): `gh` admite varias a
 * la vez y, sin `--user`, resuelve la que él considera "activa". Minerva
 * ofrece elegir cuál usar (persistida como `githubAccount`) sin tocar esa
 * elección global del CLI — ver `main/auth/gh-accounts.ts`.
 */
export interface GhAccount {
  login: string
  /** `true` en la cuenta activa del propio `gh` (la que se usaría sin `--user`). */
  active: boolean
  /** `false` cuando `gh` reporta el token de esa cuenta como inválido/expirado. */
  valid: boolean
}

/**
 * `cli_unavailable`/`cli_unauthenticated` (F14) solo aplican en modo
 * `gh-cli`: el binario `gh` no se encontró en PATH, o se encontró pero no
 * hay sesión válida (`gh auth token` falló, devolvió vacío, o el token ya no
 * sirve contra `GET /user`) — ver `main/auth/gh-cli-auth.ts`. `signed_in` se
 * reutiliza para "gh autenticado", no hace falta un estado nuevo para eso.
 */
export type AuthState =
  'signed_out' | 'device_pending' | 'signed_in' | 'cli_unavailable' | 'cli_unauthenticated'

export interface AuthStatus {
  /**
   * Modo con el que se generó este status (F14): REQUERIDO desde que existe
   * más de un modo — sin esto la UI no podría distinguir un `signed_out` de
   * OAuth (ofrece "Iniciar sesión") de uno hipotético de gh-cli (no
   * aplicable, `gh-cli` nunca reporta `signed_out`, ver `gh-cli-auth.ts`).
   */
  mode: GithubAccessMode
  state: AuthState
  user?: UserRef
  /**
   * Login que Minerva le pidió a `gh` con `--user` (F18), presente SOLO en
   * modo `gh-cli` y solo si hay una cuenta elegida a mano. Sirve para que un
   * `cli_unauthenticated` pueda decir *cuál* cuenta falló ("la cuenta elegida
   * ya no tiene sesión en gh") en vez del genérico "corré gh auth login" —
   * que sería un consejo equivocado si el usuario SÍ tiene otras cuentas
   * sanas. Nunca es el token, solo el nombre de usuario.
   */
  ghAccount?: string
  deviceCode?: {
    userCode: string
    verificationUri: string
    expiresAt: string
  }
}

/** Panel didáctico: cada sección se autodescribe con un `kind` discriminante. */

interface DidacticSectionCommon {
  markdown: string
}

export interface DidacticSnippet {
  label: string
  language: 'curl' | 'http' | 'bash' | 'env'
  code: string
}

export type DidacticSection =
  | ({ kind: 'summary' } & DidacticSectionCommon)
  | ({ kind: 'setup'; snippets: DidacticSnippet[] } & DidacticSectionCommon)
  | ({ kind: 'architecture'; mermaid: string } & DidacticSectionCommon)
  | ({ kind: 'endpoint'; snippets: DidacticSnippet[] } & DidacticSectionCommon)
  | ({ kind: 'schema'; mermaid: string } & DidacticSectionCommon)
  /**
   * A diferencia de `architecture`/`schema` (un solo `mermaid`), `cloud`
   * lleva hasta DOS diagramas Mermaid en orden de aparición: el 1º es el big
   * picture de la infra (AWS/Cloudflare/...) y el 2º un zoom a lo que toca el
   * PR. Con 0 diagramas la sección sigue siendo válida (solo markdown).
   */
  | ({ kind: 'cloud'; mermaids: string[] } & DidacticSectionCommon)

/**
 * Lo que produce un `AiService.analyzePullRequest` (T39): el contenido puro
 * del análisis, sin metadata de generación. Forma idéntica a la vieja
 * `DidacticAnalysis` (pre-T39) — el split existe para que los servicios
 * (`providers/opencode-service.ts`, `providers/claude-code-service.ts`,
 * `providers/codex-service.ts`, `mock-service.ts`) no necesiten conocer
 * `headSha`/`generatedWith`, que solo el handler (`ipc/handlers.ts`) sella
 * (T40) antes de cachear/persistir/devolver al renderer.
 */
export interface GeneratedAnalysis {
  prId: string
  sections: DidacticSection[]
  generatedAt: string
}

/**
 * Metadata de CON QUÉ se generó un análisis (T39): proveedor+modelo+opciones
 * (p. ej. `effort`) EFECTIVOS en el momento de generar, capturados por el
 * handler vía `getEffectiveAiSelection()` — NUNCA la config vigente en el
 * momento de mostrar el análisis (eso es precisamente el Issue 1 que motiva
 * F9, ver `.agents/PLAN.md`).
 */
export interface AnalysisGenerationInfo {
  provider: AiProviderId
  model: string
  options: Record<string, string>
}

/**
 * Análisis didáctico completo, CACHEADO/PERSISTIDO y devuelto al renderer
 * (T39): extiende `GeneratedAnalysis` con `headSha` (SHA del head del PR al
 * momento de generar, para detectar staleness — T41/T42) y `generatedWith`
 * (con qué proveedor/modelo/opciones se generó, para que el banner del panel
 * didáctico no mienta si el usuario cambia la config después — Issue 1 de
 * F9). SOLO el handler (`ipc/handlers.ts`) construye este objeto enriquecido
 * a partir del `GeneratedAnalysis` que produce el `AiService`; los servicios
 * NUNCA tocan `headSha`/`generatedWith` directamente.
 */
export interface DidacticAnalysis extends GeneratedAnalysis {
  headSha: string
  generatedWith: AnalysisGenerationInfo
}

/**
 * Estado de un análisis didáctico para un PR concreto (T22, canal
 * `ai:getAnalysisState`), sin dispararlo ni esperar a que termine: lo usa el
 * hook `use-didactic-analysis.ts` al MONTAR (panel acoplado o ventana
 * desacoplada) para decidir si debe quedarse en el placeholder (`idle`),
 * engancharse a un streaming ya en curso mostrando el último snapshot
 * conocido (`streaming`) o pintar directo un resultado ya pagado
 * (`cached`) — los tres casos que antes dejaban a una ventana recién
 * montada mirando el placeholder aunque el análisis ya estuviera corriendo
 * o completo. `sections` usa `DraftDidacticSection` (importado de
 * `./events.ts`, tipo-only para no crear un ciclo de imports en runtime: ese
 * archivo a su vez importa tipos de este) porque un análisis en curso puede
 * tener secciones a medio cerrar, igual que en `AnalysisProgressEvent`.
 * `activity` (F13, aditivo/opcional) es el buffer rodante del mini-log de
 * actividad del harness en ese instante — mismo tipo y semántica que
 * `AnalysisProgressEvent.activity` — para que una ventana que se engancha
 * tarde pinte "qué está pasando" de inmediato en vez de esperar al próximo
 * evento de progreso.
 */
export type AnalysisState =
  | { status: 'idle' }
  | { status: 'streaming'; sections: DraftDidacticSection[]; activity?: AnalysisActivityItem[] }
  | { status: 'cached'; analysis: DidacticAnalysis }

/**
 * Fuente de un valor de modelo resuelto (T12; generalizado a multi-proveedor
 * en T26, ver `AiSettingsInfo` más abajo): `settings` (guardado desde la UI,
 * gana siempre) > `env` (`MINERVA_AI_MODEL` del proceso o del `.env` de raíz
 * en dev) > `default` (`DEFAULT_MODEL_BY_PROVIDER` en `shared/ai-providers.ts`).
 */
export type AiModelSource = 'settings' | 'env' | 'default'

/**
 * Respuesta de `settings:get`/`settings:setAiProvider`/`settings:setProviderModel`
 * (T26, multi-proveedor). `provider`/`model` es la selección EFECTIVA (con la
 * misma precedencia settings > env > default, ver `getEffectiveAiSelection`
 * en `main/ai/env.ts`); `modelSource` indica de dónde vino `model` (mismo
 * significado que `AiModelSource`, evaluado para el `provider` resuelto);
 * `perProviderModel` es el mapa persistido completo (para que la UI, aunque
 * cambie de proveedor sin guardar, pueda recordar el último modelo elegido de
 * cada uno); `catalog` es el catálogo completo de proveedores+modelos
 * (`shared/ai-providers.ts`, con los `options` por modelo desde T34) para que
 * el renderer pinte las opciones sin un segundo roundtrip.
 *
 * `selectedOptions` (T34, F8): las opciones de modelo (p. ej. `effort`) YA
 * RESUELTAS (`main/ai/env.ts`, `getEffectiveAiSelection().options`) para el
 * proveedor+modelo ACTIVO — indexado por proveedor (mínimo: la entrada del
 * `provider` de arriba) para que T37 pinte el selector de opciones sin tener
 * que resolver nada del lado del renderer.
 *
 * `mockGithub` (T60): `true` si `MINERVA_MOCK=1` (`getAiSettingsInfo`,
 * `main/ai/env.ts`) — SOLO afecta la capa GitHub mock (universo "shopwave"),
 * nunca a la IA (ver `CLAUDE.md`), pero el renderer lo necesita para decidir
 * si mostrar la card "Necesitás al menos un CLI de IA"
 * (`NoCliProvidersCard`): con GitHub mock la demo funciona sin ningún CLI
 * instalado (vía `MockAiService`), así que la card NO debe aparecer aunque
 * los tres proveedores reales reporten `unavailable`.
 *
 * `githubAccessMode` (F14, redefinido en F18): el modo de acceso a GitHub
 * VIGENTE — ya no una preferencia persistida sino el resultado de
 * `settingsStore.getGithubAccessMode()`, que es `'gh-cli'` salvo que la env
 * `MINERVA_GITHUB_ACCESS=oauth` fuerce el escape hatch. La UI lo usa para
 * decidir si la sección "Acceso a GitHub" muestra los controles de `gh` o la
 * nota de "modo OAuth forzado por entorno".
 *
 * `githubAccount` (F18): el login de `gh` elegido a mano, o `null` para
 * "seguir la cuenta activa de gh". Solo tiene sentido en modo `gh-cli`.
 */
export interface AiSettingsInfo {
  provider: AiProviderId
  model: string
  modelSource: AiModelSource
  perProviderModel: Partial<Record<AiProviderId, string>>
  catalog: Record<AiProviderId, AiProviderCatalogEntry>
  selectedOptions?: Partial<Record<AiProviderId, Record<string, string>>>
  mockGithub: boolean
  githubAccessMode: GithubAccessMode
  githubAccount: string | null
}

/**
 * Estado de login por proveedor de IA (T27, canal `ai:getProviderStatus`;
 * los tres proveedores son `cli` desde T59 — hasta entonces OpenRouter
 * resolvía `unavailable`/`authenticated` de forma síncrona según hubiera o
 * no `OPENROUTER_API_KEY` configurada):
 * - `unavailable`: el CLI (`claude`/`codex`/`opencode`) no está usable. Desde
 *   F14.1 trae `reason` para distinguir las DOS causas que antes se
 *   mezclaban (y que la UI reportaba igual, como "no está en tu PATH" —
 *   mensaje engañoso cuando el binario SÍ estaba pero el probe falló):
 *   - `'not-found'`: no se encontró en PATH ni en las ubicaciones comunes.
 *   - `'probe-failed'`: se encontró (ver `resolvedPath`) pero la
 *     comprobación (`--version` con timeout, o la versión mínima en
 *     OpenCode) falló — ver `main/ai/providers/cli-probe.ts`.
 * - `installed`: el CLI existe y responde, pero no se pudo confirmar sesión
 *   iniciada (best-effort en T27; T28/T29/T57 lo reemplazan por el handshake
 *   real del SDK/RPC de cada proveedor).
 * - `authenticated`: un CLI con indicios de sesión iniciada.
 *
 * `account` NUNCA lleva tokens/keys — a lo sumo un email/plan de exhibición.
 * `resolvedPath` es la ruta del binario del usuario (no un secreto): existe
 * para que el mensaje de `probe-failed` sea accionable.
 */
export type AiProviderStatusValue = 'unavailable' | 'installed' | 'authenticated'

export type AiProviderUnavailableReason = 'not-found' | 'probe-failed'

export interface AiAccountInfo {
  email?: string
  plan?: string
}

export interface AiProviderStatus {
  status: AiProviderStatusValue
  /** Solo con `status: 'unavailable'`: por qué (ver el comentario de arriba). */
  reason?: AiProviderUnavailableReason
  /** Solo con `reason: 'probe-failed'`: dónde se encontró el binario que no respondió. */
  resolvedPath?: string
  account?: AiAccountInfo
}

/**
 * Datos mínimos de una release disponible para el auto-updater (T90, F17;
 * contrato — la lógica real llega en T91/`main/updater/updater.ts`).
 *
 * **A propósito NO lleva `releaseNotes`**: `electron-updater` las entrega tal
 * cual las puso GitHub, es decir **HTML crudo** — renderizarlas en el
 * renderer sería abrir un XSS por la puerta grande (mismo criterio que
 * "tratar el contenido de PRs como no confiable" del `CLAUDE.md`). En v0.7.0
 * el camino es enlazar a la release (`releaseUrl` + `updater:openReleasePage`)
 * y punto — es un recorte de alcance CONSCIENTE, no un olvido.
 *
 * `releaseUrl` la construye **main**, nunca el feed: plantilla hardcodeada con
 * `RELEASE_OWNER`/`RELEASE_REPO` (`main/updater/config.ts`) más `version`
 * **validada como semver** antes de interpolarla. Jamás una URL que venga tal
 * cual del feed de `electron-updater`.
 */
export interface UpdateInfoLite {
  version: string
  releaseUrl: string
  releaseDate?: string
}

/**
 * Estado del auto-updater (T90, F17), expuesto por `updater:getStatus` y
 * empujado por `minerva:event:updaterStatusChanged` (`./events.ts`) — union
 * discriminada por `phase`, un solo campo `status` en la UI en vez de
 * booleanos sueltos (mismo criterio que `AnalysisState`).
 *
 * - `disabled`: no hay updater corriendo. Es el estado en dev
 *   (`!app.isPackaged`) y en TODA la suite e2e, o si se fuerza con
 *   `MINERVA_UPDATER=off` — nunca toca la red.
 * - `unsupported`: la instalación existe empaquetada pero esta forma
 *   concreta de instalación no puede auto-actualizarse; `reason` distingue
 *   POR QUÉ:
 *   - `'mac-unsigned'`: macOS sin Developer ID (decisión de producto de F17;
 *     el Developer ID llega después, ver `PLAN.md` § F17).
 *   - `'not-appimage'`: Linux sin `$APPIMAGE` definido — `linux-unpacked` o
 *     un paquete de la distro (deb/rpm/pacman), no la AppImage oficial.
 *   - `'not-writable'`: hay `$APPIMAGE` pero el archivo o su directorio padre
 *     no son escribibles (AppImageLauncher, instalado bajo `/opt`, o
 *     corriendo como root).
 *   `available` es OPCIONAL: en `unsupported` SÍ se consulta el feed y se
 *   compara semver contra la versión instalada (para poder ofrecer "ver la
 *   release" si hay una más nueva), pero nunca se descarga ni se instala nada
 *   — la sola presencia de este campo no habilita el botón de descarga.
 * - `idle`: soportado, sin update pendiente. `lastCheckedAt` (ISO) es
 *   opcional: ausente antes del primer chequeo de esta sesión.
 * - `checking`: hay un chequeo contra el feed en curso (arranque, intervalo
 *   de 6h, o botón manual).
 * - `available`: el feed ofrece una versión más nueva que la instalada,
 *   todavía sin descargar (`autoDownload: false` — la descarga requiere
 *   consentimiento explícito del usuario, son ~130 MB).
 * - `downloading`: descarga en curso tras ese consentimiento; `percent` es
 *   0-100.
 * - `downloaded`: **descargada, se instala AL SALIR de la app**
 *   (`autoInstallOnAppQuit: true`) — esto NO significa "ya instalada". Existe
 *   una acción secundaria (`updater:quitAndInstall`) para reiniciar ya mismo,
 *   pero el camino principal es seguir usando Minerva y que se instale sola
 *   al cerrar.
 * - `error`: el último chequeo/descarga falló; `message` es texto de
 *   exhibición (sin stack interno de main, misma frontera que el resto de
 *   IPC) y `lastCheckedAt` conserva el momento del último chequeo exitoso
 *   previo, si lo hubo.
 */
export type UpdaterStatus =
  | { phase: 'disabled' }
  | {
      phase: 'unsupported'
      reason: 'mac-unsigned' | 'not-appimage' | 'not-writable'
      available?: UpdateInfoLite
    }
  | { phase: 'idle'; lastCheckedAt?: string }
  | { phase: 'checking' }
  | { phase: 'available'; info: UpdateInfoLite }
  | { phase: 'downloading'; info: UpdateInfoLite; percent: number }
  | { phase: 'downloaded'; info: UpdateInfoLite }
  | { phase: 'error'; message: string; lastCheckedAt?: string }
