import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

/**
 * `resolve-cli.ts` toca el filesystem real (`node:fs.accessSync`) y lee
 * `node:os` (`homedir`/`platform`) — se mockean ambos para poder controlar
 * qué rutas "existen" sin depender de qué CLIs tenga instalados la máquina
 * que corre los tests (mismo espíritu que `cli-probe.test.ts`).
 */
const accessSyncMock = vi.fn()
vi.mock('node:fs', () => ({
  accessSync: (...args: unknown[]) => accessSyncMock(...args),
  constants: { X_OK: 1 },
}))

let platformValue: NodeJS.Platform = 'linux'
vi.mock('node:os', () => ({
  homedir: () => '/home/test-user',
  platform: () => platformValue,
}))

const { resolveCliPath, clearCliPathCache } = await import('./resolve-cli')

/** `accessSync` "feliz": no lanza => el path existe y es ejecutable. */
function ok(): void {
  return undefined
}
/** `accessSync` como si el path no existiera (mismo código que un ENOENT real de `fs`). */
function enoent(): never {
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
}

describe('resolveCliPath', () => {
  const originalPath = process.env.PATH
  const originalAppData = process.env.APPDATA

  beforeEach(() => {
    clearCliPathCache()
    accessSyncMock.mockReset()
    accessSyncMock.mockImplementation(enoent)
    platformValue = 'linux'
    process.env.PATH = '/usr/bin:/usr/local/bin'
    delete process.env.APPDATA
  })

  afterEach(() => {
    process.env.PATH = originalPath
    if (originalAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = originalAppData
  })

  it('encuentra el binario en un directorio de PATH', () => {
    process.env.PATH = '/usr/bin:/opt/tools/bin'
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/opt/tools/bin', 'claude')) return ok()
      return enoent()
    })

    expect(resolveCliPath('claude')).toBe(join('/opt/tools/bin', 'claude'))
  })

  it('cae a ubicaciones comunes (~/.local/bin) si no está en PATH', () => {
    process.env.PATH = '/usr/bin'
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/home/test-user', '.local', 'bin', 'claude')) return ok()
      return enoent()
    })

    expect(resolveCliPath('claude')).toBe(join('/home/test-user', '.local', 'bin', 'claude'))
  })

  it('devuelve null si el binario no aparece en ninguna ubicación conocida', () => {
    accessSyncMock.mockImplementation(enoent)

    expect(resolveCliPath('codex')).toBeNull()
  })

  it('prueba /opt/homebrew/bin en macOS (Apple Silicon)', () => {
    platformValue = 'darwin'
    process.env.PATH = '/usr/bin'
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/opt/homebrew/bin', 'codex')) return ok()
      return enoent()
    })

    expect(resolveCliPath('codex')).toBe(join('/opt/homebrew/bin', 'codex'))
  })

  it('en Windows prueba extensiones .cmd/.exe/.ps1 y %APPDATA%\\npm', () => {
    platformValue = 'win32'
    process.env.PATH = 'C:\\Windows\\System32'
    process.env.APPDATA = 'C:\\Users\\test-user\\AppData\\Roaming'
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('C:\\Users\\test-user\\AppData\\Roaming', 'npm', 'claude.cmd')) return ok()
      return enoent()
    })

    expect(resolveCliPath('claude')).toBe(
      join('C:\\Users\\test-user\\AppData\\Roaming', 'npm', 'claude.cmd'),
    )
  })

  it('cachea el resultado: llamadas repetidas no vuelven a tocar el filesystem', () => {
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/usr/bin', 'claude')) return ok()
      return enoent()
    })

    resolveCliPath('claude')
    const callsAfterFirst = accessSyncMock.mock.calls.length
    resolveCliPath('claude')
    resolveCliPath('claude')

    expect(accessSyncMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('cachea también el resultado null (no encontrado)', () => {
    accessSyncMock.mockImplementation(enoent)

    resolveCliPath('codex')
    const callsAfterFirst = accessSyncMock.mock.calls.length
    resolveCliPath('codex')

    expect(accessSyncMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('resuelve claude/codex de forma independiente (cache por binario)', () => {
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/usr/bin', 'claude') || path === join('/usr/bin', 'codex')) return ok()
      return enoent()
    })

    expect(resolveCliPath('claude')).toBe(join('/usr/bin', 'claude'))
    expect(resolveCliPath('codex')).toBe(join('/usr/bin', 'codex'))
  })

  it('clearCliPathCache() fuerza a volver a buscar en disco', () => {
    accessSyncMock.mockImplementation(enoent)
    expect(resolveCliPath('claude')).toBeNull()

    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/usr/bin', 'claude')) return ok()
      return enoent()
    })
    // Sin limpiar la cache, sigue devolviendo el null cacheado.
    expect(resolveCliPath('claude')).toBeNull()

    clearCliPathCache()
    expect(resolveCliPath('claude')).toBe(join('/usr/bin', 'claude'))
  })
})
