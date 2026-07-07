/**
 * Implementación mock de `GithubService`. Vive enteramente en memoria del
 * proceso `main`: se inicializa desde `./fixtures.ts` y muta su propio estado
 * (p. ej. `postComment` agrega comentarios) mientras el proceso viva.
 *
 * Simula latencia de red (150-400ms, fija por método, no aleatoria) para que
 * la UI ejercite sus estados de carga de forma reproducible.
 */
import type {
  CommentThread,
  DiffFile,
  PrComment,
  PullRequestDetail,
  PullRequestSummary,
  RepoRef,
} from '../../shared/types'
import type { IpcRequest, IpcResponse } from '../../shared/ipc'
import { prFixtures } from './fixtures'
import type { GithubService } from './service'

interface PrRecord {
  detail: PullRequestDetail
  files: DiffFile[]
  threads: CommentThread[]
}

/** Latencia simulada por método (ms), determinística — dentro del rango 150-400ms. */
const LATENCY_MS = {
  listPullRequests: 220,
  getPullRequestDetail: 180,
  getPullRequestFiles: 260,
  getCommentThreads: 200,
  postComment: 320,
} as const

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function prKey(repo: RepoRef, number: number): string {
  return `${repo.owner}/${repo.name}#${number}`
}

function notFoundError(repo: RepoRef, number: number): Error {
  return new Error(`Pull request no encontrado: ${repo.fullName}#${number}`)
}

export class MockGithubService implements GithubService {
  private readonly records = new Map<string, PrRecord>()
  private nextCommentSeq = 1000

  constructor() {
    for (const fixture of prFixtures) {
      const { detail } = fixture
      this.records.set(prKey(detail.repo, detail.number), {
        detail: { ...detail },
        files: fixture.files.map((file) => ({ ...file })),
        threads: fixture.threads.map((thread) => ({ ...thread, comments: [...thread.comments] })),
      })
    }
  }

  private getRecord(repo: RepoRef, number: number): PrRecord {
    const record = this.records.get(prKey(repo, number))
    if (!record) throw notFoundError(repo, number)
    return record
  }

  async listPullRequests(
    req: IpcRequest<'github:listPullRequests'>,
  ): Promise<IpcResponse<'github:listPullRequests'>> {
    await delay(LATENCY_MS.listPullRequests)
    const all: PullRequestSummary[] = [...this.records.values()].map((record) => record.detail)
    const query = req.search?.trim().toLowerCase()
    if (!query) return all
    return all.filter(
      (pr) =>
        pr.title.toLowerCase().includes(query) || pr.repo.fullName.toLowerCase().includes(query),
    )
  }

  async getPullRequestDetail(
    req: IpcRequest<'github:getPullRequestDetail'>,
  ): Promise<IpcResponse<'github:getPullRequestDetail'>> {
    await delay(LATENCY_MS.getPullRequestDetail)
    return this.getRecord(req.repo, req.number).detail
  }

  async getPullRequestFiles(
    req: IpcRequest<'github:getPullRequestFiles'>,
  ): Promise<IpcResponse<'github:getPullRequestFiles'>> {
    await delay(LATENCY_MS.getPullRequestFiles)
    return this.getRecord(req.repo, req.number).files
  }

  async getCommentThreads(
    req: IpcRequest<'github:getCommentThreads'>,
  ): Promise<IpcResponse<'github:getCommentThreads'>> {
    await delay(LATENCY_MS.getCommentThreads)
    return this.getRecord(req.repo, req.number).threads
  }

  async postComment(
    req: IpcRequest<'github:postComment'>,
  ): Promise<IpcResponse<'github:postComment'>> {
    await delay(LATENCY_MS.postComment)
    const record = this.getRecord(req.repo, req.number)

    const comment: PrComment = {
      id: `c-mock-${this.nextCommentSeq}`,
      author: { login: 'edygg', avatarUrl: '' },
      bodyMarkdown: req.bodyMarkdown,
      createdAt: new Date().toISOString(),
      isMinimized: false,
    }

    if (req.threadId) {
      const thread = record.threads.find((t) => t.id === req.threadId)
      if (!thread) throw new Error(`Hilo de comentarios no encontrado: ${req.threadId}`)
      thread.comments.push(comment)
    } else {
      record.threads.push({
        id: `thread-mock-${this.nextCommentSeq}`,
        isResolved: false,
        isLineThread: Boolean(req.path),
        path: req.path,
        line: req.line,
        side: req.side,
        comments: [comment],
      })
    }
    this.nextCommentSeq += 1
    record.detail.commentCount += 1

    return comment
  }
}
