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

/**
 * OpenCode (T57) tiene su propio criterio de probe — se mockean
 * `checkOpencodeVersion`/`getOpencodeServer` (`./opencode-runtime.ts`, T55) y
 * el cliente del SDK (`provider.list`, forma verificada empíricamente contra
 * el binario real, ver `./opencode-model-catalog.ts`) para no depender de
 * tener `opencode` instalado ni un server real corriendo.
 */
const checkOpencodeVersionMock = vi.fn()
const getOpencodeServerMock = vi.fn()
vi.mock('./opencode-runtime', () => ({
  checkOpencodeVersion: (...args: unknown[]) => checkOpencodeVersionMock(...args),
  getOpencodeServer: (...args: unknown[]) => getOpencodeServerMock(...args),
}))

const providerListMock = vi.fn()
const createOpencodeClientMock = vi.fn((..._args: unknown[]) => ({ provider: { list: providerListMock } }))
vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: (...args: unknown[]) => createOpencodeClientMock(...args),
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
    checkOpencodeVersionMock.mockReset()
    getOpencodeServerMock.mockReset()
    providerListMock.mockReset()
    createOpencodeClientMock.mockClear()
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

  describe('opencode (T57): criterio distinto — server local + provider.list, no archivo de credenciales', () => {
    it('unavailable sin intentar nada más cuando resolveCliPath no encuentra el binario', async () => {
      resolveCliPathMock.mockImplementation((binary: string) =>
        binary === 'opencode' ? null : '/usr/local/bin/' + binary,
      )

      await expect(getCliProviderStatus('opencode')).resolves.toEqual({ status: 'unavailable' })
      expect(checkOpencodeVersionMock).not.toHaveBeenCalled()
      expect(getOpencodeServerMock).not.toHaveBeenCalled()
    })

    it('unavailable cuando checkOpencodeVersion reporta una versión por debajo del mínimo (nunca arranca el server)', async () => {
      checkOpencodeVersionMock.mockResolvedValue({ ok: false, version: '1.0.0', error: 'muy vieja' })

      await expect(getCliProviderStatus('opencode')).resolves.toEqual({ status: 'unavailable' })
      expect(getOpencodeServerMock).not.toHaveBeenCalled()
    })

    it('installed cuando el server responde pero provider.list no reporta ningún upstream connected', async () => {
      checkOpencodeVersionMock.mockResolvedValue({ ok: true, version: '1.17.18' })
      getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:12345' })
      providerListMock.mockResolvedValue({ data: { all: [], default: {}, connected: [] } })

      await expect(getCliProviderStatus('opencode')).resolves.toEqual({ status: 'installed' })
    })

    it('authenticated con el conteo/nombres de upstreams conectados en account.plan cuando connected no está vacío', async () => {
      checkOpencodeVersionMock.mockResolvedValue({ ok: true, version: '1.17.18' })
      getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:12345' })
      providerListMock.mockResolvedValue({
        data: { all: [], default: {}, connected: ['openai', 'opencode'] },
      })

      const status = await getCliProviderStatus('opencode')

      expect(status.status).toBe('authenticated')
      expect(status.account?.plan).toContain('openai')
      expect(status.account?.plan).toContain('opencode')
    })

    it('installed (no unavailable) cuando el server no arranca a tiempo: el binario+versión ya se confirmaron OK', async () => {
      checkOpencodeVersionMock.mockResolvedValue({ ok: true, version: '1.17.18' })
      getOpencodeServerMock.mockRejectedValue(new Error('timeout arrancando el server'))

      await expect(getCliProviderStatus('opencode')).resolves.toEqual({ status: 'installed' })
    })

    it('installed cuando provider.list rechaza (server arriba pero la llamada falla)', async () => {
      checkOpencodeVersionMock.mockResolvedValue({ ok: true, version: '1.17.18' })
      getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:12345' })
      providerListMock.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(getCliProviderStatus('opencode')).resolves.toEqual({ status: 'installed' })
    })
  })
})
