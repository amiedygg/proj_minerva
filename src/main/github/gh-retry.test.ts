import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubService } from './service'
import { GITHUB_AUTH_ERROR_CODE } from './real-service'

/**
 * `gh-retry.ts` depende de `settingsStore.getGithubAccessMode()` (para saber
 * si aplica el retry) y de `ghCliAuth.refetchTokenAfter401()` (para
 * refrescar el token de `gh` ante un 401) — se mockean ambos para controlar
 * cada escenario sin tocar disco ni spawnear `gh`.
 */
const getGithubAccessModeMock = vi.fn()
vi.mock('../settings/store', () => ({
  settingsStore: { getGithubAccessMode: (...args: unknown[]) => getGithubAccessModeMock(...args) },
}))

const refetchTokenAfter401Mock = vi.fn()
vi.mock('../auth/gh-cli-auth', () => ({
  ghCliAuth: { refetchTokenAfter401: (...args: unknown[]) => refetchTokenAfter401Mock(...args) },
}))

const { withGhCliTokenRetry } = await import('./gh-retry')

function authError(message = 'No autenticado: el token de GitHub es inválido o expiró.'): Error {
  return Object.assign(new Error(message), { code: GITHUB_AUTH_ERROR_CODE })
}

const validRepo = { owner: 'octocat', name: 'hello-world', fullName: 'octocat/hello-world' }

function makeFakeService(overrides: Partial<GithubService> = {}): GithubService {
  return {
    listPullRequests: vi.fn().mockResolvedValue([]),
    getPullRequestDetail: vi.fn().mockResolvedValue({}),
    getPullRequestFiles: vi.fn().mockResolvedValue([]),
    getCommentThreads: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue({}),
    writeSnapshot: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('withGhCliTokenRetry', () => {
  beforeEach(() => {
    getGithubAccessModeMock.mockReset()
    refetchTokenAfter401Mock.mockReset()
  })

  describe('modo oauth: passthrough puro', () => {
    it('no intercepta nada, ni siquiera un error con el código de auth', async () => {
      getGithubAccessModeMock.mockReturnValue('oauth')
      const listPullRequests = vi.fn().mockRejectedValue(authError())
      const wrapped = withGhCliTokenRetry(makeFakeService({ listPullRequests }))

      await expect(wrapped.listPullRequests({})).rejects.toThrow(/No autenticado/)
      expect(listPullRequests).toHaveBeenCalledTimes(1)
      expect(refetchTokenAfter401Mock).not.toHaveBeenCalled()
    })

    it('delega el resultado exitoso tal cual', async () => {
      getGithubAccessModeMock.mockReturnValue('oauth')
      const summaries = [{ id: '1' }]
      const wrapped = withGhCliTokenRetry(
        makeFakeService({ listPullRequests: vi.fn().mockResolvedValue(summaries) }),
      )

      await expect(wrapped.listPullRequests({})).resolves.toBe(summaries)
    })
  })

  describe('modo gh-cli', () => {
    it('401 -> refetch exitoso -> retry único con éxito', async () => {
      getGithubAccessModeMock.mockReturnValue('gh-cli')
      refetchTokenAfter401Mock.mockResolvedValue('ghp_new_token')
      const listPullRequests = vi
        .fn()
        .mockRejectedValueOnce(authError())
        .mockResolvedValueOnce([{ id: 'pr1' }])
      const wrapped = withGhCliTokenRetry(makeFakeService({ listPullRequests }))

      await expect(wrapped.listPullRequests({})).resolves.toEqual([{ id: 'pr1' }])
      expect(listPullRequests).toHaveBeenCalledTimes(2)
      expect(refetchTokenAfter401Mock).toHaveBeenCalledTimes(1)
    })

    it('401 -> refetch devuelve null -> error accionable de gh-cli, sin reintentar la llamada real', async () => {
      getGithubAccessModeMock.mockReturnValue('gh-cli')
      refetchTokenAfter401Mock.mockResolvedValue(null)
      const listPullRequests = vi.fn().mockRejectedValue(authError())
      const wrapped = withGhCliTokenRetry(makeFakeService({ listPullRequests }))

      await expect(wrapped.listPullRequests({})).rejects.toThrow(
        "No autenticado con GitHub CLI: ejecuta 'gh auth login' en una terminal y reintenta.",
      )
      expect(listPullRequests).toHaveBeenCalledTimes(1)
    })

    it('401 en el reintento NO vuelve a reintentar (reintento único)', async () => {
      getGithubAccessModeMock.mockReturnValue('gh-cli')
      refetchTokenAfter401Mock.mockResolvedValue('ghp_new_token')
      const listPullRequests = vi.fn().mockRejectedValue(authError())
      const wrapped = withGhCliTokenRetry(makeFakeService({ listPullRequests }))

      await expect(wrapped.listPullRequests({})).rejects.toThrow(
        "No autenticado con GitHub CLI: ejecuta 'gh auth login' en una terminal y reintenta.",
      )
      expect(listPullRequests).toHaveBeenCalledTimes(2)
      expect(refetchTokenAfter401Mock).toHaveBeenCalledTimes(1)
    })

    it('errores que NO son de autenticación pasan intactos, sin refetch ni reintento', async () => {
      getGithubAccessModeMock.mockReturnValue('gh-cli')
      const rateLimitError = new Error('Rate limit de GitHub alcanzado, intenta en 5 min')
      const listPullRequests = vi.fn().mockRejectedValue(rateLimitError)
      const wrapped = withGhCliTokenRetry(makeFakeService({ listPullRequests }))

      await expect(wrapped.listPullRequests({})).rejects.toBe(rateLimitError)
      expect(listPullRequests).toHaveBeenCalledTimes(1)
      expect(refetchTokenAfter401Mock).not.toHaveBeenCalled()
    })

    it('éxito directo (sin 401) no dispara refetch', async () => {
      getGithubAccessModeMock.mockReturnValue('gh-cli')
      const wrapped = withGhCliTokenRetry(
        makeFakeService({ getPullRequestDetail: vi.fn().mockResolvedValue({ id: 'd1' }) }),
      )

      await expect(wrapped.getPullRequestDetail({ repo: validRepo, number: 1 })).resolves.toEqual({
        id: 'd1',
      })
      expect(refetchTokenAfter401Mock).not.toHaveBeenCalled()
    })

    it('envuelve los 6 métodos de GithubService con el mismo retry', async () => {
      refetchTokenAfter401Mock.mockResolvedValue('ghp_new_token')
      getGithubAccessModeMock.mockReturnValue('gh-cli')

      const methods: (keyof GithubService)[] = [
        'listPullRequests',
        'getPullRequestDetail',
        'getPullRequestFiles',
        'getCommentThreads',
        'postComment',
        'writeSnapshot',
      ]

      for (const method of methods) {
        const fn = vi.fn().mockRejectedValueOnce(authError()).mockResolvedValueOnce('ok')
        const wrapped = withGhCliTokenRetry(
          makeFakeService({ [method]: fn } as Partial<GithubService>),
        )

        const result =
          method === 'writeSnapshot'
            ? await wrapped.writeSnapshot({ repo: validRepo, headSha: 'abc' }, '/tmp/x')
            : method === 'postComment'
              ? await wrapped.postComment({ repo: validRepo, number: 1, bodyMarkdown: 'hi' })
              : await (wrapped[method] as (req: unknown) => Promise<unknown>)({
                  repo: validRepo,
                  number: 1,
                })

        expect(result).toBe('ok')
        expect(fn).toHaveBeenCalledTimes(2)
      }
    })
  })
})
