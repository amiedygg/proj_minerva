import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubService } from '../github/service'

/**
 * `createAiService` (T27, factory multi-proveedor; ASYNC desde T28 — ver el
 * comentario de `./index.ts`) delega en `getEffectiveAiSelection`/`getAiEnv`
 * (`./env.ts`) para elegir implementación, y en `getCliProviderStatus`
 * (`./providers/cli-probe.ts`) para saber si el proveedor `cli` activo
 * (Claude Code/Codex) tiene sesión. Se mockean esas funciones más las clases
 * `OpenRouterAiService`/`ClaudeCodeAiService`/`CodexAiService`/`MockAiService`
 * (constructores espiados, sin lógica real) para verificar SOLO la lógica de
 * selección del factory, sin pagar ninguna llamada real ni depender del
 * entorno (`OPENROUTER_API_KEY`, sesión de `claude`) de quien corre los tests.
 * `MINERVA_MOCK` se controla por test: sin él el factory LANZA cuando el
 * proveedor activo no puede inicializarse; con `MINERVA_MOCK=1` cae al mock
 * de IA (modo demo) — ver el comentario de `createAiServiceForProvider`.
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

const codexCtor = vi.fn()
vi.mock('./providers/codex-service', () => ({
  CodexAiService: class {
    constructor(...args: unknown[]) {
      codexCtor(...args)
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
  const originalMinervaMock = process.env.MINERVA_MOCK

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // GitHub REAL por defecto: el fallback al mock de IA solo aplica en modo
    // demo (`MINERVA_MOCK=1`), los tests que lo cubren lo setean explícito.
    delete process.env.MINERVA_MOCK
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalMinervaMock === undefined) delete process.env.MINERVA_MOCK
    else process.env.MINERVA_MOCK = originalMinervaMock
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

  it('openrouter activo sin key + GitHub real: LANZA con la causa y el remedio (no cae al mock)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'openrouter', model: 'z-ai/glm-5.2' })
    getAiEnvMock.mockReturnValue({ openRouterApiKey: null, aiModel: 'z-ai/glm-5.2' })

    await expect(createAiService(makeGithub())).rejects.toThrow(
      /OpenRouter.*API key.*Settings/s,
    )
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(openRouterCtor).not.toHaveBeenCalled()
  })

  it('openrouter activo sin key + MINERVA_MOCK=1: cae a MockAiService (demo sin credenciales)', async () => {
    process.env.MINERVA_MOCK = '1'
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

  it('claude-code activo + CLI instalado sin sesión + GitHub real: LANZA sugiriendo «claude login»', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'claude-code', model: 'claude-sonnet-5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'installed' })

    await expect(createAiService(makeGithub())).rejects.toThrow(/sin sesión.*claude login/s)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(claudeCodeCtor).not.toHaveBeenCalled()
  })

  it('claude-code activo + CLI no disponible + GitHub real: LANZA diciendo que no se encontró el CLI', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'claude-code', model: 'claude-sonnet-5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    await expect(createAiService(makeGithub())).rejects.toThrow(/No se encontró el CLI «claude»/)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(claudeCodeCtor).not.toHaveBeenCalled()
  })

  it('claude-code activo + CLI no disponible + MINERVA_MOCK=1: cae a MockAiService (demo)', async () => {
    process.env.MINERVA_MOCK = '1'
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'claude-code', model: 'claude-sonnet-5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    await createAiService(makeGithub())

    expect(mockServiceCtor).toHaveBeenCalledTimes(1)
    expect(claudeCodeCtor).not.toHaveBeenCalled()
  })

  it('codex activo + CLI autenticado: instancia CodexAiService (T29)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'codex', model: 'gpt-5.5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'authenticated' })
    const github = makeGithub()

    await createAiService(github)

    expect(codexCtor).toHaveBeenCalledExactlyOnceWith(github)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(getCliProviderStatusMock).toHaveBeenCalledExactlyOnceWith('codex')
  })

  it('codex activo + CLI no disponible + GitHub real: LANZA diciendo que no se encontró el CLI', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'codex', model: 'gpt-5.5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    await expect(createAiService(makeGithub())).rejects.toThrow(/No se encontró el CLI «codex»/)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(codexCtor).not.toHaveBeenCalled()
  })
})
