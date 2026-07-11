/**
 * Modelos de dominio compartidos entre `main` y `renderer`.
 * Solo tipos (interfaces / type aliases) — sin clases, sin lógica.
 */
import type { DraftDidacticSection } from './events'
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

export type AuthState = 'signed_out' | 'device_pending' | 'signed_in'

export interface AuthStatus {
  state: AuthState
  user?: UserRef
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
 * Lo que produce un `AiService.analyzePullRequest` (T39): el contenido puro
 * del análisis, sin metadata de generación. Forma idéntica a la vieja
 * `DidacticAnalysis` (pre-T39) — el split existe para que los servicios
 * (`openrouter-service.ts`, `providers/claude-code-service.ts`,
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
 */
export type AnalysisState =
  | { status: 'idle' }
  | { status: 'streaming'; sections: DraftDidacticSection[] }
  | { status: 'cached'; analysis: DidacticAnalysis }

/**
 * Settings persistentes (T12). `aiModelSource` indica de dónde vino el valor
 * `aiModel` actual, con esta precedencia (ver `main/ai/env.ts`,
 * `getEffectiveAiModel`): `settings` (guardado desde la UI, gana siempre) >
 * `env` (`MINERVA_AI_MODEL` del proceso o del `.env` de raíz en dev) >
 * `default` (`DEFAULT_AI_MODEL` en `shared/ai-models.ts`).
 */
export type AiModelSource = 'settings' | 'env' | 'default'

export interface EffectiveAiModelInfo {
  aiModel: string
  aiModelSource: AiModelSource
}

/**
 * Respuesta de `settings:get`/`settings:setAiProvider`/`settings:setProviderModel`
 * desde T26 (multi-proveedor): reemplaza a `EffectiveAiModelInfo` como tipo de
 * respuesta IPC (ese tipo se conserva como shim interno de `main/ai/env.ts`,
 * `getEffectiveAiModel`, asumiendo OpenRouter). `provider`/`model` es la
 * selección EFECTIVA (con la misma precedencia settings > env > default que
 * antes, ver `getEffectiveAiSelection` en `main/ai/env.ts`); `modelSource`
 * indica de dónde vino `model` (mismo significado que `AiModelSource`, pero
 * evaluado para el `provider` resuelto, no solo para OpenRouter);
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
 */
export interface AiSettingsInfo {
  provider: AiProviderId
  model: string
  modelSource: AiModelSource
  perProviderModel: Partial<Record<AiProviderId, string>>
  catalog: Record<AiProviderId, AiProviderCatalogEntry>
  selectedOptions?: Partial<Record<AiProviderId, Record<string, string>>>
}

/**
 * Estado de login por proveedor de IA (T27, canal `ai:getProviderStatus`):
 * - `unavailable`: OpenRouter sin `OPENROUTER_API_KEY` configurada, o un CLI
 *   (`claude`/`codex`) que no se encontró en PATH (o cuya detección expiró
 *   por timeout — ver `main/ai/providers/cli-probe.ts`).
 * - `installed`: el CLI existe y responde, pero no se pudo confirmar sesión
 *   iniciada (best-effort en T27; T28/T29 lo reemplazan por el handshake real
 *   del SDK/RPC de cada proveedor).
 * - `authenticated`: OpenRouter con key configurada, o un CLI con indicios de
 *   sesión iniciada.
 *
 * `account` NUNCA lleva tokens/keys — a lo sumo un email/plan de exhibición.
 */
export type AiProviderStatusValue = 'unavailable' | 'installed' | 'authenticated'

export interface AiAccountInfo {
  email?: string
  plan?: string
}

export interface AiProviderStatus {
  status: AiProviderStatusValue
  account?: AiAccountInfo
}

/**
 * Estado de configuración de `OPENROUTER_API_KEY` (T32, canales
 * `settings:setOpenRouterKey`/`settings:getOpenRouterKeyStatus`,
 * `main/ai/env.ts` `getOpenRouterKeyStatus`). NUNCA lleva la key en claro —
 * la key vive solo en `main`, cifrada con `safeStorage`
 * (`main/ai/openrouter-key-store.ts`) o en `process.env`/`.env` de dev.
 * `source`: `'safeStorage'` si el usuario la guardó desde la UI de Settings
 * (gana siempre que exista), `'env'` si viene de `process.env`/`.env` de
 * desarrollo, `'none'` si no hay ninguna configurada.
 */
export type OpenRouterKeySource = 'safeStorage' | 'env' | 'none'

export interface OpenRouterKeyStatus {
  configured: boolean
  source: OpenRouterKeySource
}
