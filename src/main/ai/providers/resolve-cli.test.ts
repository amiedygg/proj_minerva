import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delimiter, join } from 'node:path'

/**
 * `resolve-cli.ts` toca el filesystem real (`node:fs.accessSync`) y lee
 * `node:os` (`homedir`/`platform`) — se mockean ambos para poder controlar
 * qué rutas "existen" sin depender de qué CLIs tenga instalados la máquina
 * que corre los tests (mismo espíritu que `cli-probe.test.ts`).
 */
const accessSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
vi.mock('node:fs', () => ({
  accessSync: (...args: unknown[]) => accessSyncMock(...args),
  readdirSync: (...args: unknown[]) => readdirSyncMock(...args),
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
  const originalNvmDir = process.env.NVM_DIR
  const originalFnmDir = process.env.FNM_DIR

  beforeEach(() => {
    clearCliPathCache()
    accessSyncMock.mockReset()
    accessSyncMock.mockImplementation(enoent)
    // Por defecto ningún version manager tiene versiones instaladas (como si
    // sus directorios no existieran — `readdirSync` lanza ENOENT).
    readdirSyncMock.mockReset()
    readdirSyncMock.mockImplementation(enoent)
    platformValue = 'linux'
    process.env.PATH = '/usr/bin:/usr/local/bin'
    delete process.env.APPDATA
    delete process.env.NVM_DIR
    delete process.env.FNM_DIR
  })

  afterEach(() => {
    process.env.PATH = originalPath
    if (originalAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = originalAppData
    if (originalNvmDir === undefined) delete process.env.NVM_DIR
    else process.env.NVM_DIR = originalNvmDir
    if (originalFnmDir === undefined) delete process.env.FNM_DIR
    else process.env.FNM_DIR = originalFnmDir
  })

  it('encuentra el binario en un directorio de PATH', () => {
    // `delimiter` real de la plataforma (';' en Windows, ':' en POSIX):
    // resolve-cli separa con él, y un ':' hardcodeado deja UNA sola entrada
    // inválida cuando la suite corre sobre Node de Windows (CI de T45).
    process.env.PATH = ['/usr/bin', '/opt/tools/bin'].join(delimiter)
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

  it('encuentra el binario bajo nvm (~/.nvm/versions/node/<v>/bin), prefiriendo la versión más nueva', () => {
    process.env.PATH = '/usr/bin'
    const nvmVersions = join('/home/test-user', '.nvm', 'versions', 'node')
    readdirSyncMock.mockImplementation((dir: string) => {
      // Orden de lectura a propósito NO semver (string sort pondría v9 > v22).
      if (dir === nvmVersions) return ['v9.11.2', 'v22.4.1', 'v22.11.0']
      return enoent()
    })
    accessSyncMock.mockImplementation((path: string) => {
      // El CLI está instalado en las DOS versiones 22: debe ganar la más nueva.
      if (path === join(nvmVersions, 'v22.11.0', 'bin', 'codex')) return ok()
      if (path === join(nvmVersions, 'v22.4.1', 'bin', 'codex')) return ok()
      return enoent()
    })

    expect(resolveCliPath('codex')).toBe(join(nvmVersions, 'v22.11.0', 'bin', 'codex'))
  })

  it('respeta NVM_DIR si el proceso lo trae', () => {
    process.env.PATH = '/usr/bin'
    process.env.NVM_DIR = '/custom/nvm'
    const nvmVersions = join('/custom/nvm', 'versions', 'node')
    readdirSyncMock.mockImplementation((dir: string) => {
      if (dir === nvmVersions) return ['v20.10.0']
      return enoent()
    })
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join(nvmVersions, 'v20.10.0', 'bin', 'claude')) return ok()
      return enoent()
    })

    expect(resolveCliPath('claude')).toBe(join(nvmVersions, 'v20.10.0', 'bin', 'claude'))
  })

  it('encuentra el binario en ~/.volta/bin', () => {
    process.env.PATH = '/usr/bin'
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/home/test-user', '.volta', 'bin', 'claude')) return ok()
      return enoent()
    })

    expect(resolveCliPath('claude')).toBe(join('/home/test-user', '.volta', 'bin', 'claude'))
  })

  it('encuentra el binario bajo fnm (~/.local/share/fnm/node-versions/<v>/installation/bin)', () => {
    process.env.PATH = '/usr/bin'
    const fnmVersions = join('/home/test-user', '.local', 'share', 'fnm', 'node-versions')
    readdirSyncMock.mockImplementation((dir: string) => {
      if (dir === fnmVersions) return ['v21.1.0']
      return enoent()
    })
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join(fnmVersions, 'v21.1.0', 'installation', 'bin', 'codex')) return ok()
      return enoent()
    })

    expect(resolveCliPath('codex')).toBe(
      join(fnmVersions, 'v21.1.0', 'installation', 'bin', 'codex'),
    )
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

  it('NO cachea el null: si el binario se instala después, la siguiente llamada lo encuentra sin reiniciar la app', () => {
    // Regresión F14.1: el `null` cacheado de por vida dejaba "Volver a
    // comprobar" atascado en "no está en tu PATH" hasta reiniciar Minerva.
    accessSyncMock.mockImplementation(enoent)
    expect(resolveCliPath('codex')).toBeNull()

    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/usr/bin', 'codex')) return ok()
      return enoent()
    })

    expect(resolveCliPath('codex')).toBe(join('/usr/bin', 'codex'))
  })

  it('resuelve claude/codex de forma independiente (cache por binario)', () => {
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/usr/bin', 'claude') || path === join('/usr/bin', 'codex')) return ok()
      return enoent()
    })

    expect(resolveCliPath('claude')).toBe(join('/usr/bin', 'claude'))
    expect(resolveCliPath('codex')).toBe(join('/usr/bin', 'codex'))
  })

  it('clearCliPathCache() fuerza a re-resolver una ruta positiva que quedó vieja', () => {
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/usr/bin', 'claude')) return ok()
      return enoent()
    })
    expect(resolveCliPath('claude')).toBe(join('/usr/bin', 'claude'))

    // El binario "se movió" (p. ej. reinstalación en otra ubicación).
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/usr/local/bin', 'claude')) return ok()
      return enoent()
    })
    // Sin limpiar, sigue sirviendo la ruta vieja cacheada.
    expect(resolveCliPath('claude')).toBe(join('/usr/bin', 'claude'))

    clearCliPathCache()
    expect(resolveCliPath('claude')).toBe(join('/usr/local/bin', 'claude'))
  })

  it('clearCliPathCache(binary) invalida SOLO ese binario y deja el resto cacheado', () => {
    accessSyncMock.mockImplementation((path: string) => {
      if (path === join('/usr/bin', 'claude') || path === join('/usr/bin', 'codex')) return ok()
      return enoent()
    })
    resolveCliPath('claude')
    resolveCliPath('codex')
    const callsAfterResolve = accessSyncMock.mock.calls.length

    clearCliPathCache('claude')

    // codex sigue cacheado: no vuelve a tocar el filesystem.
    resolveCliPath('codex')
    expect(accessSyncMock.mock.calls.length).toBe(callsAfterResolve)

    // claude sí re-escanea.
    resolveCliPath('claude')
    expect(accessSyncMock.mock.calls.length).toBeGreaterThan(callsAfterResolve)
  })
})
