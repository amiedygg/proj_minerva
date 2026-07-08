import type { AiService } from './service'
import type { GithubService } from '../github/service'
import type { AiProviderId } from '../../shared/ai-providers'
import { MockAiService } from './mock-service'
import { OpenRouterAiService } from './openrouter-service'
import { ClaudeCodeAiService } from './providers/claude-code-service'
import { CodexAiService } from './providers/codex-service'
import { getCliProviderStatus } from './providers/cli-probe'
import { getAiEnv, getEffectiveAiSelection } from './env'

export type { AiService } from './service'

/**
 * Punto único de selección de implementación de `AiService` (T9-final;
 * generalizado a multi-proveedor en T27, ver `../../shared/ai-providers.ts` y
 * `getEffectiveAiSelection` en `./env.ts`).
 *
 * `createAiService` lee el proveedor ACTIVO (settings > env >
 * default, ver `getEffectiveAiSelection`) y delega en
 * `createAiServiceForProvider` para instanciar la implementación concreta:
 * - `openrouter`: `OpenRouterAiService` si hay `OPENROUTER_API_KEY`
 *   disponible (vía `process.env` o el `.env` de la raíz del proyecto en dev,
 *   ver `./env.ts`); si no, cae a `MockAiService` — mismo comportamiento de
 *   siempre, sin regresión.
 * - `claude-code` (T28): `ClaudeCodeAiService` (`./providers/claude-code-service.ts`,
 *   Agent SDK oficial) SOLO si `./providers/cli-probe.ts` reporta
 *   `'authenticated'` (CLI instalado Y con sesión — best-effort, ver ese
 *   archivo); si no, cae a `MockAiService` con un log que explica por qué,
 *   mismo espíritu que el caso OpenRouter sin key. Por esto
 *   `createAiServiceForProvider`/`createAiService` son ASYNC desde T28: el
 *   probe de CLI (`getCliProviderStatus`) puede spawnear un proceso corto
 *   (`claude --version`) para confirmar que el binario existe.
 * - `codex` (T29): `CodexAiService` (`./providers/codex-service.ts`, `codex
 *   app-server` oficial vía JSON-RPC) SOLO si `getCliProviderStatus('codex')`
 *   reporta `'authenticated'` — mismo criterio y mismo espíritu que el caso
 *   `claude-code` de arriba (el probe sigue siendo el heurístico best-effort
 *   de `./providers/cli-probe.ts`, sin handshake real; T29 decidió, igual
 *   que T28, no encarecer ese hot path); si no, cae a `MockAiService` con un
 *   log que explica por qué.
 *
 * A propósito, esto sigue siendo INDEPENDIENTE de `MINERVA_MOCK` (el flag que
 * decide si `GithubService` es mock o real, ver `../github/index.ts`): con
 * `MINERVA_MOCK=1` + un proveedor de IA real y autenticado, se puede probar
 * la IA real analizando PRs mock (útil para desarrollo sin necesitar una
 * cuenta de GitHub real). Por eso `createAiService` recibe el `GithubService`
 * ACTIVO como dependencia en vez de crear el suyo: la implementación real le
 * pide el detalle/archivos del PR a lo que sea que `registerIpcHandlers` haya
 * instanciado (mock o real), sin enterarse de cuál es.
 */
async function createAiServiceForProvider(
  provider: AiProviderId,
  github: GithubService,
): Promise<AiService> {
  switch (provider) {
    case 'openrouter': {
      const { openRouterApiKey } = getAiEnv()
      if (openRouterApiKey) {
        return new OpenRouterAiService(github)
      }
      console.warn(
        '[ai] Proveedor activo es OpenRouter pero falta OPENROUTER_API_KEY: usando MockAiService.',
      )
      return new MockAiService()
    }
    case 'claude-code': {
      const status = await getCliProviderStatus('claude-code')
      if (status.status === 'authenticated') {
        return new ClaudeCodeAiService(github)
      }
      console.warn(
        '[ai] Proveedor activo es Claude Code pero el CLI no está instalado/autenticado (estado: ' +
          status.status +
          '): usando MockAiService. Corré «claude login» (o instalá el CLI) y reintentá.',
      )
      return new MockAiService()
    }
    case 'codex': {
      const status = await getCliProviderStatus('codex')
      if (status.status === 'authenticated') {
        return new CodexAiService(github)
      }
      console.warn(
        '[ai] Proveedor activo es Codex pero el CLI no está instalado/autenticado (estado: ' +
          status.status +
          '): usando MockAiService. Corré «codex login» (o instalá el CLI) y reintentá.',
      )
      return new MockAiService()
    }
  }
}

export async function createAiService(github: GithubService): Promise<AiService> {
  const { provider } = getEffectiveAiSelection()
  return createAiServiceForProvider(provider, github)
}
