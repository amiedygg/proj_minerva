import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubService } from '../github/service'

/**
 * `createAiService` (T27, factory multi-proveedor; ASYNC desde T28 — ver el
 * comentario de `./index.ts`) delega en `getEffectiveAiSelection`/`getAiEnv`
 * (`./env.ts`) para elegir implementación, y en `getCliProviderStatus`
 * (`./providers/cli-probe.ts`) para saber si el proveedor `cli` activo
 * (Claude Code/Codex) tiene sesión. Se mockean esas tres funciones más las
 * clases `OpenRouterAiService`/`ClaudeCodeAiService`/`MockAiService`
 * (constructores espiados, sin lógica real) para verificar SOLO la lógica de
 * selección del factory, sin pagar ninguna llamada real ni depender del
 * entorno (`OPENROUTER_API_KEY`, sesión de `claude`) de quien corre los tests.
 */
const getAiEnvMock = vi.fn()
const getEffectiveAiSelectionMock = vi.fn()
vi.mock('./env', () => ({
  getAiEnv: (...args: unknown[]) => getAiEnvMock(...args),
  getEffectiveAiSelection: (...args: unknown[]) => getEffectiveAiSelectionMock(...args),
}))

const getCliProviderStatusMock = vi.fn()
vi.mock('./providers/cli-probe', () => ({
  getCliProviderStatus: (...args: unknown[]) => getCliProviderStatusMock(...args),
}))

const openRouterCtor = vi.fn()
vi.mock('./openrouter-service', () => ({
  OpenRouterAiService: class {
    constructor(...args: unknown[]) {
      openRouterCtor(...args)
    }
  },
}))

const claudeCodeCtor = vi.fn()
vi.mock('./providers/claude-code-service', () => ({
  ClaudeCodeAiService: class {
    constructor(...args: unknown[]) {
      claudeCodeCtor(...args)
    }
  },
}))

const mockServiceCtor = vi.fn()
vi.mock('./mock-service', () => ({
  MockAiService: class {
    constructor(...args: unknown[]) {
      mockServiceCtor(...args)
    }
  },
}))

const { createAiService } = await import('./index')

function makeGithub(): GithubService {
  return {} as GithubService
}

describe('createAiService (T27, factory multi-proveedor; async desde T28)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('openrouter activo + key: instancia OpenRouterAiService (comportamiento idéntico al pre-T27)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'openrouter', model: 'z-ai/glm-5.2' })
    getAiEnvMock.mockReturnValue({ openRouterApiKey: 'sk-x', aiModel: 'z-ai/glm-5.2' })
    const github = makeGithub()

    await createAiService(github)

    expect(openRouterCtor).toHaveBeenCalledExactlyOnceWith(github)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(getCliProviderStatusMock).not.toHaveBeenCalled()
  })

  it('openrouter activo sin key: cae a MockAiService', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'openrouter', model: 'z-ai/glm-5.2' })
    getAiEnvMock.mockReturnValue({ openRouterApiKey: null, aiModel: 'z-ai/glm-5.2' })

    await createAiService(makeGithub())

    expect(mockServiceCtor).toHaveBeenCalledTimes(1)
    expect(openRouterCtor).not.toHaveBeenCalled()
  })

  it('claude-code activo + CLI autenticado: instancia ClaudeCodeAiService (T28)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'claude-code', model: 'claude-sonnet-5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'authenticated', account: { plan: 'max' } })
    const github = makeGithub()

    await createAiService(github)

    expect(claudeCodeCtor).toHaveBeenCalledExactlyOnceWith(github)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(getCliProviderStatusMock).toHaveBeenCalledExactlyOnceWith('claude-code')
    // `getAiEnv` (chequeo de key de OpenRouter) no debería ni consultarse
    // para un proveedor que no es OpenRouter.
    expect(getAiEnvMock).not.toHaveBeenCalled()
  })

  it('claude-code activo + CLI instalado sin sesión: cae a MockAiService', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'claude-code', model: 'claude-sonnet-5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'installed' })

    await createAiService(makeGithub())

    expect(mockServiceCtor).toHaveBeenCalledTimes(1)
    expect(claudeCodeCtor).not.toHaveBeenCalled()
  })

  it('claude-code activo + CLI no disponible: cae a MockAiService', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'claude-code', model: 'claude-sonnet-5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    await createAiService(makeGithub())

    expect(mockServiceCtor).toHaveBeenCalledTimes(1)
    expect(claudeCodeCtor).not.toHaveBeenCalled()
  })

  it('codex activo: CodexAiService todavía no existe (T29), cae a MockAiService', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'codex', model: 'gpt-5.5-codex' })

    await createAiService(makeGithub())

    expect(mockServiceCtor).toHaveBeenCalledTimes(1)
    expect(openRouterCtor).not.toHaveBeenCalled()
    expect(claudeCodeCtor).not.toHaveBeenCalled()
  })
})
