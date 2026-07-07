/**
 * Implementación real de `GithubService` con Octokit: GraphQL para listados
 * (pocas llamadas, forma exacta de datos) y REST para acciones puntuales
 * (archivos de un PR, publicar comentarios). Ver `./index.ts` para cómo se
 * selecciona esta implementación vs. `MockGithubService`.
 *
 * El token nunca vive aquí: se pide en cada llamada vía `tokenProvider` (en
 * la práctica, `() => authManager.getToken()`) para reflejar siempre el
 * estado más reciente de la sesión sin que esta clase tenga que enterarse de
 * logins/logouts.
 */
import { Octokit } from 'octokit'
import type {
  CiStatus,
  DiffFileStatus,
  PrComment,
  PullRequestDetail,
  PullRequestState,
  PullRequestSummary,
  RepoRef,
  ReviewDecision,
  UserRef,
} from '../../shared/types'
import type { IpcRequest, IpcResponse } from '../../shared/ipc'
import type { GithubService } from './service'

/** Prefijo sintético para hilos generales (issue comments, sin línea): ver `mapIssueCommentToThread`. */
const ISSUE_THREAD_PREFIX = 'issue-'

// ---------------------------------------------------------------------------
// Tipos propios para las respuestas de GraphQL (Octokit no genera tipos para
// queries arbitrarias: se declaran a mano, con los campos que efectivamente
// pedimos). Todos los campos que GitHub puede omitir/nullear se tipan
// opcionales/nullable a propósito, y se mapean con fallback explícito.
// ---------------------------------------------------------------------------

interface GraphqlAuthor {
  login: string
  avatarUrl: string
}

interface GraphqlCommentNode {
  id: string
  body: string
  createdAt: string
  isMinimized: boolean
  author: GraphqlAuthor | null
}

type GraphqlReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
type GraphqlPrState = 'OPEN' | 'CLOSED' | 'MERGED'

interface SearchPullRequestNode {
  __typename: string
  id?: string
  number?: number
  title?: string
  state?: GraphqlPrState
  isDraft?: boolean
  createdAt?: string
  updatedAt?: string
  headRefName?: string
  baseRefName?: string
  additions?: number
  deletions?: number
  changedFiles?: number
  reviewDecision?: GraphqlReviewDecision
  author?: GraphqlAuthor | null
  repository?: { owner: { login: string }; name: string; nameWithOwner: string }
  comments?: { totalCount: number }
  lastCommit?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
}

interface SearchPullRequestsResponse {
  search: { nodes: SearchPullRequestNode[] }
}

interface RequestedReviewer {
  login?: string
  avatarUrl?: string
}

interface PullRequestDetailNode {
  id: string
  number: number
  title: string
  body: string | null
  state: GraphqlPrState
  isDraft: boolean
  createdAt: string
  updatedAt: string
  headRefName: string
  baseRefName: string
  additions: number
  deletions: number
  changedFiles: number
  reviewDecision: GraphqlReviewDecision
  author: GraphqlAuthor | null
  comments: { totalCount: number }
  commitCount: { totalCount: number }
  lastCommit: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
  labels: { nodes: { name: string; color: string }[] } | null
  reviewRequests: { nodes: { requestedReviewer: RequestedReviewer | null }[] } | null
  latestReviews: { nodes: { author: GraphqlAuthor | null }[] } | null
}

interface PullRequestDetailResponse {
  repository: { pullRequest: PullRequestDetailNode | null } | null
}

interface ReviewThreadNode {
  id: string
  isResolved: boolean
  path: string
  line: number | null
  originalLine: number | null
  diffSide: 'LEFT' | 'RIGHT' | null
  comments: { nodes: GraphqlCommentNode[] }
}

interface PullRequestThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: { nodes: ReviewThreadNode[] }
      comments: { nodes: GraphqlCommentNode[] }
    } | null
  } | null
}

interface AddReviewThreadReplyResponse {
  addPullRequestReviewThreadReply: { comment: GraphqlCommentNode }
}

// ---------------------------------------------------------------------------
// Queries / mutations. GraphQL de GitHub: campos `commits` con distintos
// argumentos se piden dos veces bajo alias distintos (`commitCount`,
// `lastCommit`) porque GraphQL no permite repetir un campo con args
// diferentes sin alias.
// ---------------------------------------------------------------------------

const SEARCH_PULL_REQUESTS_QUERY = `
  query SearchPullRequests($searchQuery: String!) {
    search(type: ISSUE, query: $searchQuery, first: 50) {
      nodes {
        __typename
        ... on PullRequest {
          id
          number
          title
          state
          isDraft
          createdAt
          updatedAt
          headRefName
          baseRefName
          additions
          deletions
          changedFiles
          reviewDecision
          author { login avatarUrl }
          repository { owner { login } name nameWithOwner }
          comments { totalCount }
          lastCommit: commits(last: 1) {
            nodes { commit { statusCheckRollup { state } } }
          }
        }
      }
    }
  }
`

const PULL_REQUEST_DETAIL_QUERY = `
  query PullRequestDetail($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id
        number
        title
        body
        state
        isDraft
        createdAt
        updatedAt
        headRefName
        baseRefName
        additions
        deletions
        changedFiles
        reviewDecision
        author { login avatarUrl }
        comments { totalCount }
        commitCount: commits { totalCount }
        lastCommit: commits(last: 1) {
          nodes { commit { statusCheckRollup { state } } }
        }
        labels(first: 30) { nodes { name color } }
        reviewRequests(first: 20) {
          nodes { requestedReviewer { ... on User { login avatarUrl } } }
        }
        latestReviews(first: 20) {
          nodes { author { login avatarUrl } }
        }
      }
    }
  }
`

const PULL_REQUEST_THREADS_QUERY = `
  query PullRequestThreads($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            path
            line
            originalLine
            diffSide
            comments(first: 100) {
              nodes { id body createdAt isMinimized author { login avatarUrl } }
            }
          }
        }
        comments(first: 100) {
          nodes { id body createdAt isMinimized author { login avatarUrl } }
        }
      }
    }
  }
`

const ADD_REVIEW_THREAD_REPLY_MUTATION = `
  mutation AddReviewThreadReply($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
      comment {
        id
        body
        createdAt
        isMinimized
        author { login avatarUrl }
      }
    }
  }
`

// ---------------------------------------------------------------------------
// Mapeos GraphQL -> tipos de dominio, con cuidado explícito de los `null`.
// ---------------------------------------------------------------------------

function mapPrState(state: GraphqlPrState | undefined): PullRequestState {
  switch (state) {
    case 'CLOSED':
      return 'closed'
    case 'MERGED':
      return 'merged'
    default:
      return 'open'
  }
}

function mapReviewDecision(decision: GraphqlReviewDecision | undefined): ReviewDecision {
  switch (decision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    case 'REVIEW_REQUIRED':
      return 'review_required'
    default:
      return null
  }
}

function mapCiStatus(state: string | null | undefined): CiStatus {
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return null
  }
}

function mapAuthor(author: GraphqlAuthor | null | undefined): UserRef {
  return author
    ? { login: author.login, avatarUrl: author.avatarUrl }
    : { login: 'ghost', avatarUrl: '' }
}

function mapSearchNodeToSummary(node: SearchPullRequestNode): PullRequestSummary {
  const repo: RepoRef = {
    owner: node.repository?.owner.login ?? '',
    name: node.repository?.name ?? '',
    fullName: node.repository?.nameWithOwner ?? '',
  }
  return {
    id: node.id ?? '',
    number: node.number ?? 0,
    title: node.title ?? '',
    author: mapAuthor(node.author),
    repo,
    state: mapPrState(node.state),
    isDraft: Boolean(node.isDraft),
    createdAt: node.createdAt ?? new Date(0).toISOString(),
    updatedAt: node.updatedAt ?? new Date(0).toISOString(),
    headRef: node.headRefName ?? '',
    baseRef: node.baseRefName ?? '',
    commentCount: node.comments?.totalCount ?? 0,
    reviewDecision: mapReviewDecision(node.reviewDecision),
    ciStatus: mapCiStatus(node.lastCommit?.nodes[0]?.commit.statusCheckRollup?.state),
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    changedFiles: node.changedFiles ?? 0,
  }
}

function mapDetailNode(pr: PullRequestDetailNode, repo: RepoRef): PullRequestDetail {
  const reviewers = new Map<string, UserRef>()
  for (const { requestedReviewer } of pr.reviewRequests?.nodes ?? []) {
    if (requestedReviewer?.login) {
      reviewers.set(requestedReviewer.login, {
        login: requestedReviewer.login,
        avatarUrl: requestedReviewer.avatarUrl ?? '',
      })
    }
  }
  for (const { author } of pr.latestReviews?.nodes ?? []) {
    if (author?.login) reviewers.set(author.login, mapAuthor(author))
  }

  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    author: mapAuthor(pr.author),
    repo,
    state: mapPrState(pr.state),
    isDraft: Boolean(pr.isDraft),
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    headRef: pr.headRefName,
    baseRef: pr.baseRefName,
    commentCount: pr.comments?.totalCount ?? 0,
    reviewDecision: mapReviewDecision(pr.reviewDecision),
    ciStatus: mapCiStatus(pr.lastCommit?.nodes[0]?.commit.statusCheckRollup?.state),
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changedFiles ?? 0,
    bodyMarkdown: pr.body ?? '',
    labels: (pr.labels?.nodes ?? []).map((label) => ({ name: label.name, color: label.color })),
    reviewers: [...reviewers.values()],
    commits: pr.commitCount?.totalCount ?? 0,
  }
}

function mapGraphqlCommentToPrComment(comment: GraphqlCommentNode): PrComment {
  return {
    id: comment.id,
    author: mapAuthor(comment.author),
    bodyMarkdown: comment.body,
    createdAt: comment.createdAt,
    isMinimized: comment.isMinimized,
  }
}

function mapReviewThreadNode(
  node: ReviewThreadNode,
): IpcResponse<'github:getCommentThreads'>[number] {
  return {
    id: node.id,
    isResolved: node.isResolved,
    isLineThread: true,
    path: node.path,
    line: node.line ?? node.originalLine ?? undefined,
    side: node.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
    comments: node.comments.nodes.map(mapGraphqlCommentToPrComment),
  }
}

function mapIssueCommentToThread(
  comment: GraphqlCommentNode,
): IpcResponse<'github:getCommentThreads'>[number] {
  return {
    id: `${ISSUE_THREAD_PREFIX}${comment.id}`,
    isResolved: false,
    isLineThread: false,
    comments: [mapGraphqlCommentToPrComment(comment)],
  }
}

function mapFileStatus(status: string): DiffFileStatus {
  switch (status) {
    case 'added':
      return 'added'
    case 'removed':
      return 'removed'
    case 'renamed':
      return 'renamed'
    default:
      // 'modified' | 'copied' | 'changed' | 'unchanged' (o cualquier valor
      // futuro no contemplado): tratamos como "modified", el catch-all más
      // razonable para nuestro modelo de 4 estados.
      return 'modified'
  }
}

function mapRestCommentToPrComment(data: {
  id: number
  body?: string | null
  created_at: string
  user?: { login: string; avatar_url: string } | null
}): PrComment {
  return {
    id: String(data.id),
    author: data.user
      ? { login: data.user.login, avatarUrl: data.user.avatar_url }
      : { login: 'ghost', avatarUrl: '' },
    bodyMarkdown: data.body ?? '',
    createdAt: data.created_at,
    isMinimized: false,
  }
}

// ---------------------------------------------------------------------------
// Errores: Octokit lanza `RequestError` (REST y fallas HTTP de GraphQL) con
// `.status`, o (para GraphQL con HTTP 200 pero `errors` en el body) un error
// con `.errors[].type`. Se mapea con duck-typing (sin importar las clases
// concretas) para no acoplarse a la forma exacta de cada una.
// ---------------------------------------------------------------------------

interface GithubErrorLike {
  status?: number
  response?: { headers?: Record<string, string> }
  errors?: { type?: string; message?: string }[]
}

function asGithubErrorLike(error: unknown): GithubErrorLike {
  return typeof error === 'object' && error !== null ? (error as GithubErrorLike) : {}
}

function mapGithubError(error: unknown, repoFullName?: string): Error {
  const err = asGithubErrorLike(error)
  const status = typeof err.status === 'number' ? err.status : undefined
  const repoLabel = repoFullName ?? 'este repositorio'

  if (status === 401) {
    return new Error(
      'No autenticado: el token de GitHub es inválido o expiró. Vuelve a iniciar sesión.',
    )
  }

  if (status === 403) {
    const headers = err.response?.headers ?? {}
    const remaining = headers['x-ratelimit-remaining']
    const reset = headers['x-ratelimit-reset']
    if (remaining === '0' && reset) {
      const resetMs = Number(reset) * 1000
      const minutes = Math.max(1, Math.ceil((resetMs - Date.now()) / 60000))
      return new Error(`Rate limit de GitHub alcanzado, intenta en ${minutes} min`)
    }
    return new Error(`Sin permisos para ${repoLabel}`)
  }

  if (status === 404) {
    return new Error(`Sin permisos para ${repoLabel} (o no existe)`)
  }

  const graphqlErrorType = err.errors?.[0]?.type
  if (graphqlErrorType === 'FORBIDDEN') {
    return new Error(`Sin permisos para ${repoLabel}`)
  }
  if (graphqlErrorType === 'NOT_FOUND') {
    return new Error(`Sin permisos para ${repoLabel} (o no existe)`)
  }

  if (status) {
    return new Error(`Error de GitHub (status ${status})`)
  }

  return new Error(
    error instanceof Error ? error.message : 'Error desconocido al hablar con GitHub',
  )
}

// ---------------------------------------------------------------------------
// Servicio real.
// ---------------------------------------------------------------------------

export class RealGithubService implements GithubService {
  constructor(private readonly getToken: () => string | null) {}

  private requireToken(): string {
    const token = this.getToken()
    if (!token) throw new Error('No autenticado: inicia sesión con GitHub')
    return token
  }

  private client(token: string): Octokit {
    return new Octokit({
      auth: token,
      throttle: {
        // No reintentamos automáticamente ante rate limit: dejamos que el
        // error real suba y lo mapeamos nosotros (`mapGithubError`) a un
        // mensaje en español con el tiempo de espera.
        onRateLimit: () => false,
        onSecondaryRateLimit: () => false,
      },
    })
  }

  async listPullRequests(
    req: IpcRequest<'github:listPullRequests'>,
  ): Promise<IpcResponse<'github:listPullRequests'>> {
    const token = this.requireToken()
    try {
      const client = this.client(token)
      const extra = req.search?.trim()
      const searchQuery = ['is:pr', 'is:open', 'involves:@me', 'archived:false', extra]
        .filter((part): part is string => Boolean(part))
        .join(' ')
      const data = await client.graphql<SearchPullRequestsResponse>(SEARCH_PULL_REQUESTS_QUERY, {
        searchQuery,
      })
      return data.search.nodes
        .filter((node) => node.__typename === 'PullRequest')
        .map(mapSearchNodeToSummary)
    } catch (error) {
      throw mapGithubError(error)
    }
  }

  async getPullRequestDetail(
    req: IpcRequest<'github:getPullRequestDetail'>,
  ): Promise<IpcResponse<'github:getPullRequestDetail'>> {
    const token = this.requireToken()
    try {
      const client = this.client(token)
      const data = await client.graphql<PullRequestDetailResponse>(PULL_REQUEST_DETAIL_QUERY, {
        owner: req.repo.owner,
        name: req.repo.name,
        number: req.number,
      })
      const pr = data.repository?.pullRequest
      if (!pr) throw new Error(`Pull request no encontrado: ${req.repo.fullName}#${req.number}`)
      return mapDetailNode(pr, req.repo)
    } catch (error) {
      throw mapGithubError(error, req.repo.fullName)
    }
  }

  async getPullRequestFiles(
    req: IpcRequest<'github:getPullRequestFiles'>,
  ): Promise<IpcResponse<'github:getPullRequestFiles'>> {
    const token = this.requireToken()
    try {
      const client = this.client(token)
      const perPage = 100
      const maxFiles = 300
      const files: Awaited<ReturnType<Octokit['rest']['pulls']['listFiles']>>['data'] = []

      for (let page = 1; files.length < maxFiles; page++) {
        const { data } = await client.rest.pulls.listFiles({
          owner: req.repo.owner,
          repo: req.repo.name,
          pull_number: req.number,
          per_page: perPage,
          page,
        })
        files.push(...data)
        if (data.length < perPage) break
      }

      return files.slice(0, maxFiles).map((file) => ({
        path: file.filename,
        previousPath: file.previous_filename,
        status: mapFileStatus(file.status),
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
        isBinary: file.patch === undefined,
      }))
    } catch (error) {
      throw mapGithubError(error, req.repo.fullName)
    }
  }

  async getCommentThreads(
    req: IpcRequest<'github:getCommentThreads'>,
  ): Promise<IpcResponse<'github:getCommentThreads'>> {
    const token = this.requireToken()
    try {
      const client = this.client(token)
      const data = await client.graphql<PullRequestThreadsResponse>(PULL_REQUEST_THREADS_QUERY, {
        owner: req.repo.owner,
        name: req.repo.name,
        number: req.number,
      })
      const pr = data.repository?.pullRequest
      if (!pr) throw new Error(`Pull request no encontrado: ${req.repo.fullName}#${req.number}`)

      const lineThreads = pr.reviewThreads.nodes.map(mapReviewThreadNode)
      const generalThreads = pr.comments.nodes.map(mapIssueCommentToThread)
      return [...lineThreads, ...generalThreads]
    } catch (error) {
      throw mapGithubError(error, req.repo.fullName)
    }
  }

  async postComment(
    req: IpcRequest<'github:postComment'>,
  ): Promise<IpcResponse<'github:postComment'>> {
    const token = this.requireToken()
    try {
      const client = this.client(token)

      // Caso 1: respuesta a un hilo de línea ya existente (threadId es el id
      // GraphQL del review thread). Los hilos sintéticos de comentarios
      // generales (`issue-<id>`, ver `mapIssueCommentToThread`) no son un
      // hilo real para GitHub — una "respuesta" a uno de esos cae al caso
      // general (caso 3), como cualquier otro comentario del PR.
      if (req.threadId && !req.threadId.startsWith(ISSUE_THREAD_PREFIX)) {
        const data = await client.graphql<AddReviewThreadReplyResponse>(
          ADD_REVIEW_THREAD_REPLY_MUTATION,
          { threadId: req.threadId, body: req.bodyMarkdown },
        )
        return mapGraphqlCommentToPrComment(data.addPullRequestReviewThreadReply.comment)
      }

      // Caso 2: hilo nuevo en una línea concreta del diff.
      if (req.path && req.line !== undefined && !req.threadId) {
        const { data: pr } = await client.rest.pulls.get({
          owner: req.repo.owner,
          repo: req.repo.name,
          pull_number: req.number,
        })
        const { data: comment } = await client.rest.pulls.createReviewComment({
          owner: req.repo.owner,
          repo: req.repo.name,
          pull_number: req.number,
          commit_id: pr.head.sha,
          path: req.path,
          line: req.line,
          side: req.side ?? 'RIGHT',
          body: req.bodyMarkdown,
        })
        return mapRestCommentToPrComment(comment)
      }

      // Caso 3: comentario general (incluye "respuestas" a hilos sintéticos).
      const { data: comment } = await client.rest.issues.createComment({
        owner: req.repo.owner,
        repo: req.repo.name,
        issue_number: req.number,
        body: req.bodyMarkdown,
      })
      return mapRestCommentToPrComment(comment)
    } catch (error) {
      throw mapGithubError(error, req.repo.fullName)
    }
  }
}
