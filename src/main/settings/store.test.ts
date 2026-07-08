import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `SettingsStore` usa `app.getPath('userData')` (Electron). Fuera de un
 * proceso Electron real, `require('electron')` resuelve a la ruta del
 * binario (string), no al objeto de la API — sin este mock, `app.getPath`
 * lanzaría "app.getPath is not a function". Se mockea con un directorio
 * temporal real por test (no memfs) para poder probar lectura/escritura de
 * archivo de punta a punta, incluida la escritura atómica.
 */
let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error('getPath inesperado: ' + name)
      return userDataDir
    },
  },
}))

const { SettingsStore } = await import('./store')

function settingsFilePath(): string {
  return join(userDataDir, 'settings.json')
}

describe('SettingsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'minerva-settings-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('devuelve null si no hay settings.json (defaults, sin crashear)', () => {
    const store = new SettingsStore()
    expect(store.getPersistedAiModel()).toBeNull()
    expect(store.getPersistedSettings()).toBeNull()
  })

  it('devuelve null si el archivo tiene JSON inválido (corrupto, sin crashear)', () => {
    writeFileSync(settingsFilePath(), '{ esto no es json', 'utf-8')
    const store = new SettingsStore()
    expect(store.getPersistedAiModel()).toBeNull()
  })

  it('devuelve null si el JSON es válido pero no tiene ni aiModel ni aiProvider/models', () => {
    writeFileSync(settingsFilePath(), JSON.stringify({}), 'utf-8')
    const store = new SettingsStore()
    expect(store.getPersistedAiModel()).toBeNull()
  })

  it('devuelve null si aiModel (forma vieja) no es un string no vacío', () => {
    writeFileSync(settingsFilePath(), JSON.stringify({ aiModel: 42 }), 'utf-8')
    expect(new SettingsStore().getPersistedAiModel()).toBeNull()

    writeFileSync(settingsFilePath(), JSON.stringify({ aiModel: '' }), 'utf-8')
    expect(new SettingsStore().getPersistedAiModel()).toBeNull()
  })

  it('devuelve null si el contenido es un array o un primitivo (no objeto)', () => {
    writeFileSync(settingsFilePath(), JSON.stringify(['aiModel']), 'utf-8')
    expect(new SettingsStore().getPersistedAiModel()).toBeNull()

    writeFileSync(settingsFilePath(), JSON.stringify('z-ai/glm-5.2'), 'utf-8')
    expect(new SettingsStore().getPersistedAiModel()).toBeNull()
  })

  it('devuelve null si aiProvider (forma nueva) no es un proveedor conocido', () => {
    writeFileSync(
      settingsFilePath(),
      JSON.stringify({ aiProvider: 'gemini-cli', models: {} }),
      'utf-8',
    )
    expect(new SettingsStore().getPersistedSettings()).toBeNull()
  })

  it('devuelve null si "models" (forma nueva) tiene una clave que no es un proveedor conocido', () => {
    writeFileSync(
      settingsFilePath(),
      JSON.stringify({ aiProvider: 'openrouter', models: { 'not-a-provider': 'x' } }),
      'utf-8',
    )
    expect(new SettingsStore().getPersistedSettings()).toBeNull()
  })

  it('roundtrip: setAiModel + getPersistedAiModel en la misma instancia (cache)', () => {
    const store = new SettingsStore()
    expect(store.getPersistedAiModel()).toBeNull()

    store.setAiModel('anthropic/claude-opus-4.8')
    expect(store.getPersistedAiModel()).toBe('anthropic/claude-opus-4.8')
  })

  it('roundtrip: una instancia nueva (simulando reinicio de la app) lee lo persistido en disco', () => {
    new SettingsStore().setAiModel('google/gemini-3.5-flash')

    const restarted = new SettingsStore()
    expect(restarted.getPersistedAiModel()).toBe('google/gemini-3.5-flash')
  })

  it('setAiModel sobreescribe un valor persistido previamente (último guardado gana)', () => {
    const store = new SettingsStore()
    store.setAiModel('openai/gpt-5.5')
    store.setAiModel('moonshotai/kimi-k2.7-code')
    expect(store.getPersistedAiModel()).toBe('moonshotai/kimi-k2.7-code')

    const restarted = new SettingsStore()
    expect(restarted.getPersistedAiModel()).toBe('moonshotai/kimi-k2.7-code')
  })

  it('escribe settings.json en la forma nueva (aiProvider + models), plano/pretty, sin dejar el archivo .tmp', () => {
    new SettingsStore().setAiModel('z-ai/glm-5.2')

    const raw = readFileSync(settingsFilePath(), 'utf-8')
    expect(JSON.parse(raw)).toEqual({
      aiProvider: 'openrouter',
      models: { openrouter: 'z-ai/glm-5.2' },
    })
    expect(raw).toContain('\n') // pretty-printed, no todo en una línea
    expect(existsSync(settingsFilePath() + '.tmp')).toBe(false)
  })

  describe('migración de la forma vieja ({ aiModel }, pre-T26)', () => {
    it('lee un settings.json viejo como OpenRouter + ese modelo, sin perder la selección', () => {
      writeFileSync(settingsFilePath(), JSON.stringify({ aiModel: 'z-ai/glm-5.2' }), 'utf-8')

      const store = new SettingsStore()
      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'openrouter',
        models: { openrouter: 'z-ai/glm-5.2' },
      })
      expect(store.getPersistedAiModel()).toBe('z-ai/glm-5.2')
      expect(store.getPersistedModel('openrouter')).toBe('z-ai/glm-5.2')
      expect(store.getPersistedModel('claude-code')).toBeNull()
    })

    it('la migración es solo in-memory: no reescribe el settings.json viejo en disco hasta el próximo set*', () => {
      writeFileSync(settingsFilePath(), JSON.stringify({ aiModel: 'openai/gpt-5.5' }), 'utf-8')

      const store = new SettingsStore()
      store.getPersistedSettings() // fuerza la carga/migración in-memory

      const raw = readFileSync(settingsFilePath(), 'utf-8')
      expect(JSON.parse(raw)).toEqual({ aiModel: 'openai/gpt-5.5' })
    })

    it('tras leer la forma vieja, setProviderModel para otro proveedor conserva el modelo migrado de OpenRouter', () => {
      writeFileSync(settingsFilePath(), JSON.stringify({ aiModel: 'openai/gpt-5.5' }), 'utf-8')

      const store = new SettingsStore()
      store.setProviderModel('claude-code', 'claude-sonnet-5')

      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'openrouter',
        models: { openrouter: 'openai/gpt-5.5', 'claude-code': 'claude-sonnet-5' },
      })
    })
  })

  describe('setAiProvider / setProviderModel (T26)', () => {
    it('setAiProvider cambia el proveedor activo sin tocar los modelos ya elegidos', () => {
      const store = new SettingsStore()
      store.setProviderModel('openrouter', 'z-ai/glm-5.2')
      store.setProviderModel('claude-code', 'claude-sonnet-5')
      store.setAiProvider('claude-code')

      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'claude-code',
        models: { openrouter: 'z-ai/glm-5.2', 'claude-code': 'claude-sonnet-5' },
      })
    })

    it('setProviderModel para un proveedor no activo no cambia el proveedor activo', () => {
      const store = new SettingsStore()
      store.setAiProvider('openrouter')
      store.setProviderModel('codex', 'gpt-5.5-codex')

      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'openrouter',
        models: { codex: 'gpt-5.5-codex' },
      })
    })

    it('setProviderModel sobreescribe solo el modelo de ESE proveedor (último guardado gana por proveedor)', () => {
      const store = new SettingsStore()
      store.setProviderModel('openrouter', 'openai/gpt-5.5')
      store.setProviderModel('openrouter', 'z-ai/glm-5.2')
      store.setProviderModel('claude-code', 'claude-opus-4-8')

      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'openrouter',
        models: { openrouter: 'z-ai/glm-5.2', 'claude-code': 'claude-opus-4-8' },
      })
    })

    it('roundtrip tras "reinicio": una instancia nueva lee proveedor y modelos persistidos', () => {
      const store = new SettingsStore()
      store.setProviderModel('codex', 'gpt-5.5-codex')
      store.setAiProvider('codex')

      const restarted = new SettingsStore()
      expect(restarted.getPersistedSettings()).toEqual({
        aiProvider: 'codex',
        models: { codex: 'gpt-5.5-codex' },
      })
    })
  })

  describe('modelOptions (T34): migración aditiva + setModelOption', () => {
    it('un settings.json de la forma T26 (sin "modelOptions") se lee OK, sin opciones (default = {})', () => {
      writeFileSync(
        settingsFilePath(),
        JSON.stringify({ aiProvider: 'openrouter', models: { openrouter: 'z-ai/glm-5.2' } }),
        'utf-8',
      )

      const store = new SettingsStore()
      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'openrouter',
        models: { openrouter: 'z-ai/glm-5.2' },
      })
      expect(store.getPersistedModelOptions('openrouter')).toEqual({})
    })

    it('la migración legacy ({ aiModel }, pre-T26) sigue funcionando igual con el guard extendido para "modelOptions"', () => {
      writeFileSync(settingsFilePath(), JSON.stringify({ aiModel: 'z-ai/glm-5.2' }), 'utf-8')

      const store = new SettingsStore()
      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'openrouter',
        models: { openrouter: 'z-ai/glm-5.2' },
      })
      expect(store.getPersistedModelOptions('openrouter')).toEqual({})
    })

    it('devuelve null si "modelOptions" tiene una clave de proveedor desconocida', () => {
      writeFileSync(
        settingsFilePath(),
        JSON.stringify({
          aiProvider: 'openrouter',
          models: {},
          modelOptions: { 'not-a-provider': { effort: 'high' } },
        }),
        'utf-8',
      )
      expect(new SettingsStore().getPersistedSettings()).toBeNull()
    })

    it('devuelve null si "modelOptions[provider]" tiene un valor no-string', () => {
      writeFileSync(
        settingsFilePath(),
        JSON.stringify({
          aiProvider: 'codex',
          models: {},
          modelOptions: { codex: { effort: 42 } },
        }),
        'utf-8',
      )
      expect(new SettingsStore().getPersistedSettings()).toBeNull()
    })

    it('getPersistedModelOptions devuelve {} si no hay nada guardado para ESE proveedor', () => {
      const store = new SettingsStore()
      store.setModelOption('codex', 'effort', 'high')

      expect(store.getPersistedModelOptions('codex')).toEqual({ effort: 'high' })
      expect(store.getPersistedModelOptions('claude-code')).toEqual({})
    })

    it('setModelOption crea el sub-objeto del proveedor y no pisa opciones de otros proveedores/otras claves', () => {
      const store = new SettingsStore()
      store.setModelOption('claude-code', 'effort', 'max')
      store.setModelOption('codex', 'effort', 'low')
      store.setModelOption('claude-code', 'effort', 'xhigh') // último gana para esa clave

      expect(store.getPersistedModelOptions('claude-code')).toEqual({ effort: 'xhigh' })
      expect(store.getPersistedModelOptions('codex')).toEqual({ effort: 'low' })
    })

    it('setModelOption no toca el proveedor activo ni los modelos ya elegidos', () => {
      const store = new SettingsStore()
      store.setProviderModel('claude-code', 'claude-sonnet-5')
      store.setAiProvider('claude-code')
      store.setModelOption('claude-code', 'effort', 'high')

      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'claude-code',
        models: { 'claude-code': 'claude-sonnet-5' },
        modelOptions: { 'claude-code': { effort: 'high' } },
      })
    })

    it('setAiProvider/setProviderModel preservan modelOptions ya guardadas', () => {
      const store = new SettingsStore()
      store.setModelOption('codex', 'effort', 'high')
      store.setProviderModel('openrouter', 'z-ai/glm-5.2')
      store.setAiProvider('openrouter')

      expect(store.getPersistedModelOptions('codex')).toEqual({ effort: 'high' })
    })

    it('roundtrip tras "reinicio": una instancia nueva lee modelOptions persistidas', () => {
      const store = new SettingsStore()
      store.setModelOption('codex', 'effort', 'xhigh')

      const restarted = new SettingsStore()
      expect(restarted.getPersistedModelOptions('codex')).toEqual({ effort: 'xhigh' })
    })
  })
})
