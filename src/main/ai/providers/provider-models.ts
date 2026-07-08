/**
 * Agregado de "modelos disponibles" por proveedor de IA (T35, F8), consumido
 * por el canal IPC `ai:getProviderModels` (`../../ipc/handlers.ts`):
 * - OpenRouter / Claude Code: catálogo ESTÁTICO curado
 *   (`AI_PROVIDER_CATALOG`, T26/T34) — no hay nada que refrescar, se devuelve
 *   tal cual, envuelto en una promesa ya resuelta para que el canal sea
 *   uniformemente async sin importar el proveedor.
 * - Codex: catálogo DINÁMICO vía `fetchCodexModelCatalog`
 *   (`./codex-model-catalog.ts`), que spawnea un `codex app-server` efímero y
 *   pagina `model/list`. Como la pantalla de Settings puede abrirse/
 *   refrescarse varias veces seguidas, el resultado se cachea con un TTL
 *   corto (`CODEX_CACHE_TTL_MS`) — mismo patrón que `./cli-probe.ts`
 *   (`getCliProviderStatus`): nunca bloqueante, y un rechazo no se cachea
 *   (aunque `fetchCodexModelCatalog` en sí ya no lanza, ver su comentario de
 *   cabecera, esta defensa evita que un rechazo inesperado deje el proveedor
 *   "atascado" en error durante todo el TTL).
 */
import type { AiModelOption, AiProviderId } from '../../../shared/ai-providers'
import { AI_PROVIDER_CATALOG } from '../../../shared/ai-providers'
import { fetchCodexModelCatalog } from './codex-model-catalog'

/** TTL de la cache de modelos de Codex: evita spawnear `codex app-server` en cada apertura de Settings. */
const CODEX_CACHE_TTL_MS = 60_000

interface CacheEntry {
  expiresAt: number
  promise: Promise<readonly AiModelOption[]>
}

let codexCache: CacheEntry | null = null

function getCodexModels(): Promise<readonly AiModelOption[]> {
  const now = Date.now()
  if (codexCache && codexCache.expiresAt > now) return codexCache.promise

  const promise = fetchCodexModelCatalog()
  codexCache = { expiresAt: now + CODEX_CACHE_TTL_MS, promise }
  promise.catch(() => {
    codexCache = null
  })
  return promise
}

/**
 * Modelos disponibles para `provider` (T35): dinámicos con cache TTL para
 * Codex, catálogo curado estático (envuelto en una promesa) para el resto.
 * Nunca lanza: `fetchCodexModelCatalog` ya degrada a
 * `AI_PROVIDER_CATALOG.codex.models` ante cualquier fallo.
 */
export function getProviderModels(provider: AiProviderId): Promise<readonly AiModelOption[]> {
  if (provider === 'codex') return getCodexModels()
  return Promise.resolve(AI_PROVIDER_CATALOG[provider].models)
}

/** Solo para tests: fuerza a que la próxima llamada de Codex vuelva a refrescar en vez de servir la cache. */
export function clearProviderModelsCache(): void {
  codexCache = null
}
