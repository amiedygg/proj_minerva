/**
 * Modelos de dominio compartidos entre `main` y `renderer`.
 * Solo tipos (interfaces / type aliases) — sin clases, sin lógica.
 */
import type { DraftDidacticSection } from './events'

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

export interface DidacticAnalysis {
  prId: string
  sections: DidacticSection[]
  generatedAt: string
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
