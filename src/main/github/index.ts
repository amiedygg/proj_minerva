import type { GithubService } from './service'
import { MockGithubService } from './mock-service'
import { RealGithubService } from './real-service'
import { authManager } from '../auth/auth-manager'

export type { GithubService } from './service'

/**
 * Punto único de selección de implementación de `GithubService`.
 *
 * Real por defecto (Octokit, `./real-service.ts`), mock solo si se pide
 * explícitamente con `MINERVA_MOCK=1` (usado por los smokes e2e del
 * orquestador y por quien quiera desarrollar la UI sin credenciales).
 *
 * El real recibe el token como *provider* (`() => string | null`) en vez de
 * un valor fijo: así siempre lee el token vigente del `AuthManager` singleton
 * en el momento de cada llamada, sin tener que enterarse de logins/logouts.
 */
export function createGithubService(): GithubService {
  if (process.env.MINERVA_MOCK === '1') return new MockGithubService()
  return new RealGithubService(() => authManager.getToken())
}
