/**
 * Agregado de "modelos disponibles" por proveedor de IA (T35, F8; OpenCode en
 * T57; Claude Code en F19), consumido por el canal IPC `ai:getProviderModels`
 * (`../../ipc/handlers.ts`). Desde F19 los TRES proveedores son dinámicos —le
 * preguntan a su CLI qué modelos tiene disponibles la sesión— así que un modelo
 * nuevo aparece en el picker sin publicar una release de Minerva:
 * - Claude Code: `fetchClaudeCodeModelCatalog` (`./claude-code-model-catalog.ts`),
 *   `supportedModels()` del Agent SDK sobre una sesión efímera que no gasta
 *   tokens. Hasta F19 este era el único caso ESTÁTICO ("no hay nada que
 *   refrescar"), y por eso Opus 5 no aparecía en la lista.
 * - Codex: `fetchCodexModelCatalog` (`./codex-model-catalog.ts`), que spawnea
 *   un `codex app-server` efímero y pagina `model/list`.
 * - OpenCode: `fetchOpencodeModelCatalog` (`./opencode-model-catalog.ts`), que
 *   habla con el server local (singleton lazy de `./opencode-runtime.ts`, T55,
 *   compartido con el probe) y filtra por providers `connected`.
 *
 * Los tres degradan solos a su slice del catálogo curado
 * (`AI_PROVIDER_CATALOG`) ante cualquier fallo, así que este módulo nunca
 * lanza ni deja el picker vacío.
 *
 * Como la pantalla de Settings puede abrirse/refrescarse varias veces
 * seguidas, cada catálogo se cachea con un TTL corto (`DYNAMIC_CACHE_TTL_MS`) —
 * mismo patrón que `./cli-probe.ts` (`getCliProviderStatus`): nunca
 * bloqueante, y un rechazo no se cachea (aunque ninguno de los tres
 * `fetch*ModelCatalog` lanza en la práctica, ver sus respectivas cabeceras,
 * esta defensa evita que un rechazo inesperado deje el proveedor "atascado" en
 * error durante todo el TTL).
 *
 * Cada resultado se deposita además en `./model-catalog-snapshot.ts`, que es
 * de donde `../env.ts` lee (SÍNCRONAMENTE) los descriptores de opción del
 * modelo activo — ver la cabecera de ese módulo para el por qué.
 */
import type { AiModelOption, AiProviderId } from '../../../shared/ai-providers'
import { fetchClaudeCodeModelCatalog } from './claude-code-model-catalog'
import { fetchCodexModelCatalog } from './codex-model-catalog'
import { fetchOpencodeModelCatalog } from './opencode-model-catalog'
import { recordProviderModels } from './model-catalog-snapshot'

/** TTL de la cache de modelos: evita re-spawnear/re-consultar el CLI en cada apertura de Settings. */
const DYNAMIC_CACHE_TTL_MS = 60_000

const DYNAMIC_FETCHERS: Record<AiProviderId, () => Promise<readonly AiModelOption[]>> = {
  'claude-code': fetchClaudeCodeModelCatalog,
  codex: fetchCodexModelCatalog,
  opencode: fetchOpencodeModelCatalog,
}

interface CacheEntry {
  expiresAt: number
  promise: Promise<readonly AiModelOption[]>
}

const dynamicCache = new Map<AiProviderId, CacheEntry>()

/**
 * Modelos disponibles para `provider` (T35/T57/F19): dinámicos con cache TTL.
 * Nunca lanza: los tres `fetch*ModelCatalog` ya degradan a su slice de
 * `AI_PROVIDER_CATALOG` ante cualquier fallo.
 */
export function getProviderModels(provider: AiProviderId): Promise<readonly AiModelOption[]> {
  const now = Date.now()
  const cached = dynamicCache.get(provider)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = DYNAMIC_FETCHERS[provider]()
  dynamicCache.set(provider, { expiresAt: now + DYNAMIC_CACHE_TTL_MS, promise })
  void promise.then(
    (models) => {
      recordProviderModels(provider, models)
    },
    () => {
      dynamicCache.delete(provider)
    },
  )
  return promise
}

/**
 * Calienta el catálogo de `provider` sin propagar errores ni resultado (F19):
 * lo usa el handler de análisis (`../../ipc/handlers.ts`) para que el snapshot
 * síncrono (`./model-catalog-snapshot.ts`) ya tenga los descriptores del modelo
 * activo cuando `getEffectiveAiSelection()` resuelva sus opciones. Con la cache
 * TTL poblada es instantáneo.
 */
export async function warmProviderModels(provider: AiProviderId): Promise<void> {
  try {
    await getProviderModels(provider)
  } catch {
    // Best-effort: si no se pudo refrescar, `../env.ts` cae al catálogo curado.
  }
}

/** Solo para tests: fuerza a que la próxima llamada de un proveedor vuelva a refrescar en vez de servir la cache. */
export function clearProviderModelsCache(): void {
  dynamicCache.clear()
}
