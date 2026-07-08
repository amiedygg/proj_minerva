import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `provider-status.ts` combina `getAiEnv` (OpenRouter, síncrono) con
 * `getCliProviderStatus` (Claude Code/Codex, probe de CLI) — se mockean
 * ambas dependencias para verificar el agregado sin spawnear procesos reales
 * ni depender de si hay `OPENROUTER_API_KEY` en el entorno que corre los
 * tests.
 */
const getAiEnvMock = vi.fn()
vi.mock('../env', () => ({ getAiEnv: (...args: unknown[]) => getAiEnvMock(...args) }))

const getCliProviderStatusMock = vi.fn()
vi.mock('./cli-probe', () => ({
  getCliProviderStatus: (...args: unknown[]) => getCliProviderStatusMock(...args),
}))

const { getAiProviderStatusMap } = await import('./provider-status')

describe('getAiProviderStatusMap', () => {
  afterEach(() => vi.clearAllMocks())

  it('openrouter authenticated (hay key) y delega claude-code/codex al probe de CLI', async () => {
    getAiEnvMock.mockReturnValue({ openRouterApiKey: 'sk-x', aiModel: 'z-ai/glm-5.2' })
    getCliProviderStatusMock.mockImplementation(async (provider: string) =>
      provider === 'claude-code'
        ? { status: 'authenticated', account: { plan: 'max' } }
        : { status: 'installed' },
    )

    const map = await getAiProviderStatusMap()

    expect(map).toEqual({
      openrouter: { status: 'authenticated' },
      'claude-code': { status: 'authenticated', account: { plan: 'max' } },
      codex: { status: 'installed' },
    })
    expect(getCliProviderStatusMock).toHaveBeenCalledWith('claude-code')
    expect(getCliProviderStatusMock).toHaveBeenCalledWith('codex')
  })

  it('openrouter unavailable cuando no hay key configurada', async () => {
    getAiEnvMock.mockReturnValue({ openRouterApiKey: null, aiModel: 'z-ai/glm-5.2' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    const map = await getAiProviderStatusMap()

    expect(map.openrouter).toEqual({ status: 'unavailable' })
  })

  it('nunca invoca el probe de CLI para openrouter (no es un CLI)', async () => {
    getAiEnvMock.mockReturnValue({ openRouterApiKey: 'sk-x', aiModel: 'z-ai/glm-5.2' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'installed' })

    await getAiProviderStatusMap()

    expect(getCliProviderStatusMock).not.toHaveBeenCalledWith('openrouter')
  })
})
