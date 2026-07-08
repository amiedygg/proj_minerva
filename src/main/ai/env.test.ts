import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `getEffectiveAiSelection`/`getEffectiveAiModel` consultan `settingsStore`
 * (`../settings/store.ts`), que a su vez usa `app.getPath('userData')`
 * (Electron) — mockear el módulo entero en vez de solo `electron` deja
 * controlar exactamente qué "hay persistido" por test (`vi.mocked(...)
 * .mockReturnValue(...)`), sin depender de un `settings.json` real en disco
 * ni pelear con la cache interna del singleton `settingsStore` (que solo
 * carga una vez por proceso).
 */
vi.mock('../settings/store', () => ({
  settingsStore: {
    getPersistedSettings: vi.fn(() => null),
    getPersistedAiModel: vi.fn(() => null),
  },
}))

/**
 * `getAiEnv`/`getOpenRouterKeyStatus` (T32) consultan `./openrouter-key-store.ts`
 * (`loadApiKey`), que a su vez usa `safeStorage`/`app.getPath` de Electron —
 * se mockea el módulo entero (mismo criterio que `../settings/store` arriba)
 * para controlar por test si "hay" o no una key guardada, sin pelear con
 * Electron real.
 */
vi.mock('./openrouter-key-store', () => ({
  loadApiKey: vi.fn(() => null),
}))

const { getAiEnv, getEffectiveAiModel, getEffectiveAiSelection, getOpenRouterKeyStatus, parseDotEnv } =
  await import('./env')
const { settingsStore } = await import('../settings/store')
const { loadApiKey } = await import('./openrouter-key-store')

describe('parseDotEnv', () => {
  it('parsea pares KEY=VALUE simples', () => {
    expect(
      parseDotEnv('OPENROUTER_API_KEY=sk-abc123\nMINERVA_AI_MODEL=anthropic/claude-sonnet-4.5'),
    ).toEqual({
      OPENROUTER_API_KEY: 'sk-abc123',
      MINERVA_AI_MODEL: 'anthropic/claude-sonnet-4.5',
    })
  })

  it('ignora comentarios y líneas vacías', () => {
    const content = [
      '# comentario de cabecera',
      '',
      'OPENROUTER_API_KEY=sk-abc123',
      '  # otro comentario indentado',
      '',
      'MINERVA_AI_MODEL=openai/gpt-5',
    ].join('\n')

    expect(parseDotEnv(content)).toEqual({
      OPENROUTER_API_KEY: 'sk-abc123',
      MINERVA_AI_MODEL: 'openai/gpt-5',
    })
  })

  it('recorta espacios alrededor de key y value', () => {
    expect(parseDotEnv('  OPENROUTER_API_KEY  =   sk-abc123  ')).toEqual({
      OPENROUTER_API_KEY: 'sk-abc123',
    })
  })

  it('quita comillas dobles o simples que envuelven el valor completo', () => {
    expect(parseDotEnv('A="hello world"\nB=\'single quoted\'')).toEqual({
      A: 'hello world',
      B: 'single quoted',
    })
  })

  it('no quita comillas que no envuelven todo el valor', () => {
    expect(parseDotEnv('A=hello "world"')).toEqual({ A: 'hello "world"' })
  })

  it('ignora líneas sin "="', () => {
    expect(parseDotEnv('no es una línea válida\nOPENROUTER_API_KEY=sk-abc123')).toEqual({
      OPENROUTER_API_KEY: 'sk-abc123',
    })
  })

  it('permite valores vacíos', () => {
    expect(parseDotEnv('EMPTY=')).toEqual({ EMPTY: '' })
  })

  it('devuelve objeto vacío para contenido vacío', () => {
    expect(parseDotEnv('')).toEqual({})
  })

  it('un "=" dentro del valor no rompe el parseo (solo el primero separa key/value)', () => {
    expect(parseDotEnv('MINERVA_AI_MODEL=anthropic/claude-sonnet-4.5?x=1')).toEqual({
      MINERVA_AI_MODEL: 'anthropic/claude-sonnet-4.5?x=1',
    })
  })
})

describe('getEffectiveAiSelection (T26, precedencia proveedor+modelo)', () => {
  beforeEach(() => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue(null)
    vi.mocked(settingsStore.getPersistedAiModel).mockReturnValue(null)
  })

  afterEach(() => {
    delete process.env.MINERVA_AI_PROVIDER
    delete process.env.MINERVA_AI_MODEL
    vi.clearAllMocks()
  })

  it('sin nada persistido ni en el entorno, cae al default del catálogo (OpenRouter + su modelo default)', () => {
    expect(getEffectiveAiSelection()).toEqual({ provider: 'openrouter', model: 'z-ai/glm-5.2' })
  })

  it('MINERVA_AI_PROVIDER + MINERVA_AI_MODEL del entorno ganan sobre el default cuando no hay settings', () => {
    process.env.MINERVA_AI_PROVIDER = 'claude-code'
    process.env.MINERVA_AI_MODEL = 'claude-opus-4-8'

    expect(getEffectiveAiSelection()).toEqual({ provider: 'claude-code', model: 'claude-opus-4-8' })
  })

  it('un MINERVA_AI_PROVIDER desconocido se ignora y cae al proveedor default', () => {
    process.env.MINERVA_AI_PROVIDER = 'gemini-cli'

    expect(getEffectiveAiSelection().provider).toBe('openrouter')
  })

  it('settings.json (aiProvider + su modelo) gana sobre el entorno', () => {
    process.env.MINERVA_AI_PROVIDER = 'codex'
    process.env.MINERVA_AI_MODEL = 'gpt-5.5-codex'
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'claude-sonnet-5' },
    })

    expect(getEffectiveAiSelection()).toEqual({ provider: 'claude-code', model: 'claude-sonnet-5' })
  })

  it('si el proveedor persistido no tiene modelo propio persistido, el modelo cae a MINERVA_AI_MODEL (aplicado al proveedor YA resuelto)', () => {
    process.env.MINERVA_AI_MODEL = 'claude-haiku-4-5'
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: {},
    })

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'claude-code',
      model: 'claude-haiku-4-5',
    })
  })

  it('si el proveedor persistido no tiene modelo propio ni hay MINERVA_AI_MODEL, cae al default de ESE proveedor', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'codex',
      models: {},
    })

    expect(getEffectiveAiSelection()).toEqual({ provider: 'codex', model: 'gpt-5.5' })
  })
})

describe('getEffectiveAiModel (shim de compatibilidad pre-T26, OpenRouter-only)', () => {
  afterEach(() => {
    delete process.env.MINERVA_AI_MODEL
    vi.clearAllMocks()
  })

  it('usa MINERVA_AI_MODEL del entorno cuando no hay nada persistido de OpenRouter', () => {
    vi.mocked(settingsStore.getPersistedAiModel).mockReturnValue(null)
    process.env.MINERVA_AI_MODEL = 'anthropic/claude-sonnet-4.5'

    expect(getEffectiveAiModel()).toEqual({
      aiModel: 'anthropic/claude-sonnet-4.5',
      aiModelSource: 'env',
    })
  })

  it('el modelo persistido de OpenRouter gana sobre el entorno', () => {
    vi.mocked(settingsStore.getPersistedAiModel).mockReturnValue('z-ai/glm-5.2')
    process.env.MINERVA_AI_MODEL = 'anthropic/claude-sonnet-4.5'

    expect(getEffectiveAiModel()).toEqual({ aiModel: 'z-ai/glm-5.2', aiModelSource: 'settings' })
  })
})

describe('getAiEnv / getOpenRouterKeyStatus (T32, precedencia de la key de OpenRouter)', () => {
  beforeEach(() => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue(null)
    vi.mocked(settingsStore.getPersistedAiModel).mockReturnValue(null)
    vi.mocked(loadApiKey).mockReturnValue(null)
  })

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY
    vi.clearAllMocks()
  })

  it('sin key en safeStorage ni en el entorno, openRouterApiKey es null y el status es "none"', () => {
    expect(getAiEnv().openRouterApiKey).toBeNull()
    expect(getOpenRouterKeyStatus()).toEqual({ configured: false, source: 'none' })
  })

  it('OPENROUTER_API_KEY del entorno se usa si no hay key en safeStorage', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-from-env'

    expect(getAiEnv().openRouterApiKey).toBe('sk-or-from-env')
    expect(getOpenRouterKeyStatus()).toEqual({ configured: true, source: 'env' })
  })

  it('la key guardada en safeStorage gana sobre OPENROUTER_API_KEY del entorno', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-from-env'
    vi.mocked(loadApiKey).mockReturnValue('sk-or-from-safe-storage')

    expect(getAiEnv().openRouterApiKey).toBe('sk-or-from-safe-storage')
    expect(getOpenRouterKeyStatus()).toEqual({ configured: true, source: 'safeStorage' })
  })

  it('una key en safeStorage vacía o solo espacios se ignora, cayendo al entorno', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-from-env'
    vi.mocked(loadApiKey).mockReturnValue('   ')

    expect(getAiEnv().openRouterApiKey).toBe('sk-or-from-env')
    expect(getOpenRouterKeyStatus()).toEqual({ configured: true, source: 'env' })
  })

  it('la key de safeStorage se recorta (trim) antes de usarse', () => {
    vi.mocked(loadApiKey).mockReturnValue('  sk-or-padded  ')

    expect(getAiEnv().openRouterApiKey).toBe('sk-or-padded')
  })
})
