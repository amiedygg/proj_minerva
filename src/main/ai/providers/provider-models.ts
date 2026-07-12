/**
 * Agregado de "modelos disponibles" por proveedor de IA (T35, F8; OpenCode
 * en T57), consumido por el canal IPC `ai:getProviderModels`
 * (`../../ipc/handlers.ts`):
 * - Claude Code: catálogo ESTÁTICO curado (`AI_PROVIDER_CATALOG`, T26/T34) —
 *   no hay nada que refrescar, se devuelve tal cual, envuelto en una promesa
 *   ya resuelta para que el canal sea uniformemente async sin importar el
 *   proveedor.
 * - Codex: catálogo DINÁMICO vía `fetchCodexModelCatalog`
 *   (`./codex-model-catalog.ts`), que spawnea un `codex app-server` efímero y
 *   pagina `model/list`.
 * - OpenCode: catálogo DINÁMICO vía `fetchOpencodeModelCatalog`
 *   (`./opencode-model-catalog.ts`), que habla con el server local
 *   (singleton lazy de `./opencode-runtime.ts`, T55, compartido con el probe)
 *   y filtra por providers `connected`.
 *
 * Como la pantalla de Settings puede abrirse/refrescarse varias veces
 * seguidas, cada catálogo dinámico se cachea con un TTL corto
 * (`DYNAMIC_CACHE_TTL_MS`) — mismo patrón que `./cli-probe.ts`
 * (`getCliProviderStatus`): nunca bloqueante, y un rechazo no se cachea
 * (aunque ninguno de los dos `fetch*ModelCatalog` lanza en la práctica, ver
 * sus respectivas cabeceras, esta defensa evita que un rechazo inesperado
 * deje el proveedor "atascado" en error durante todo el TTL). Un `Map` por
 * proveedor generaliza la cache sin duplicar la lógica de TTL/rechazo entre
 * Codex y OpenCode.
 */
import type { AiModelOption, AiProviderId } from '../../../shared/ai-providers'
import { AI_PROVIDER_CATALOG } from '../../../shared/ai-providers'
import { fetchCodexModelCatalog } from './codex-model-catalog'
import { fetchOpencodeModelCatalog } from './opencode-model-catalog'

/** TTL de la cache de modelos dinámicos (Codex/OpenCode): evita re-spawnear/re-consultar el server en cada apertura de Settings. */
const DYNAMIC_CACHE_TTL_MS = 60_000

/** Proveedores con catálogo DINÁMICO (el resto usa `AI_PROVIDER_CATALOG` estático tal cual). */
type DynamicProvider = 'codex' | 'opencode'

const DYNAMIC_FETCHERS: Record<DynamicProvider, () => Promise<readonly AiModelOption[]>> = {
  codex: fetchCodexModelCatalog,
  opencode: fetchOpencodeModelCatalog,
}

function isDynamicProvider(provider: AiProviderId): provider is DynamicProvider {
  return provider === 'codex' || provider === 'opencode'
}

interface CacheEntry {
  expiresAt: number
  promise: Promise<readonly AiModelOption[]>
}

const dynamicCache = new Map<DynamicProvider, CacheEntry>()

function getDynamicModels(provider: DynamicProvider): Promise<readonly AiModelOption[]> {
  const now = Date.now()
  const cached = dynamicCache.get(provider)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = DYNAMIC_FETCHERS[provider]()
  dynamicCache.set(provider, { expiresAt: now + DYNAMIC_CACHE_TTL_MS, promise })
  promise.catch(() => {
    dynamicCache.delete(provider)
  })
  return promise
}

/**
 * Modelos disponibles para `provider` (T35/T57): dinámicos con cache TTL para
 * Codex/OpenCode, catálogo curado estático (envuelto en una promesa) para el
 * resto. Nunca lanza: `fetchCodexModelCatalog`/`fetchOpencodeModelCatalog` ya
 * degradan a su slice de `AI_PROVIDER_CATALOG` ante cualquier fallo.
 */
export function getProviderModels(provider: AiProviderId): Promise<readonly AiModelOption[]> {
  if (isDynamicProvider(provider)) return getDynamicModels(provider)
  return Promise.resolve(AI_PROVIDER_CATALOG[provider].models)
}

/** Solo para tests: fuerza a que la próxima llamada de un proveedor dinámico vuelva a refrescar en vez de servir la cache. */
export function clearProviderModelsCache(): void {
  dynamicCache.clear()
}
