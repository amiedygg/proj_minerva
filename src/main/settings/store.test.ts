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
  })

  it('devuelve null si el archivo tiene JSON inválido (corrupto, sin crashear)', () => {
    writeFileSync(settingsFilePath(), '{ esto no es json', 'utf-8')
    const store = new SettingsStore()
    expect(store.getPersistedAiModel()).toBeNull()
  })

  it('devuelve null si el JSON es válido pero no tiene aiModel', () => {
    writeFileSync(settingsFilePath(), JSON.stringify({}), 'utf-8')
    const store = new SettingsStore()
    expect(store.getPersistedAiModel()).toBeNull()
  })

  it('devuelve null si aiModel no es un string no vacío', () => {
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

  it('escribe settings.json en JSON plano/pretty sin dejar el archivo .tmp', () => {
    new SettingsStore().setAiModel('z-ai/glm-5.2')

    const raw = readFileSync(settingsFilePath(), 'utf-8')
    expect(JSON.parse(raw)).toEqual({ aiModel: 'z-ai/glm-5.2' })
    expect(raw).toContain('\n') // pretty-printed, no todo en una línea
    expect(existsSync(settingsFilePath() + '.tmp')).toBe(false)
  })
})
