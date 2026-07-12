/**
 * Retry-401 de la ruta de datos en modo `gh-cli` (F14, v0.5.0).
 *
 * El puente de token (`../auth/gh-cli-auth.ts`) valida el token de `gh` en el
 * probe, pero puede quedar viejo entre un `getStatus()` cacheado (TTL 5s) y
 * la próxima llamada real a GitHub — o el arranque puede haber calentado el
 * probe ANTES de que el usuario terminara `gh auth login`. Este decorador
 * envuelve cualquier `GithubService` (típicamente el `RealGithubService`,
 * ver `./index.ts`) para que, en modo `gh-cli` y SOLO ante un error marcado
 * con `GITHUB_AUTH_ERROR_CODE` (`./real-service.ts`), re-obtenga el token de
 * `gh` (`ghCliAuth.refetchTokenAfter401()`) y reintente la llamada UNA sola
 * vez — cubre rotación del token de `gh` y el caso de arranque en frío.
 *
 * En modo `oauth` es un passthrough puro: el método envuelto simplemente
 * llama al método real sin ningún try/catch de por medio, para no agregar
 * ni un microtask de más al camino feliz de siempre.
 */
import { settingsStore } from '../settings/store'
import { ghCliAuth } from '../auth/gh-cli-auth'
import { GITHUB_AUTH_ERROR_CODE } from './real-service'
import type { GithubService } from './service'

const GH_CLI_REAUTH_MESSAGE =
  "No autenticado con GitHub CLI: ejecuta 'gh auth login' en una terminal y reintenta."

function isGithubAuthError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === GITHUB_AUTH_ERROR_CODE
  )
}

/**
 * Ejecuta `fn` con el retry-401 aplicado si `mode === 'gh-cli'`; passthrough
 * puro en `oauth`. `fn` es un thunk de 0 argumentos (cada método del wrapper
 * de abajo cierra sobre su propio request) para no tener que lidiar con
 * genéricos variádicos.
 */
async function guarded<Result>(
  mode: ReturnType<typeof settingsStore.getGithubAccessMode>,
  fn: () => Promise<Result>,
): Promise<Result> {
  if (mode !== 'gh-cli') return fn()

  try {
    return await fn()
  } catch (error) {
    if (!isGithubAuthError(error)) throw error

    const refreshedToken = await ghCliAuth.refetchTokenAfter401()
    if (refreshedToken === null) {
      throw new Error(GH_CLI_REAUTH_MESSAGE, { cause: error })
    }

    try {
      return await fn()
    } catch (retryError) {
      // Reintento ÚNICO: si el segundo intento TAMBIÉN falla por auth (token
      // recién refrescado y sin embargo inválido — revocado a mitad de
      // camino, o el `gh` del usuario apunta a otra cuenta), no se reintenta
      // de nuevo, se relanza como el mensaje accionable de gh-cli.
      if (isGithubAuthError(retryError)) {
        throw new Error(GH_CLI_REAUTH_MESSAGE, { cause: retryError })
      }
      throw retryError
    }
  }
}

/** Envuelve `inner` (T70): los 6 métodos de `GithubService` pasan por `guarded()`. */
export function withGhCliTokenRetry(inner: GithubService): GithubService {
  return {
    listPullRequests: (req) =>
      guarded(settingsStore.getGithubAccessMode(), () => inner.listPullRequests(req)),
    getPullRequestDetail: (req) =>
      guarded(settingsStore.getGithubAccessMode(), () => inner.getPullRequestDetail(req)),
    getPullRequestFiles: (req) =>
      guarded(settingsStore.getGithubAccessMode(), () => inner.getPullRequestFiles(req)),
    getCommentThreads: (req) =>
      guarded(settingsStore.getGithubAccessMode(), () => inner.getCommentThreads(req)),
    postComment: (req) =>
      guarded(settingsStore.getGithubAccessMode(), () => inner.postComment(req)),
    writeSnapshot: (req, destDir) =>
      guarded(settingsStore.getGithubAccessMode(), () => inner.writeSnapshot(req, destDir)),
  }
}
