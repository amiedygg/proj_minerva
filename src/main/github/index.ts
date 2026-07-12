import type { GithubService } from './service'
import { withGhCliTokenRetry } from './gh-retry'
import { MockGithubService } from './mock-service'
import { RealGithubService } from './real-service'
import { authManager } from '../auth/auth-manager'

export type { GithubService } from './service'

/**
 * Punto único de selección de implementación de `GithubService`.
 *
 * Real por defecto (Octokit, `./real-service.ts`), mock solo si se pide
 * explícitamente con `MINERVA_MOCK=1` (usado por los smokes e2e del
 * orquestador y por quien quiera desarrollar la UI sin credenciales) — el
 * mock corta ANTES del decorador de abajo, nunca lo atraviesa.
 *
 * El real recibe el token como *provider* (`() => string | null`) en vez de
 * un valor fijo: así siempre lee el token vigente del `AuthManager` singleton
 * en el momento de cada llamada, sin tener que enterarse de logins/logouts
 * (ni del MODO activo — `AuthManager.getToken()` ya sabe si debe leer el
 * token oauth o el de `gh`, ver `../auth/auth-manager.ts`).
 *
 * `withGhCliTokenRetry` (F14, `./gh-retry.ts`) envuelve el real service con
 * el retry-401 del modo `gh-cli`: passthrough puro en `oauth`, así que no
 * cambia nada del comportamiento existente.
 */
export function createGithubService(): GithubService {
  if (process.env.MINERVA_MOCK === '1') return new MockGithubService()
  return withGhCliTokenRetry(new RealGithubService(() => authManager.getToken()))
}
