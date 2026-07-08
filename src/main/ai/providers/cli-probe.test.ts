import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `cli-probe.ts` spawnea procesos (`node:child_process`) y lee archivos de
 * credenciales (`node:fs`) del home real del usuario (`node:os`) — se
 * mockean los tres módulos para poder controlar cada escenario (binario
 * ausente/timeout, instalado sin credenciales, instalado con credenciales)
 * sin depender de qué CLIs tenga instalados la máquina que corre los tests.
 */
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

const existsSyncMock = vi.fn()
const readFileSyncMock = vi.fn()
vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}))

vi.mock('node:os', () => ({ homedir: () => '/home/test-user' }))

/**
 * `resolveCliPath` (T31) se mockea para poder simular "instalado en una ruta
 * absoluta" o "no encontrado en ningún lado" sin depender de qué CLIs tenga
 * la máquina que corre los tests; por defecto resuelve a una ruta fake por
 * binario, para que el resto de los casos (que ejercitan `execFile`/lectura
 * de credenciales, no la resolución en sí) sigan funcionando igual.
 */
const resolveCliPathMock = vi.fn()
vi.mock('./resolve-cli', () => ({
  resolveCliPath: (...args: unknown[]) => resolveCliPathMock(...args),
}))

const { getCliProviderStatus, clearCliProbeCache } = await import('./cli-probe')

type ExecFileCallback = (error: Error | null) => void

/** Configura el mock de `execFile` para resolver con `error` (o `null` = éxito) en la próxima llamada. */
function mockExecFileResult(error: Error | null): void {
  execFileMock.mockImplementation(
    (_binary: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(error)
    },
  )
}

function enoent(): Error {
  return Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
}

describe('getCliProviderStatus', () => {
  beforeEach(() => {
    clearCliProbeCache()
    execFileMock.mockReset()
    existsSyncMock.mockReset()
    readFileSyncMock.mockReset()
    resolveCliPathMock.mockReset()
    resolveCliPathMock.mockImplementation((binary: string) => '/usr/local/bin/' + binary)
  })

  it('unavailable sin siquiera intentar spawnear cuando resolveCliPath no encuentra el binario en ninguna ubicación conocida', async () => {
    resolveCliPathMock.mockReturnValue(null)

    await expect(getCliProviderStatus('claude-code')).resolves.toEqual({ status: 'unavailable' })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('unavailable cuando el binario resuelto no responde (ENOENT igual, p. ej. permiso revocado tras resolver)', async () => {
    mockExecFileResult(enoent())

    await expect(getCliProviderStatus('claude-code')).resolves.toEqual({ status: 'unavailable' })
  })

  it('unavailable cuando el spawn falla por cualquier otra razón (p. ej. timeout)', async () => {
    mockExecFileResult(new Error('killed by timeout'))

    await expect(getCliProviderStatus('codex')).resolves.toEqual({ status: 'unavailable' })
  })

  it('ejecuta --version contra la ruta ABSOLUTA resuelta, no el nombre pelado del binario', async () => {
    resolveCliPathMock.mockReturnValue('/opt/custom/claude')
    mockExecFileResult(null)
    existsSyncMock.mockReturnValue(false)

    await getCliProviderStatus('claude-code')

    expect(execFileMock).toHaveBeenCalledWith(
      '/opt/custom/claude',
      ['--version'],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    )
  })

  it('installed cuando el binario responde pero no hay archivo de credenciales', async () => {
    mockExecFileResult(null)
    existsSyncMock.mockReturnValue(false)

    await expect(getCliProviderStatus('claude-code')).resolves.toEqual({ status: 'installed' })
  })

  it('claude-code: authenticated con el plan leído de .credentials.json', async () => {
    mockExecFileResult(null)
    existsSyncMock.mockReturnValue(true)
    readFileSyncMock.mockReturnValue(JSON.stringify({ claudeAiOauth: { subscriptionType: 'max' } }))

    const status = await getCliProviderStatus('claude-code')

    expect(status).toEqual({ status: 'authenticated', account: { plan: 'max' } })
    // Nunca debe filtrarse el accessToken/refreshToken del archivo.
    expect(JSON.stringify(status)).not.toMatch(/token/i)
  })

  it('claude-code: installed si .credentials.json existe pero no es el JSON esperado', async () => {
    mockExecFileResult(null)
    existsSyncMock.mockReturnValue(true)
    readFileSyncMock.mockReturnValue('no-es-json')

    await expect(getCliProviderStatus('claude-code')).resolves.toEqual({ status: 'installed' })
  })

  it('codex: authenticated (sin account detallado) si existe ~/.codex/auth.json', async () => {
    mockExecFileResult(null)
    existsSyncMock.mockReturnValue(true)

    await expect(getCliProviderStatus('codex')).resolves.toEqual({
      status: 'authenticated',
      account: {},
    })
  })

  it('cachea el resultado: llamadas repetidas antes de que expire el TTL no vuelven a spawnear', async () => {
    mockExecFileResult(null)
    existsSyncMock.mockReturnValue(false)

    await getCliProviderStatus('claude-code')
    await getCliProviderStatus('claude-code')
    await getCliProviderStatus('claude-code')

    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('claude-code y codex se prueban de forma independiente (cache por proveedor)', async () => {
    mockExecFileResult(null)
    existsSyncMock.mockReturnValue(false)

    await getCliProviderStatus('claude-code')
    await getCliProviderStatus('codex')

    expect(execFileMock).toHaveBeenCalledTimes(2)
  })
})
