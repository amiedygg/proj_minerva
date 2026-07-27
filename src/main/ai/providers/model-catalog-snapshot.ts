/**
 * Último catálogo DINÁMICO conocido por proveedor (F19), leíble de forma
 * SÍNCRONA.
 *
 * Existe para cerrar un agujero que estaba ahí desde T35 y que se volvió
 * visible al hacer dinámico también a Claude Code: `getEffectiveAiSelection()`
 * (`../env.ts`) es SÍNCRONO y resolvía las opciones del modelo activo (el
 * `effort`/`variant` que el usuario eligió) contra el catálogo CURADO de
 * `shared/ai-providers.ts`. Un modelo que solo existe en el catálogo dinámico
 * —o sea, cualquier modelo nuevo, justo el caso que F19 habilita— no está en el
 * curado, así que sus descriptores no se encontraban y el `effort` guardado se
 * descartaba en silencio: la UI ofrecía el selector de razonamiento (ella sí ve
 * la lista dinámica) y main mandaba el análisis sin `effort`.
 *
 * Por qué un snapshot y no "await del catálogo dentro de la resolución": la
 * resolución es síncrona en tres servicios distintos que la llaman a mitad de
 * su `analyzePullRequest`; volverla async obligaría a propagar el await por
 * toda la cadena para algo que en el 99% de las llamadas ya está en memoria.
 * En su lugar, `./provider-models.ts` deposita acá cada resultado dinámico
 * exitoso y `../env.ts` lo lee sin bloquear, cayendo al catálogo curado cuando
 * todavía no hay nada (arranque en frío) — y el handler de análisis
 * (`../../ipc/handlers.ts`) calienta el catálogo ANTES de resolver justamente
 * para que ese caso frío no le toque a un análisis real.
 *
 * Módulo aparte (y no un export más de `./provider-models.ts`) para que
 * `../env.ts` no arrastre a su grafo de imports los tres SDKs/clientes de los
 * fetchers dinámicos solo por leer un `Map`.
 */
import type { AiModelOption, AiProviderId } from '../../../shared/ai-providers'

const snapshot = new Map<AiProviderId, readonly AiModelOption[]>()

/** Deposita el catálogo dinámico recién resuelto de `provider`. Una lista vacía se ignora (no aporta nada y borraría uno bueno). */
export function recordProviderModels(provider: AiProviderId, models: readonly AiModelOption[]): void {
  if (models.length === 0) return
  snapshot.set(provider, models)
}

/** Último catálogo dinámico conocido de `provider`, o `undefined` si todavía no se resolvió ninguno en esta corrida. */
export function getSnapshotProviderModels(provider: AiProviderId): readonly AiModelOption[] | undefined {
  return snapshot.get(provider)
}

/** Solo para tests: vuelve al estado "todavía no se resolvió ningún catálogo". */
export function clearProviderModelsSnapshot(): void {
  snapshot.clear()
}
