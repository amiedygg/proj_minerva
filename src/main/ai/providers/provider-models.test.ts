import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_PROVIDER_CATALOG } from '../../../shared/ai-providers'

/**
 * `getProviderModels` (T35) delega a `fetchCodexModelCatalog` SOLO para
 * Codex (cacheado con TTL); para el resto devuelve el catálogo curado
 * estático. Se mockea `./codex-model-catalog` para no spawnear procesos
 * reales y poder contar cuántas veces se llama (verificar el cache).
 */
const fetchCodexModelCatalogMock = vi.fn()
vi.mock('./codex-model-catalog', () => ({
  fetchCodexModelCatalog: (...args: unknown[]) => fetchCodexModelCatalogMock(...args),
}))

const { getProviderModels, clearProviderModelsCache } = await import('./provider-models')

describe('getProviderModels', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearProviderModelsCache()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('devuelve el catálogo curado ESTÁTICO para openrouter/claude-code sin llamar a fetchCodexModelCatalog', async () => {
    const openrouter = await getProviderModels('openrouter')
    const claudeCode = await getProviderModels('claude-code')

    expect(openrouter).toEqual(AI_PROVIDER_CATALOG.openrouter.models)
    expect(claudeCode).toEqual(AI_PROVIDER_CATALOG['claude-code'].models)
    expect(fetchCodexModelCatalogMock).not.toHaveBeenCalled()
  })

  it('para codex delega a fetchCodexModelCatalog', async () => {
    const fakeModels = [{ id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' }]
    fetchCodexModelCatalogMock.mockResolvedValue(fakeModels)

    const models = await getProviderModels('codex')

    expect(models).toEqual(fakeModels)
    expect(fetchCodexModelCatalogMock).toHaveBeenCalledTimes(1)
  })

  it('cachea el resultado de codex: llamadas seguidas dentro del TTL no vuelven a llamar a fetchCodexModelCatalog', async () => {
    fetchCodexModelCatalogMock.mockResolvedValue([{ id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' }])

    await getProviderModels('codex')
    await getProviderModels('codex')
    await getProviderModels('codex')

    expect(fetchCodexModelCatalogMock).toHaveBeenCalledTimes(1)
  })

  it('vuelve a llamar a fetchCodexModelCatalog una vez expirado el TTL (60s)', async () => {
    fetchCodexModelCatalogMock.mockResolvedValue([{ id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' }])

    await getProviderModels('codex')
    vi.advanceTimersByTime(60_001)
    await getProviderModels('codex')

    expect(fetchCodexModelCatalogMock).toHaveBeenCalledTimes(2)
  })

  it('no cachea un rechazo: una llamada siguiente reintenta en vez de quedar atascada en error', async () => {
    fetchCodexModelCatalogMock.mockRejectedValueOnce(new Error('boom'))
    fetchCodexModelCatalogMock.mockResolvedValueOnce([{ id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' }])

    await expect(getProviderModels('codex')).rejects.toThrow('boom')
    const second = await getProviderModels('codex')

    expect(second).toEqual([{ id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' }])
    expect(fetchCodexModelCatalogMock).toHaveBeenCalledTimes(2)
  })
})
