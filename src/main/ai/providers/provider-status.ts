/**
 * Agregado de estado de login por proveedor (T27) que consume el handler del
 * canal IPC `ai:getProviderStatus` (`../../ipc/handlers.ts`): un `Record` con
 * los TRES proveedores del catálogo, cada uno resuelto según su
 * `authKind` (`./registry.ts`):
 * - `api-key` (OpenRouter): síncrono, `getAiEnv().openRouterApiKey` (nunca la
 *   key misma) via `../env.ts`.
 * - `cli` (Claude Code, Codex): `./cli-probe.ts`, con su propio timeout+cache
 *   — nunca bloqueante.
 *
 * Mismo patrón que `AuthManager.getStatus()` (`../../auth/auth-manager.ts`):
 * estado expuesto sin secretos, calculado on-demand (no hay estado propio que
 * mantener acá, todo vive en `getAiEnv`/`getCliProviderStatus`).
 */
import { AI_PROVIDER_IDS, type AiProviderId } from '../../../shared/ai-providers'
import type { AiProviderStatus } from '../../../shared/types'
import { getAiEnv } from '../env'
import { getCliProviderStatus } from './cli-probe'
import { AI_PROVIDER_REGISTRY } from './registry'

function getOpenRouterStatus(): AiProviderStatus {
  const { openRouterApiKey } = getAiEnv()
  return { status: openRouterApiKey ? 'authenticated' : 'unavailable' }
}

function getStatusFor(provider: AiProviderId): Promise<AiProviderStatus> | AiProviderStatus {
  const entry = AI_PROVIDER_REGISTRY[provider]
  return entry.authKind === 'api-key' ? getOpenRouterStatus() : getCliProviderStatus(provider)
}

export async function getAiProviderStatusMap(): Promise<Record<AiProviderId, AiProviderStatus>> {
  const entries = await Promise.all(
    AI_PROVIDER_IDS.map(async (provider): Promise<[AiProviderId, AiProviderStatus]> => [
      provider,
      await getStatusFor(provider),
    ]),
  )
  return Object.fromEntries(entries) as Record<AiProviderId, AiProviderStatus>
}
