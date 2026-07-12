/**
 * Puente de token del modo de acceso `gh-cli` (F14, v0.5.0): en vez de un
 * OAuth Device Flow propio, la autenticación se delega al CLI `gh` ya
 * logueado del usuario — `gh auth token` devuelve el token de esa sesión, que
 * se valida contra `GET /user` (`./github-user.ts`) y se usa TAL CUAL para
 * hablar con Octokit (`main/github/real-service.ts`, sin cambios de ruta).
 *
 * Pensado para orgs enterprise con *OAuth app access restrictions* activas:
 * bloquean la OAuth App de Minerva pero SÍ permiten GitHub CLI (verificado
 * empíricamente, ver `.agents/PLAN.md` § F14 — GitHub autoriza por token + app
 * emisora, nunca por cliente HTTP).
 *
 * Mapeo de estados: `gh` no se resuelve en PATH/ubicaciones comunes ⇒
 * `cli_unavailable`; se resuelve pero `gh auth token` falla (exit≠0, timeout,
 * stdout vacío tras recortar espacios) ⇒ `cli_unauthenticated`; el token
 * obtenido no valida contra `GET /user` ⇒ `cli_unauthenticated` (token
 * descartado, nunca se cachea uno inválido); todo OK ⇒ `signed_in` + user.
 *
 * Nunca lanza: cualquier fallo degrada al estado correspondiente. El token
 * JAMÁS sale de esta clase hacia IPC/logs — `getStatus()` (lo que cruza a
 * `AuthStatus`) nunca lo incluye; solo `getTokenSync()` lo expone, y
 * únicamente dentro de `main` (mismo criterio que `AuthManager.getToken()`).
 *
 * Cache TTL 5s + single-flight (mismo patrón que
 * `../ai/providers/cli-probe.ts`): dos `getStatus()` concurrentes reusan la
 * MISMA promesa en vuelo, así que no spawnean `gh` dos veces; `settings:get`,
 * el polling de la UI (T71) y el arranque (`../index.ts`) pueden llamar sin
 * preocuparse por el costo.
 */
import { execFile } from 'node:child_process'
import { GH_HOSTNAME } from './config'
import { fetchGithubUser } from './github-user'
import { resolveCliPath } from '../ai/providers/resolve-cli'
import type { AuthStatus } from '../../shared/types'

/** TTL de la cache de `getStatus()`: evita spawnear `gh` por cada llamada IPC seguida. */
const STATUS_CACHE_TTL_MS = 5000

/** Tiempo máximo que se espera a `gh auth token` antes de degradar a "no autenticado". */
const GH_AUTH_TOKEN_TIMEOUT_MS = 3000

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class GhCliAuth {
  private cachedStatus: Promise<AuthStatus> | null = null
  private cacheExpiresAt = 0
  /** Snapshot del último token validado con éxito (o `null` si el último probe no lo confirmó). Lo lee `getTokenSync()`. */
  private lastToken: string | null = null

  /**
   * Estado actual del modo `gh-cli`, cacheado (TTL 5s) + single-flight: si ya
   * hay un probe en vuelo (o uno reciente cacheado), se devuelve esa MISMA
   * promesa en vez de spawnear `gh` de nuevo.
   */
  getStatus(): Promise<AuthStatus> {
    const now = Date.now()
    if (this.cachedStatus && this.cacheExpiresAt > now) return this.cachedStatus

    const promise = this.probe()
    this.cachedStatus = promise
    this.cacheExpiresAt = now + STATUS_CACHE_TTL_MS
    return promise
  }

  /** Snapshot en memoria del último token validado (o `null`); nunca cruza a IPC. */
  getTokenSync(): string | null {
    return this.lastToken
  }

  /**
   * Re-obtiene el token de `gh` SIN pasar por la cache de `getStatus()` (ni
   * repetir la validación contra `/user`, que ya se sabe que puede volver a
   * fallar en el reintento del llamador): la usa `main/github/gh-retry.ts`
   * ante un 401 en la ruta de datos — cubre tanto rotación del token de `gh`
   * como un arranque en frío donde el primer probe corrió antes de que el
   * usuario terminara `gh auth login`. Invalida la cache de `getStatus()` de
   * paso, para que la próxima consulta de estado (p. ej. el polling de la UI)
   * refleje el resultado fresco en vez de servir el probe viejo.
   */
  async refetchTokenAfter401(): Promise<string | null> {
    this.cachedStatus = null
    this.cacheExpiresAt = 0

    const resolvedPath = resolveCliPath('gh')
    const token = resolvedPath === null ? null : await this.execGhAuthToken(resolvedPath)
    this.lastToken = token
    return token
  }

  /** Solo para tests: limpia cache, single-flight y el token snapshot. */
  reset(): void {
    this.cachedStatus = null
    this.cacheExpiresAt = 0
    this.lastToken = null
  }

  private async probe(): Promise<AuthStatus> {
    const resolvedPath = resolveCliPath('gh')
    if (resolvedPath === null) {
      this.lastToken = null
      return { mode: 'gh-cli', state: 'cli_unavailable' }
    }

    const token = await this.execGhAuthToken(resolvedPath)
    if (token === null) {
      this.lastToken = null
      return { mode: 'gh-cli', state: 'cli_unauthenticated' }
    }

    try {
      const user = await fetchGithubUser(token)
      this.lastToken = token
      return { mode: 'gh-cli', state: 'signed_in', user }
    } catch (error) {
      console.warn(
        '[auth] token de gh no es válido contra GET /user, se descarta:',
        toErrorMessage(error),
      )
      this.lastToken = null
      return { mode: 'gh-cli', state: 'cli_unauthenticated' }
    }
  }

  /**
   * `execFile(path, ['auth', 'token', '--hostname', GH_HOSTNAME])` contra la
   * ruta YA resuelta de `gh`. Devuelve `null` para CUALQUIER falla (exit≠0,
   * timeout, stdout vacío tras recortar espacios) — nunca lanza. Env CRUDO
   * (`process.env`, sin `buildSanitizedSpawnEnv`): ese saneado es solo para
   * los CLIs de IA (borra `GH_TOKEN`/`GITHUB_TOKEN`, justo lo que `gh`
   * necesitaría si el usuario los usa para autenticarse). Sin `shell` — args
   * literales, nunca interpolados en una cadena.
   */
  private execGhAuthToken(path: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        execFile(
          path,
          ['auth', 'token', '--hostname', GH_HOSTNAME],
          { timeout: GH_AUTH_TOKEN_TIMEOUT_MS, windowsHide: true, env: process.env },
          (error, stdout) => {
            if (error) {
              resolve(null)
              return
            }
            const token = stdout.trim()
            resolve(token.length > 0 ? token : null)
          },
        )
      } catch {
        // Defensa extra, mismo criterio que `cli-probe.ts`: `execFile`
        // normalmente reporta errores vía el callback, nunca lanzando.
        resolve(null)
      }
    })
  }
}

/** Instancia única del proceso `main`; `./auth-manager.ts`, `../ipc/handlers.ts`, `../index.ts` y `../github/gh-retry.ts` la comparten. */
export const ghCliAuth = new GhCliAuth()
