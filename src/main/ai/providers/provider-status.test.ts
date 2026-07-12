import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `provider-status.ts` delega TODO en `getCliProviderStatus` (T59: los tres
 * proveedores son `cli` desde que se eliminó OpenRouter) — se mockea esa
 * única dependencia para verificar el agregado sin spawnear procesos reales.
 */
const getCliProviderStatusMock = vi.fn()
vi.mock('./cli-probe', () => ({
  getCliProviderStatus: (...args: unknown[]) => getCliProviderStatusMock(...args),
}))

const { getAiProviderStatusMap } = await import('./provider-status')

describe('getAiProviderStatusMap', () => {
  afterEach(() => vi.clearAllMocks())

  it('delega los tres proveedores al probe de CLI', async () => {
    getCliProviderStatusMock.mockImplementation(async (provider: string) =>
      provider === 'claude-code'
        ? { status: 'authenticated', account: { plan: 'max' } }
        : { status: 'installed' },
    )

    const map = await getAiProviderStatusMap()

    expect(map).toEqual({
      'claude-code': { status: 'authenticated', account: { plan: 'max' } },
      codex: { status: 'installed' },
      opencode: { status: 'installed' },
    })
    expect(getCliProviderStatusMock).toHaveBeenCalledWith('claude-code')
    expect(getCliProviderStatusMock).toHaveBeenCalledWith('codex')
    expect(getCliProviderStatusMock).toHaveBeenCalledWith('opencode')
  })

  it('propaga "unavailable" tal cual lo reporte el probe', async () => {
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    const map = await getAiProviderStatusMap()

    expect(map['claude-code']).toEqual({ status: 'unavailable' })
    expect(map.codex).toEqual({ status: 'unavailable' })
    expect(map.opencode).toEqual({ status: 'unavailable' })
  })
})
