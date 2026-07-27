import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `getProviderModels` (T35; OpenCode en T57; Claude Code en F19) delega en el
 * fetcher dinámico de CADA proveedor, cacheado con TTL por separado. Se mockean
 * los tres módulos para no spawnear procesos/servers reales y poder contar
 * cuántas veces se llama cada uno (verificar el cache).
 */
const fetchClaudeCodeModelCatalogMock = vi.fn()
vi.mock('./claude-code-model-catalog', () => ({
  fetchClaudeCodeModelCatalog: (...args: unknown[]) => fetchClaudeCodeModelCatalogMock(...args),
}))

const fetchCodexModelCatalogMock = vi.fn()
vi.mock('./codex-model-catalog', () => ({
  fetchCodexModelCatalog: (...args: unknown[]) => fetchCodexModelCatalogMock(...args),
}))

const fetchOpencodeModelCatalogMock = vi.fn()
vi.mock('./opencode-model-catalog', () => ({
  fetchOpencodeModelCatalog: (...args: unknown[]) => fetchOpencodeModelCatalogMock(...args),
}))

const { getProviderModels, warmProviderModels, clearProviderModelsCache } = await import(
  './provider-models'
)
const { getSnapshotProviderModels, clearProviderModelsSnapshot } = await import(
  './model-catalog-snapshot'
)

describe('getProviderModels', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearProviderModelsCache()
    clearProviderModelsSnapshot()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('para claude-code delega a fetchClaudeCodeModelCatalog (F19: ya no sirve el catálogo estático)', async () => {
    const fakeModels = [{ id: 'opus[1m]', label: 'Opus (1M context)', vendor: 'Anthropic' }]
    fetchClaudeCodeModelCatalogMock.mockResolvedValue(fakeModels)

    const models = await getProviderModels('claude-code')

    expect(models).toEqual(fakeModels)
    expect(fetchClaudeCodeModelCatalogMock).toHaveBeenCalledTimes(1)
    expect(fetchCodexModelCatalogMock).not.toHaveBeenCalled()
    expect(fetchOpencodeModelCatalogMock).not.toHaveBeenCalled()
  })

  it('cachea el resultado de claude-code: llamadas seguidas dentro del TTL no vuelven a spawnear el CLI', async () => {
    fetchClaudeCodeModelCatalogMock.mockResolvedValue([{ id: 'sonnet', label: 'Sonnet', vendor: 'Anthropic' }])

    await getProviderModels('claude-code')
    await getProviderModels('claude-code')
    vi.advanceTimersByTime(60_001)
    await getProviderModels('claude-code')

    expect(fetchClaudeCodeModelCatalogMock).toHaveBeenCalledTimes(2)
  })

  it('deposita el resultado en el snapshot síncrono que lee la resolución de opciones (F19)', async () => {
    const fakeModels = [{ id: 'sonnet', label: 'Sonnet', vendor: 'Anthropic', aliasFor: 'claude-sonnet-5' }]
    fetchClaudeCodeModelCatalogMock.mockResolvedValue(fakeModels)

    expect(getSnapshotProviderModels('claude-code')).toBeUndefined()
    await getProviderModels('claude-code')

    expect(getSnapshotProviderModels('claude-code')).toEqual(fakeModels)
  })

  it('warmProviderModels no propaga el rechazo del fetcher (best-effort)', async () => {
    fetchClaudeCodeModelCatalogMock.mockRejectedValueOnce(new Error('boom'))

    await expect(warmProviderModels('claude-code')).resolves.toBeUndefined()
    expect(getSnapshotProviderModels('claude-code')).toBeUndefined()
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

  it('los tres proveedores se cachean de forma independiente (cache por proveedor)', async () => {
    fetchClaudeCodeModelCatalogMock.mockResolvedValue([{ id: 'sonnet', label: 'Sonnet', vendor: 'Anthropic' }])
    fetchCodexModelCatalogMock.mockResolvedValue([{ id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' }])
    fetchOpencodeModelCatalogMock.mockResolvedValue([
      { id: 'opencode/big-pickle', label: 'Big Pickle', vendor: 'OpenCode' },
    ])

    await getProviderModels('claude-code')
    await getProviderModels('codex')
    await getProviderModels('opencode')
    await getProviderModels('claude-code')
    await getProviderModels('codex')
    await getProviderModels('opencode')

    expect(fetchClaudeCodeModelCatalogMock).toHaveBeenCalledTimes(1)
    expect(fetchCodexModelCatalogMock).toHaveBeenCalledTimes(1)
    expect(fetchOpencodeModelCatalogMock).toHaveBeenCalledTimes(1)
  })
})
