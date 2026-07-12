import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `gh-cli-auth.ts` spawnea `gh` (`node:child_process`), resuelve su ruta
 * absoluta (`../ai/providers/resolve-cli.ts`) y valida el token contra
 * `GET /user` (`./github-user.ts`) — los tres se mockean para poder ejercitar
 * cada estado sin depender de si la máquina que corre los tests tiene `gh`
 * instalado/logueado.
 */
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

const resolveCliPathMock = vi.fn()
vi.mock('../ai/providers/resolve-cli', () => ({
  resolveCliPath: (...args: unknown[]) => resolveCliPathMock(...args),
}))

const fetchGithubUserMock = vi.fn()
vi.mock('./github-user', () => ({
  fetchGithubUser: (...args: unknown[]) => fetchGithubUserMock(...args),
}))

const { GhCliAuth } = await import('./gh-cli-auth')

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void

/** Configura el mock de `execFile` para resolver `(error, stdout)` en la próxima llamada. */
function mockExecFileResult(error: Error | null, stdout = ''): void {
  execFileMock.mockImplementation(
    (_path: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(error, stdout, '')
    },
  )
}

const validUser = { login: 'edygg', avatarUrl: 'https://avatars.githubusercontent.com/u/1' }

describe('GhCliAuth', () => {
  let auth: InstanceType<typeof GhCliAuth>

  beforeEach(() => {
    execFileMock.mockReset()
    resolveCliPathMock.mockReset()
    fetchGithubUserMock.mockReset()
    resolveCliPathMock.mockReturnValue('/usr/local/bin/gh')
    auth = new GhCliAuth()
  })

  describe('getStatus(): los 4 estados', () => {
    it('cli_unavailable cuando resolveCliPath no encuentra gh en ninguna ubicación conocida', async () => {
      resolveCliPathMock.mockReturnValue(null)

      await expect(auth.getStatus()).resolves.toEqual({ mode: 'gh-cli', state: 'cli_unavailable' })
      expect(execFileMock).not.toHaveBeenCalled()
    })

    it('cli_unauthenticated cuando gh auth token sale con exit code distinto de 0', async () => {
      mockExecFileResult(new Error('exit status 1'))

      await expect(auth.getStatus()).resolves.toEqual({
        mode: 'gh-cli',
        state: 'cli_unauthenticated',
      })
      expect(fetchGithubUserMock).not.toHaveBeenCalled()
    })

    it('cli_unauthenticated cuando gh auth token hace timeout (mismo duck-type de error)', async () => {
      mockExecFileResult(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }))

      await expect(auth.getStatus()).resolves.toEqual({
        mode: 'gh-cli',
        state: 'cli_unauthenticated',
      })
    })

    it('cli_unauthenticated cuando gh auth token devuelve stdout vacío (o solo whitespace)', async () => {
      mockExecFileResult(null, '   \n')

      await expect(auth.getStatus()).resolves.toEqual({
        mode: 'gh-cli',
        state: 'cli_unauthenticated',
      })
      expect(fetchGithubUserMock).not.toHaveBeenCalled()
    })

    it('cli_unauthenticated cuando el token no valida contra GET /user (token descartado, no se cachea)', async () => {
      mockExecFileResult(null, 'ghp_bad_token')
      fetchGithubUserMock.mockRejectedValue(new Error('GET /user respondió 401'))

      await expect(auth.getStatus()).resolves.toEqual({
        mode: 'gh-cli',
        state: 'cli_unauthenticated',
      })
      expect(auth.getTokenSync()).toBeNull()
    })

    it('signed_in con el user cuando el token valida contra GET /user', async () => {
      mockExecFileResult(null, 'ghp_good_token')
      fetchGithubUserMock.mockResolvedValue(validUser)

      await expect(auth.getStatus()).resolves.toEqual({
        mode: 'gh-cli',
        state: 'signed_in',
        user: validUser,
      })
      expect(auth.getTokenSync()).toBe('ghp_good_token')
    })
  })

  it('recorta (trim) el stdout de gh auth token antes de validarlo', async () => {
    mockExecFileResult(null, '  ghp_with_whitespace  \n')
    fetchGithubUserMock.mockResolvedValue(validUser)

    await auth.getStatus()

    expect(fetchGithubUserMock).toHaveBeenCalledWith('ghp_with_whitespace')
  })

  it('el AuthStatus devuelto nunca incluye el token', async () => {
    mockExecFileResult(null, 'ghp_super_secret')
    fetchGithubUserMock.mockResolvedValue(validUser)

    const status = await auth.getStatus()

    expect(JSON.stringify(status)).not.toContain('ghp_super_secret')
  })

  it('ejecuta gh con los args EXACTOS, timeout+windowsHide, y sin la opción shell', async () => {
    mockExecFileResult(null, 'ghp_good_token')
    fetchGithubUserMock.mockResolvedValue(validUser)

    await auth.getStatus()

    expect(execFileMock).toHaveBeenCalledWith(
      '/usr/local/bin/gh',
      ['auth', 'token', '--hostname', 'github.com'],
      expect.objectContaining({ timeout: expect.any(Number), windowsHide: true }),
      expect.any(Function),
    )
    const [, , opts] = execFileMock.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(opts).not.toHaveProperty('shell')
  })

  it('TTL: llamadas repetidas seguidas no vuelven a spawnear ni a revalidar contra /user', async () => {
    mockExecFileResult(null, 'ghp_good_token')
    fetchGithubUserMock.mockResolvedValue(validUser)

    await auth.getStatus()
    await auth.getStatus()
    await auth.getStatus()

    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(fetchGithubUserMock).toHaveBeenCalledTimes(1)
  })

  it('single-flight: dos getStatus() concurrentes disparan un solo spawn', async () => {
    mockExecFileResult(null, 'ghp_good_token')
    fetchGithubUserMock.mockResolvedValue(validUser)

    const [a, b] = await Promise.all([auth.getStatus(), auth.getStatus()])

    expect(a).toEqual(b)
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  describe('refetchTokenAfter401()', () => {
    it('re-ejecuta gh auth token y actualiza getTokenSync() con el token nuevo', async () => {
      mockExecFileResult(null, 'ghp_old')
      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()
      expect(auth.getTokenSync()).toBe('ghp_old')

      mockExecFileResult(null, 'ghp_new')
      const refreshed = await auth.refetchTokenAfter401()

      expect(refreshed).toBe('ghp_new')
      expect(auth.getTokenSync()).toBe('ghp_new')
    })

    it('devuelve null y limpia getTokenSync() si gh auth token vuelve a fallar', async () => {
      mockExecFileResult(null, 'ghp_old')
      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()

      mockExecFileResult(new Error('exit status 1'))
      const refreshed = await auth.refetchTokenAfter401()

      expect(refreshed).toBeNull()
      expect(auth.getTokenSync()).toBeNull()
    })

    it('NO valida el token nuevo contra GET /user (esa validación queda al reintento del llamador)', async () => {
      mockExecFileResult(null, 'ghp_new')

      await auth.refetchTokenAfter401()

      expect(fetchGithubUserMock).not.toHaveBeenCalled()
    })

    it('invalida el cache de getStatus(): la siguiente llamada vuelve a spawnear', async () => {
      mockExecFileResult(null, 'ghp_old')
      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()
      expect(execFileMock).toHaveBeenCalledTimes(1)

      mockExecFileResult(null, 'ghp_new')
      await auth.refetchTokenAfter401()
      expect(execFileMock).toHaveBeenCalledTimes(2)

      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()
      expect(execFileMock).toHaveBeenCalledTimes(3)
    })

    it('devuelve null sin spawnear si gh ya no se resuelve en ninguna ubicación', async () => {
      resolveCliPathMock.mockReturnValue(null)

      const refreshed = await auth.refetchTokenAfter401()

      expect(refreshed).toBeNull()
      expect(execFileMock).not.toHaveBeenCalled()
    })
  })

  describe('reset()', () => {
    it('limpia cache y token snapshot: la siguiente llamada vuelve a spawnear', async () => {
      mockExecFileResult(null, 'ghp_good_token')
      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()
      expect(auth.getTokenSync()).toBe('ghp_good_token')

      auth.reset()

      expect(auth.getTokenSync()).toBeNull()
      await auth.getStatus()
      expect(execFileMock).toHaveBeenCalledTimes(2)
    })
  })
})
