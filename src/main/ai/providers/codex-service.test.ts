import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubService } from '../../github/service'
import type { DiffFile, PullRequestDetail } from '../../../shared/types'
import type { DraftDidacticSection } from '../../../shared/events'

/**
 * `CodexAiService` (T29) habla con `codex app-server` vía
 * `./codex-app-server-client.ts` (JSON-RPC 2.0 sobre stdio) — se mockea ESE
 * cliente por completo (nunca el `child_process` real) para simular el
 * handshake real (`initialize`/`initialized`/`account/read`/`thread/start`/
 * `turn/start`) y el stream de notificaciones. La forma de los mensajes está
 * verificada contra `codex app-server` 0.142.x (esquema `generate-ts` + un
 * turno de humo real): los deltas de texto son `item/agentMessage/delta` con
 * `params.delta`, y el fin del turno es la notificación `turn/completed` (NO
 * la resolución de `turn/start`, que es un ack inmediato).
 */
const getEffectiveAiSelectionMock = vi.fn()
vi.mock('../env', () => ({
  getEffectiveAiSelection: (...args: unknown[]) => getEffectiveAiSelectionMock(...args),
}))

interface FakeClientScript {
  requestResults: Map<string, unknown[]>
  requestErrors: Map<string, Error>
  /** Notificaciones que el server emite durante `turn/start`, en orden. Tras emitirlas, el fake cierra el turno con `turn/completed` (salvo que el script ya incluya uno). */
  notifications: Array<{ method: string; params?: unknown }>
}

function makeFakeClientModule(script: FakeClientScript) {
  const requestCalls: Array<{ method: string; params: unknown }> = []
  const notifyCalls: Array<{ method: string; params: unknown }> = []
  let killCalls = 0
  let notificationHandler: ((n: { method: string; params?: unknown }) => void) | null = null

  class FakeCodexAppServerClient {
    request(method: string, params: unknown): Promise<unknown> {
      requestCalls.push({ method, params })
      const error = script.requestErrors.get(method)
      if (error) return Promise.reject(error)

      const queue = script.requestResults.get(method) ?? []
      const result = queue.shift()

      if (method === 'turn/start') {
        // El server real emite las notificaciones del turno (deltas, item/*)
        // y cierra con `turn/completed`; `turn/start` en sí resuelve de
        // inmediato con un ack. Se emiten las scriptadas y, si ninguna cerró
        // el turno, se auto-emite un `turn/completed` exitoso.
        const closesTurn = (n: { method: string }) =>
          n.method === 'turn/completed' || n.method === 'error'
        for (const notification of script.notifications) {
          notificationHandler?.(notification)
        }
        if (!script.notifications.some(closesTurn)) {
          notificationHandler?.({
            method: 'turn/completed',
            params: { threadId: 't-1', turn: { status: 'completed' } },
          })
        }
      }

      return Promise.resolve(result)
    }

    notify(method: string, params: unknown): void {
      notifyCalls.push({ method, params })
    }

    onNotification(handler: (n: { method: string; params?: unknown }) => void): () => void {
      notificationHandler = handler
      return () => {
        notificationHandler = null
      }
    }

    kill(): void {
      killCalls++
    }
  }

  return {
    module: {
      CodexAppServerClient: FakeCodexAppServerClient,
      CodexSpawnError: class CodexSpawnError extends Error {},
      JsonRpcRemoteError: class JsonRpcRemoteError extends Error {
        constructor(
          message: string,
          readonly code: number,
        ) {
          super(message)
        }
      },
    },
    requestCalls,
    notifyCalls,
    getKillCalls: () => killCalls,
  }
}

let currentFake: ReturnType<typeof makeFakeClientModule> | null = null

vi.mock('./codex-app-server-client', () => ({
  get CodexAppServerClient() {
    return currentFake!.module.CodexAppServerClient
  },
  get CodexSpawnError() {
    return currentFake!.module.CodexSpawnError
  },
  get JsonRpcRemoteError() {
    return currentFake!.module.JsonRpcRemoteError
  },
}))

const { CodexAiService } = await import('./codex-service')

function setupFakeClient(script: Partial<FakeClientScript> = {}) {
  const full: FakeClientScript = {
    requestResults: script.requestResults ?? new Map(),
    requestErrors: script.requestErrors ?? new Map(),
    notifications: script.notifications ?? [],
  }
  currentFake = makeFakeClientModule(full)
  return currentFake
}

/** Handshake exitoso completo; thread/start responde la forma real `{ thread: { id } }`. */
function happyPathResults(): Map<string, unknown[]> {
  return new Map<string, unknown[]>([
    ['initialize', [{ userAgent: 'minerva/0.1.0' }]],
    ['account/read', [{ account: { type: 'chatgpt', email: 'edilson@example.com' }, requiresOpenaiAuth: true }]],
    ['thread/start', [{ thread: { id: 't-1' }, model: 'gpt-5.5' }]],
    ['turn/start', [{ turn: { status: 'inProgress' } }]],
  ])
}

/** Delta de texto del asistente, con el método REAL `item/agentMessage/delta`. */
function itemDelta(text: string): { method: string; params: unknown } {
  return { method: 'item/agentMessage/delta', params: { threadId: 't-1', turnId: 'x', itemId: 'y', delta: text } }
}

const repo = { owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }

const detail: PullRequestDetail = {
  id: 'shopwave/api#482',
  number: 482,
  title: 'Add apply-coupon endpoint',
  author: { login: 'jdoe', avatarUrl: 'https://example.com/a.png' },
  repo,
  state: 'open',
  isDraft: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  headRef: 'feat/apply-coupon',
  baseRef: 'main',
  commentCount: 0,
  reviewDecision: null,
  ciStatus: 'success',
  additions: 40,
  deletions: 2,
  changedFiles: 2,
  bodyMarkdown: 'Adds a coupon endpoint.',
  labels: [{ name: 'feature', color: '00ff00' }],
  reviewers: [],
  commits: 1,
}

const files: DiffFile[] = [
  {
    path: 'src/routes/carts.ts',
    status: 'modified',
    additions: 30,
    deletions: 2,
    isBinary: false,
    patch: '@@ -1,1 +1,1 @@\n-old\n+new',
  },
]

function makeGithubService(): GithubService {
  return {
    listPullRequests: vi.fn(),
    getPullRequestDetail: vi.fn().mockResolvedValue(detail),
    getPullRequestFiles: vi.fn().mockResolvedValue(files),
    getCommentThreads: vi.fn(),
    postComment: vi.fn(),
  } as unknown as GithubService
}

describe('CodexAiService.analyzePullRequest', () => {
  beforeEach(() => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'codex', model: 'gpt-5.5' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    currentFake = null
  })

  it('mapea los deltas de item/agentMessage/delta a DidacticAnalysis y hace el handshake real', async () => {
    const fake = setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [itemDelta('@@@SECTION kind=summary\n'), itemDelta('Resumen del PR\n')],
    })

    const service = new CodexAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })

    expect(result.prId).toBe('shopwave/api#482')
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'Resumen del PR' }])
    expect(typeof result.generatedAt).toBe('string')

    const methods = fake.requestCalls.map((c) => c.method)
    expect(methods).toEqual(['initialize', 'account/read', 'thread/start', 'turn/start'])
    expect(fake.notifyCalls).toEqual([{ method: 'initialized', params: undefined }])

    const initCall = fake.requestCalls.find((c) => c.method === 'initialize')!
    expect(initCall.params).toMatchObject({
      clientInfo: { name: 'minerva' },
      capabilities: { experimentalApi: true },
    })

    const threadStartCall = fake.requestCalls.find((c) => c.method === 'thread/start')!
    expect(threadStartCall.params).toEqual({
      model: 'gpt-5.5',
      baseInstructions: expect.any(String),
      sandbox: 'read-only',
      approvalPolicy: 'never',
    })

    const turnStartCall = fake.requestCalls.find((c) => c.method === 'turn/start')!
    expect(turnStartCall.params).toEqual({
      threadId: 't-1',
      input: [
        { type: 'text', text: expect.stringContaining(detail.title), text_elements: [] },
      ],
    })

    expect(fake.getKillCalls()).toBeGreaterThan(0)
  })

  it('llama a onProgress con snapshots parciales y una vez final con done:true', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        itemDelta('@@@SECTION kind=summary\n'),
        itemDelta('primera parte '),
        itemDelta('segunda parte\n'),
      ],
    })

    const progressCalls: Array<[DraftDidacticSection[], { done: boolean }]> = []
    const service = new CodexAiService(makeGithubService())
    const result = await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'primera parte segunda parte' }])
    expect(progressCalls.length).toBeGreaterThan(0)

    const [lastSections, lastMeta] = progressCalls[progressCalls.length - 1]
    expect(lastMeta.done).toBe(true)
    expect(lastSections).toEqual(result.sections)
    expect(progressCalls.slice(0, -1).every(([, meta]) => meta.done === false)).toBe(true)
  })

  it('ignora notificaciones de razonamiento y las que no son agentMessage delta', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        { method: 'item/reasoning/textDelta', params: { delta: 'pensando...' } },
        { method: 'item/started', params: { item: { id: 'x' } } },
        { method: 'item/plan/delta', params: { delta: 'plan interno' } },
        itemDelta('@@@SECTION kind=summary\nok\n'),
      ],
    })

    const service = new CodexAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('reconstruye una sección aunque el delta llegue partido en varios chunks', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        itemDelta('@@@SEC'),
        itemDelta('TION kind=sum'),
        itemDelta('mary\nhola '),
        itemDelta('mundo\n'),
      ],
    })

    const service = new CodexAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'hola mundo' }])
  })

  it('rechaza el turno ante una notificación de error del servidor', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        itemDelta('@@@SECTION kind=summary\nparcial\n'),
        { method: 'error', params: { message: 'stream interrumpido' } },
      ],
    })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('stream interrumpido')
  })

  it('lanza un mensaje accionable de login cuando account/read rechaza', async () => {
    const results = happyPathResults()
    results.delete('account/read')
    setupFakeClient({
      requestResults: results,
      requestErrors: new Map([['account/read', new Error('unauthorized')]]),
    })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('codex login')
  })

  it('lanza un mensaje accionable de login cuando account/read resuelve sin cuenta', async () => {
    const results = happyPathResults()
    results.set('account/read', [{ account: null, requiresOpenaiAuth: true }])
    setupFakeClient({ requestResults: results })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('codex login')
  })

  it('lanza si el turno no emite ningún delta de texto', async () => {
    setupFakeClient({ requestResults: happyPathResults(), notifications: [] })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'no devolvió contenido de streaming',
    )
  })

  it('lanza si todas las secciones emitidas son inválidas', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [itemDelta('@@@SECTION kind=nope\ncontenido\n')],
    })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('Ninguna sección')
  })

  it('siempre mata el proceso hijo, incluso en el camino de error', async () => {
    const fake = setupFakeClient({
      requestResults: new Map(),
      requestErrors: new Map([['initialize', new Error('spawn falló')]]),
    })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow()
    expect(fake.getKillCalls()).toBeGreaterThan(0)
  })
})
