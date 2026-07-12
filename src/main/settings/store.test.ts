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

function orphanedOpenRouterKeyFilePath(): string {
  return join(userDataDir, 'openrouter-key.bin')
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
    expect(store.getPersistedSettings()).toBeNull()
    expect(store.getPersistedModel('opencode')).toBeNull()
  })

  it('devuelve null si el archivo tiene JSON inválido (corrupto, sin crashear)', () => {
    writeFileSync(settingsFilePath(), '{ esto no es json', 'utf-8')
    const store = new SettingsStore()
    expect(store.getPersistedSettings()).toBeNull()
  })

  it('devuelve null si el JSON es válido pero no tiene ni aiModel ni aiProvider/models', () => {
    writeFileSync(settingsFilePath(), JSON.stringify({}), 'utf-8')
    const store = new SettingsStore()
    expect(store.getPersistedSettings()).toBeNull()
  })

  it('devuelve null si aiModel (forma vieja) no es un string no vacío', () => {
    writeFileSync(settingsFilePath(), JSON.stringify({ aiModel: 42 }), 'utf-8')
    expect(new SettingsStore().getPersistedSettings()).toBeNull()

    writeFileSync(settingsFilePath(), JSON.stringify({ aiModel: '' }), 'utf-8')
    expect(new SettingsStore().getPersistedSettings()).toBeNull()
  })

  it('devuelve null si el contenido es un array o un primitivo (no objeto)', () => {
    writeFileSync(settingsFilePath(), JSON.stringify(['aiModel']), 'utf-8')
    expect(new SettingsStore().getPersistedSettings()).toBeNull()

    writeFileSync(settingsFilePath(), JSON.stringify('z-ai/glm-5.2'), 'utf-8')
    expect(new SettingsStore().getPersistedSettings()).toBeNull()
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
      JSON.stringify({ aiProvider: 'codex', models: { 'not-a-provider': 'x' } }),
      'utf-8',
    )
    expect(new SettingsStore().getPersistedSettings()).toBeNull()
  })

  it('roundtrip: setProviderModel + getPersistedModel en la misma instancia (cache)', () => {
    const store = new SettingsStore()
    expect(store.getPersistedModel('opencode')).toBeNull()

    store.setProviderModel('opencode', 'anthropic/claude-opus-4-8')
    expect(store.getPersistedModel('opencode')).toBe('anthropic/claude-opus-4-8')
  })

  it('roundtrip: una instancia nueva (simulando reinicio de la app) lee lo persistido en disco', () => {
    new SettingsStore().setProviderModel('opencode', 'google/gemini-3.5-flash')

    const restarted = new SettingsStore()
    expect(restarted.getPersistedModel('opencode')).toBe('google/gemini-3.5-flash')
  })

  it('setProviderModel sobreescribe un valor persistido previamente para el mismo proveedor (último guardado gana)', () => {
    const store = new SettingsStore()
    store.setProviderModel('opencode', 'openai/gpt-5.5')
    store.setProviderModel('opencode', 'moonshotai/kimi-k2.7-code')
    expect(store.getPersistedModel('opencode')).toBe('moonshotai/kimi-k2.7-code')

    const restarted = new SettingsStore()
    expect(restarted.getPersistedModel('opencode')).toBe('moonshotai/kimi-k2.7-code')
  })

  it('escribe settings.json en la forma nueva (aiProvider + models), plano/pretty, sin dejar el archivo .tmp', () => {
    new SettingsStore().setProviderModel('opencode', 'opencode/big-pickle')

    const raw = readFileSync(settingsFilePath(), 'utf-8')
    expect(JSON.parse(raw)).toEqual({
      aiProvider: 'opencode',
      models: { opencode: 'opencode/big-pickle' },
    })
    expect(raw).toContain('\n') // pretty-printed, no todo en una línea
    expect(existsSync(settingsFilePath() + '.tmp')).toBe(false)
  })

  describe('migración: OpenRouter eliminado como proveedor (T59)', () => {
    it('settings.json viejo ({ aiModel }, pre-T26) migra a OpenCode con el slug de upstream openrouter, y PERSISTE el resultado', () => {
      writeFileSync(settingsFilePath(), JSON.stringify({ aiModel: 'z-ai/glm-5.2' }), 'utf-8')

      const store = new SettingsStore()
      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'opencode',
        models: { opencode: 'openrouter/z-ai/glm-5.2' },
      })
      expect(store.getPersistedModel('opencode')).toBe('openrouter/z-ai/glm-5.2')
      expect(store.getPersistedModel('claude-code')).toBeNull()

      // A diferencia de la migración pre-T26 (que quedaba solo en memoria),
      // T59 SÍ reescribe settings.json de inmediato.
      const raw = readFileSync(settingsFilePath(), 'utf-8')
      expect(JSON.parse(raw)).toEqual({
        aiProvider: 'opencode',
        models: { opencode: 'openrouter/z-ai/glm-5.2' },
      })
    })

    it('settings.json con aiProvider "openrouter" (forma T26) migra a OpenCode, preservando modelos de otros proveedores, y PERSISTE', () => {
      writeFileSync(
        settingsFilePath(),
        JSON.stringify({
          aiProvider: 'openrouter',
          models: { openrouter: 'openai/gpt-5.5', 'claude-code': 'claude-sonnet-5' },
        }),
        'utf-8',
      )

      const store = new SettingsStore()
      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'opencode',
        models: { opencode: 'openrouter/openai/gpt-5.5', 'claude-code': 'claude-sonnet-5' },
      })

      const raw = readFileSync(settingsFilePath(), 'utf-8')
      expect(JSON.parse(raw)).toEqual({
        aiProvider: 'opencode',
        models: { opencode: 'openrouter/openai/gpt-5.5', 'claude-code': 'claude-sonnet-5' },
      })
    })

    it('si ya hay un modelo real de OpenCode guardado, la migración NO lo pisa con el de OpenRouter', () => {
      writeFileSync(
        settingsFilePath(),
        JSON.stringify({
          aiProvider: 'openrouter',
          models: { openrouter: 'z-ai/glm-5.2', opencode: 'anthropic/claude-sonnet-5' },
        }),
        'utf-8',
      )

      const store = new SettingsStore()
      expect(store.getPersistedModel('opencode')).toBe('anthropic/claude-sonnet-5')
    })

    it('modelOptions.openrouter se descarta (no se migra), sin tocar modelOptions de otros proveedores', () => {
      writeFileSync(
        settingsFilePath(),
        JSON.stringify({
          aiProvider: 'openrouter',
          models: { openrouter: 'openai/gpt-5.5' },
          modelOptions: { openrouter: { effort: 'medium' }, codex: { effort: 'high' } },
        }),
        'utf-8',
      )

      const store = new SettingsStore()
      expect(store.getPersistedModelOptions('opencode')).toEqual({})
      expect(store.getPersistedModelOptions('codex')).toEqual({ effort: 'high' })
    })

    it('un settings.json YA migrado (sin ningún rastro de openrouter) es un no-op: no se reescribe', () => {
      const original = JSON.stringify({
        aiProvider: 'opencode',
        models: { opencode: 'opencode/big-pickle' },
      })
      writeFileSync(settingsFilePath(), original, 'utf-8')

      const store = new SettingsStore()
      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'opencode',
        models: { opencode: 'opencode/big-pickle' },
      })

      // El archivo en disco no cambió de forma (mismo contenido lógico) —
      // no se disparó una reescritura innecesaria.
      const raw = readFileSync(settingsFilePath(), 'utf-8')
      expect(JSON.parse(raw)).toEqual(JSON.parse(original))
    })

    it('sin settings.json en absoluto, no hay nada que migrar: getPersistedSettings sigue devolviendo null (defaults los resuelve ../ai/env.ts)', () => {
      const store = new SettingsStore()
      expect(store.getPersistedSettings()).toBeNull()
      expect(existsSync(settingsFilePath())).toBe(false)
    })

    it('borra (best-effort) el archivo huérfano de key cifrada de OpenRouter si existe', () => {
      writeFileSync(orphanedOpenRouterKeyFilePath(), Buffer.from([1, 2, 3]))
      expect(existsSync(orphanedOpenRouterKeyFilePath())).toBe(true)

      new SettingsStore().getPersistedSettings()

      expect(existsSync(orphanedOpenRouterKeyFilePath())).toBe(false)
    })

    it('no lanza si no hay archivo huérfano de key que borrar', () => {
      expect(existsSync(orphanedOpenRouterKeyFilePath())).toBe(false)
      expect(() => new SettingsStore().getPersistedSettings()).not.toThrow()
    })
  })

  describe('setAiProvider / setProviderModel (T26)', () => {
    it('setAiProvider cambia el proveedor activo sin tocar los modelos ya elegidos', () => {
      const store = new SettingsStore()
      store.setProviderModel('opencode', 'opencode/big-pickle')
      store.setProviderModel('claude-code', 'claude-sonnet-5')
      store.setAiProvider('claude-code')

      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'claude-code',
        models: { opencode: 'opencode/big-pickle', 'claude-code': 'claude-sonnet-5' },
      })
    })

    it('setProviderModel para un proveedor no activo no cambia el proveedor activo', () => {
      const store = new SettingsStore()
      store.setAiProvider('opencode')
      store.setProviderModel('codex', 'gpt-5.5-codex')

      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'opencode',
        models: { codex: 'gpt-5.5-codex' },
      })
    })

    it('setProviderModel sobreescribe solo el modelo de ESE proveedor (último guardado gana por proveedor)', () => {
      const store = new SettingsStore()
      store.setProviderModel('opencode', 'openai/gpt-5.5')
      store.setProviderModel('opencode', 'z-ai/glm-5.2')
      store.setProviderModel('claude-code', 'claude-opus-4-8')

      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'opencode',
        models: { opencode: 'z-ai/glm-5.2', 'claude-code': 'claude-opus-4-8' },
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
        JSON.stringify({ aiProvider: 'opencode', models: { opencode: 'opencode/big-pickle' } }),
        'utf-8',
      )

      const store = new SettingsStore()
      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'opencode',
        models: { opencode: 'opencode/big-pickle' },
      })
      expect(store.getPersistedModelOptions('opencode')).toEqual({})
    })

    it('la migración legacy ({ aiModel }, pre-T26) sigue funcionando igual con el guard extendido para "modelOptions"', () => {
      writeFileSync(settingsFilePath(), JSON.stringify({ aiModel: 'z-ai/glm-5.2' }), 'utf-8')

      const store = new SettingsStore()
      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'opencode',
        models: { opencode: 'openrouter/z-ai/glm-5.2' },
      })
      expect(store.getPersistedModelOptions('opencode')).toEqual({})
    })

    it('devuelve null si "modelOptions" tiene una clave de proveedor desconocida', () => {
      writeFileSync(
        settingsFilePath(),
        JSON.stringify({
          aiProvider: 'codex',
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
      store.setProviderModel('opencode', 'z-ai/glm-5.2')
      store.setAiProvider('opencode')

      expect(store.getPersistedModelOptions('codex')).toEqual({ effort: 'high' })
    })

    it('roundtrip tras "reinicio": una instancia nueva lee modelOptions persistidas', () => {
      const store = new SettingsStore()
      store.setModelOption('codex', 'effort', 'xhigh')

      const restarted = new SettingsStore()
      expect(restarted.getPersistedModelOptions('codex')).toEqual({ effort: 'xhigh' })
    })
  })

  describe('githubAccessMode (F14)', () => {
    it('default "oauth" cuando no hay nada persistido', () => {
      const store = new SettingsStore()
      expect(store.getGithubAccessMode()).toBe('oauth')
    })

    it('roundtrip: setGithubAccessMode + getGithubAccessMode en la misma instancia (cache)', () => {
      const store = new SettingsStore()
      store.setGithubAccessMode('gh-cli')
      expect(store.getGithubAccessMode()).toBe('gh-cli')
    })

    it('roundtrip tras "reinicio": una instancia nueva lee el modo persistido', () => {
      new SettingsStore().setGithubAccessMode('gh-cli')

      const restarted = new SettingsStore()
      expect(restarted.getGithubAccessMode()).toBe('gh-cli')
    })

    it('un settings.json de la forma pre-F14 (sin "githubAccessMode") se lee OK, con default "oauth"', () => {
      writeFileSync(
        settingsFilePath(),
        JSON.stringify({ aiProvider: 'opencode', models: { opencode: 'opencode/big-pickle' } }),
        'utf-8',
      )

      const store = new SettingsStore()
      expect(store.getGithubAccessMode()).toBe('oauth')
      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'opencode',
        models: { opencode: 'opencode/big-pickle' },
      })
    })

    it('devuelve null si "githubAccessMode" tiene un valor fuera de la whitelist (settings.json corrupto/editado a mano)', () => {
      writeFileSync(
        settingsFilePath(),
        JSON.stringify({
          aiProvider: 'opencode',
          models: {},
          githubAccessMode: 'ssh-key',
        }),
        'utf-8',
      )
      expect(new SettingsStore().getPersistedSettings()).toBeNull()
    })

    it('setAiProvider NO pisa un githubAccessMode ya guardado', () => {
      const store = new SettingsStore()
      store.setGithubAccessMode('gh-cli')
      store.setAiProvider('claude-code')

      expect(store.getGithubAccessMode()).toBe('gh-cli')
      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'claude-code',
        models: {},
        githubAccessMode: 'gh-cli',
      })
    })

    it('setProviderModel NO pisa un githubAccessMode ya guardado', () => {
      const store = new SettingsStore()
      store.setGithubAccessMode('gh-cli')
      store.setProviderModel('codex', 'gpt-5.5-codex')

      expect(store.getGithubAccessMode()).toBe('gh-cli')
    })

    it('setModelOption NO pisa un githubAccessMode ya guardado', () => {
      const store = new SettingsStore()
      store.setGithubAccessMode('gh-cli')
      store.setModelOption('codex', 'effort', 'high')

      expect(store.getGithubAccessMode()).toBe('gh-cli')
    })

    it('setGithubAccessMode NO pisa la selección de IA ya guardada', () => {
      const store = new SettingsStore()
      store.setProviderModel('claude-code', 'claude-sonnet-5')
      store.setAiProvider('claude-code')
      store.setGithubAccessMode('gh-cli')

      expect(store.getPersistedSettings()).toEqual({
        aiProvider: 'claude-code',
        models: { 'claude-code': 'claude-sonnet-5' },
        githubAccessMode: 'gh-cli',
      })
    })

    it('escribe settings.json SIN la clave githubAccessMode mientras nunca se llamó a setGithubAccessMode', () => {
      new SettingsStore().setProviderModel('opencode', 'opencode/big-pickle')

      const raw = readFileSync(settingsFilePath(), 'utf-8')
      expect(JSON.parse(raw)).not.toHaveProperty('githubAccessMode')
    })
  })
})
