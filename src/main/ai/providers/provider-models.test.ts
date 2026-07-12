import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_PROVIDER_CATALOG } from '../../../shared/ai-providers'

/**
 * `getProviderModels` (T35; OpenCode en T57) delega a `fetchCodexModelCatalog`/
 * `fetchOpencodeModelCatalog` SOLO para esos dos proveedores (cada uno
 * cacheado con TTL, por separado); para el resto devuelve el catálogo curado
 * estático. Se mockean ambos módulos para no spawnear procesos/servers
 * reales y poder contar cuántas veces se llama cada uno (verificar el cache).
 */
const fetchCodexModelCatalogMock = vi.fn()
vi.mock('./codex-model-catalog', () => ({
  fetchCodexModelCatalog: (...args: unknown[]) => fetchCodexModelCatalogMock(...args),
}))

const fetchOpencodeModelCatalogMock = vi.fn()
vi.mock('./opencode-model-catalog', () => ({
  fetchOpencodeModelCatalog: (...args: unknown[]) => fetchOpencodeModelCatalogMock(...args),
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

  it('devuelve el catálogo curado ESTÁTICO para claude-code sin llamar a fetchCodexModelCatalog/fetchOpencodeModelCatalog', async () => {
    const claudeCode = await getProviderModels('claude-code')

    expect(claudeCode).toEqual(AI_PROVIDER_CATALOG['claude-code'].models)
    expect(fetchCodexModelCatalogMock).not.toHaveBeenCalled()
    expect(fetchOpencodeModelCatalogMock).not.toHaveBeenCalled()
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

  it('para opencode delega a fetchOpencodeModelCatalog', async () => {
    const fakeModels = [{ id: 'opencode/big-pickle', label: 'Big Pickle', vendor: 'OpenCode' }]
    fetchOpencodeModelCatalogMock.mockResolvedValue(fakeModels)

    const models = await getProviderModels('opencode')

    expect(models).toEqual(fakeModels)
    expect(fetchOpencodeModelCatalogMock).toHaveBeenCalledTimes(1)
  })

  it('cachea el resultado de opencode: llamadas seguidas dentro del TTL no vuelven a llamar a fetchOpencodeModelCatalog', async () => {
    fetchOpencodeModelCatalogMock.mockResolvedValue([{ id: 'opencode/big-pickle', label: 'Big Pickle', vendor: 'OpenCode' }])

    await getProviderModels('opencode')
    await getProviderModels('opencode')
    await getProviderModels('opencode')

    expect(fetchOpencodeModelCatalogMock).toHaveBeenCalledTimes(1)
  })

  it('vuelve a llamar a fetchOpencodeModelCatalog una vez expirado el TTL (60s)', async () => {
    fetchOpencodeModelCatalogMock.mockResolvedValue([{ id: 'opencode/big-pickle', label: 'Big Pickle', vendor: 'OpenCode' }])

    await getProviderModels('opencode')
    vi.advanceTimersByTime(60_001)
    await getProviderModels('opencode')

    expect(fetchOpencodeModelCatalogMock).toHaveBeenCalledTimes(2)
  })

  it('no cachea un rechazo de opencode: una llamada siguiente reintenta en vez de quedar atascada en error', async () => {
    fetchOpencodeModelCatalogMock.mockRejectedValueOnce(new Error('boom'))
    fetchOpencodeModelCatalogMock.mockResolvedValueOnce([
      { id: 'opencode/big-pickle', label: 'Big Pickle', vendor: 'OpenCode' },
    ])

    await expect(getProviderModels('opencode')).rejects.toThrow('boom')
    const second = await getProviderModels('opencode')

    expect(second).toEqual([{ id: 'opencode/big-pickle', label: 'Big Pickle', vendor: 'OpenCode' }])
    expect(fetchOpencodeModelCatalogMock).toHaveBeenCalledTimes(2)
  })

  it('codex y opencode se cachean de forma independiente (cache por proveedor)', async () => {
    fetchCodexModelCatalogMock.mockResolvedValue([{ id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' }])
    fetchOpencodeModelCatalogMock.mockResolvedValue([
      { id: 'opencode/big-pickle', label: 'Big Pickle', vendor: 'OpenCode' },
    ])

    await getProviderModels('codex')
    await getProviderModels('opencode')
    await getProviderModels('codex')
    await getProviderModels('opencode')

    expect(fetchCodexModelCatalogMock).toHaveBeenCalledTimes(1)
    expect(fetchOpencodeModelCatalogMock).toHaveBeenCalledTimes(1)
  })
})
