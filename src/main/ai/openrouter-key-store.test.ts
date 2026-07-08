import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `OpenRouterKeyStore` (mismo patrón que `../auth/token-store.ts`) usa
 * `app.getPath('userData')` y `safeStorage` (Electron) — se mockean los dos:
 * `getPath` apunta a un directorio temporal real por test (permite probar
 * lectura/escritura de archivo de punta a punta), `safeStorage` con una
 * "cifra" simulada (prefijo + reverso del string) que alcanza para probar el
 * roundtrip y la detección de corrupción sin depender de un keyring real del
 * SO (no disponible en CI/sandbox). `encryptionAvailable` es mutable por test
 * para cubrir la rama de degradación a solo-memoria.
 */
let userDataDir = ''
let encryptionAvailable = true

const FAKE_ENCRYPTION_PREFIX = 'ENC:'

/** "Cifra" con un prefijo + base64 (no texto plano en el archivo), suficiente para probar que el `.bin` no expone la key en claro. */
function fakeEncrypt(value: string): Buffer {
  return Buffer.from(FAKE_ENCRYPTION_PREFIX + Buffer.from(value, 'utf-8').toString('base64'), 'utf-8')
}

function fakeDecrypt(buf: Buffer): string {
  const raw = buf.toString('utf-8')
  if (!raw.startsWith(FAKE_ENCRYPTION_PREFIX)) {
    throw new Error('bytes no reconocidos como cifrado válido')
  }
  return Buffer.from(raw.slice(FAKE_ENCRYPTION_PREFIX.length), 'base64').toString('utf-8')
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error('getPath inesperado: ' + name)
      return userDataDir
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => fakeEncrypt(value),
    decryptString: (buf: Buffer) => fakeDecrypt(buf),
  },
}))

const { saveApiKey, loadApiKey, clearApiKey, hasStoredApiKey, isPersistenceAvailable } =
  await import('./openrouter-key-store')

function keyFilePath(): string {
  return join(userDataDir, 'openrouter-key.bin')
}

describe('openrouter-key-store', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'minerva-openrouter-key-test-'))
    encryptionAvailable = true
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('isPersistenceAvailable refleja safeStorage.isEncryptionAvailable()', () => {
    expect(isPersistenceAvailable()).toBe(true)
    encryptionAvailable = false
    expect(isPersistenceAvailable()).toBe(false)
  })

  it('loadApiKey devuelve null si no hay archivo persistido', () => {
    expect(loadApiKey()).toBeNull()
    expect(hasStoredApiKey()).toBe(false)
  })

  it('roundtrip: saveApiKey + loadApiKey devuelve la misma key', () => {
    saveApiKey('sk-or-abc123')
    expect(loadApiKey()).toBe('sk-or-abc123')
    expect(hasStoredApiKey()).toBe(true)
  })

  it('el archivo persistido contiene bytes cifrados, no la key en claro', () => {
    saveApiKey('sk-or-super-secret')
    const raw = readFileSync(keyFilePath(), 'utf-8')
    expect(raw).not.toContain('sk-or-super-secret')
  })

  it('clearApiKey borra el archivo persistido; loadApiKey vuelve a null', () => {
    saveApiKey('sk-or-abc123')
    expect(hasStoredApiKey()).toBe(true)

    clearApiKey()
    expect(hasStoredApiKey()).toBe(false)
    expect(loadApiKey()).toBeNull()
  })

  it('clearApiKey sin archivo previo no lanza', () => {
    expect(() => clearApiKey()).not.toThrow()
  })

  it('degradación a solo-memoria: si safeStorage no está disponible, saveApiKey no persiste (con warning)', () => {
    encryptionAvailable = false
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    saveApiKey('sk-or-abc123')

    expect(existsSync(keyFilePath())).toBe(false)
    expect(loadApiKey()).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('loadApiKey descarta un archivo corrupto (no descifrable) y devuelve null con warning', () => {
    writeFileSync(keyFilePath(), 'esto no es un buffer cifrado válido', 'utf-8')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(loadApiKey()).toBeNull()

    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
