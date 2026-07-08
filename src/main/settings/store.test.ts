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
})
