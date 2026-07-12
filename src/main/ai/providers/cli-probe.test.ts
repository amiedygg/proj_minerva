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

let platformValue: NodeJS.Platform = 'linux'
vi.mock('node:os', () => ({
  homedir: () => '/home/test-user',
  platform: () => platformValue,
}))

/**
 * `resolveCliPath` (T31) se mockea para poder simular "instalado en una ruta
 * absoluta" o "no encontrado en ningún lado" sin depender de qué CLIs tenga
 * la máquina que corre los tests; por defecto resuelve a una ruta fake por
 * binario, para que el resto de los casos (que ejercitan `execFile`/lectura
 * de credenciales, no la resolución en sí) sigan funcionando igual.
 * `clearCliPathCache` (F14.1) se mockea para verificar que el probe invalida
 * la ruta cacheada cuando el binario resuelto deja de responder.
 */
const resolveCliPathMock = vi.fn()
const clearCliPathCacheMock = vi.fn()
vi.mock('./resolve-cli', () => ({
  resolveCliPath: (...args: unknown[]) => resolveCliPathMock(...args),
  clearCliPathCache: (...args: unknown[]) => clearCliPathCacheMock(...args),
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

/**
 * Como `mockExecFileResult`, pero distinguiendo el spawn de `security`
 * (chequeo del Keychain de macOS, F14.1) del `--version` del CLI:
 * `keychainError = null` simula que el ítem existe (exit 0).
 */
function mockExecFileWithKeychain(versionError: Error | null, keychainError: Error | null): void {
  execFileMock.mockImplementation(
    (binary: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(binary === 'security' ? keychainError : versionError)
    },
  )
}

function enoent(): Error {
  return Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
}

describe('getCliProviderStatus', () => {
  beforeEach(() => {
    clearCliProbeCache()
    platformValue = 'linux'
    execFileMock.mockReset()
    existsSyncMock.mockReset()
    readFileSyncMock.mockReset()
    resolveCliPathMock.mockReset()
    clearCliPathCacheMock.mockReset()
    resolveCliPathMock.mockImplementation((binary: string) => '/usr/local/bin/' + binary)
    checkOpencodeVersionMock.mockReset()
    getOpencodeServerMock.mockReset()
    providerListMock.mockReset()
    createOpencodeClientMock.mockClear()
  })

  it('unavailable con reason not-found (sin siquiera spawnear) cuando resolveCliPath no encuentra el binario', async () => {
    resolveCliPathMock.mockReturnValue(null)

    await expect(getCliProviderStatus('claude-code')).resolves.toEqual({
      status: 'unavailable',
      reason: 'not-found',
    })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('unavailable con reason probe-failed (+resolvedPath) cuando el binario resuelto no responde, e invalida la ruta cacheada', async () => {
    mockExecFileResult(enoent())

    await expect(getCliProviderStatus('claude-code')).resolves.toEqual({
      status: 'unavailable',
      reason: 'probe-failed',
      resolvedPath: '/usr/local/bin/claude',
    })
    // La ruta pudo quedar vieja (auto-update del CLI): el próximo intento
    // debe re-resolver contra el disco.
    expect(clearCliPathCacheMock).toHaveBeenCalledWith('claude')
  })

  it('unavailable con reason probe-failed cuando el spawn falla por cualquier otra razón (p. ej. timeout)', async () => {
    mockExecFileResult(new Error('killed by timeout'))

    await expect(getCliProviderStatus('codex')).resolves.toEqual({
      status: 'unavailable',
      reason: 'probe-failed',
      resolvedPath: '/usr/local/bin/codex',
    })
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

  describe('claude-code en macOS (F14.1): fallback al Keychain cuando no hay .credentials.json', () => {
    it('authenticated (sin plan/email) si el ítem del Keychain existe', async () => {
      platformValue = 'darwin'
      existsSyncMock.mockReturnValue(false)
      mockExecFileWithKeychain(null, null)

      await expect(getCliProviderStatus('claude-code')).resolves.toEqual({
        status: 'authenticated',
        account: {},
      })
      // El chequeo es SOLO existencia: nunca se pide el secreto (`-w`).
      const securityCall = execFileMock.mock.calls.find((call) => call[0] === 'security')
      expect(securityCall?.[1]).toEqual(['find-generic-password', '-s', 'Claude Code-credentials'])
      expect(securityCall?.[1]).not.toContain('-w')
    })

    it('installed si el Keychain no tiene el ítem (o `security` falla)', async () => {
      platformValue = 'darwin'
      existsSyncMock.mockReturnValue(false)
      mockExecFileWithKeychain(null, new Error('The specified item could not be found'))

      await expect(getCliProviderStatus('claude-code')).resolves.toEqual({ status: 'installed' })
    })

    it('el archivo de credenciales sigue teniendo prioridad (trae el plan) aunque el Keychain también exista', async () => {
      platformValue = 'darwin'
      existsSyncMock.mockReturnValue(true)
      readFileSyncMock.mockReturnValue(JSON.stringify({ claudeAiOauth: { subscriptionType: 'pro' } }))
      mockExecFileWithKeychain(null, null)

      await expect(getCliProviderStatus('claude-code')).resolves.toEqual({
        status: 'authenticated',
        account: { plan: 'pro' },
      })
    })

    it('en plataformas no-darwin jamás se spawnea `security`', async () => {
      platformValue = 'linux'
      existsSyncMock.mockReturnValue(false)
      mockExecFileWithKeychain(null, null)

      await expect(getCliProviderStatus('claude-code')).resolves.toEqual({ status: 'installed' })
      expect(execFileMock.mock.calls.some((call) => call[0] === 'security')).toBe(false)
    })
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
    it('unavailable (not-found) sin intentar nada más cuando resolveCliPath no encuentra el binario', async () => {
      resolveCliPathMock.mockImplementation((binary: string) =>
        binary === 'opencode' ? null : '/usr/local/bin/' + binary,
      )

      await expect(getCliProviderStatus('opencode')).resolves.toEqual({
        status: 'unavailable',
        reason: 'not-found',
      })
      expect(checkOpencodeVersionMock).not.toHaveBeenCalled()
      expect(getOpencodeServerMock).not.toHaveBeenCalled()
    })

    it('unavailable (probe-failed) cuando checkOpencodeVersion reporta una versión por debajo del mínimo (nunca arranca el server)', async () => {
      checkOpencodeVersionMock.mockResolvedValue({ ok: false, version: '1.0.0', error: 'muy vieja' })

      await expect(getCliProviderStatus('opencode')).resolves.toEqual({
        status: 'unavailable',
        reason: 'probe-failed',
        resolvedPath: '/usr/local/bin/opencode',
      })
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
