/**
 * Refresco dinámico (best-effort) del catálogo de modelos de Codex vía la RPC
 * `model/list` de `codex app-server` (T29), con fallback al catálogo curado
 * a mano (`AI_PROVIDER_CATALOG.codex.models`, `../../../shared/ai-providers.ts`,
 * T26) si el CLI no está instalado/autenticado, si la RPC falla, o si su
 * forma de respuesta no matchea lo esperado.
 *
 * NO está enchufado todavía a `getAiSettingsInfo`/la UI de Settings: ese
 * catálogo (`AiSettingsInfo.catalog`) es estático hoy (import directo de
 * `AI_PROVIDER_CATALOG`, ver `../env.ts`) y cablear un refresco async ahí
 * implica tocar el contrato de T26 (`settings:get` pasaría a poder tardar/
 * fallar por red, y el catálogo de OpenRouter/Claude Code seguiría siendo
 * síncrono) — se deja fuera de alcance de T29 a propósito (así lo permite la
 * tarea: "si model/list es complejo de integrar ahora, deja el catálogo
 * curado y anota el TODO"). `CodexAiService.analyzePullRequest` usa
 * `getEffectiveAiSelection().model` para decidir CON QUÉ modelo analizar
 * (eso no depende de este archivo); esta función es para cuando se quiera
 * refrescar la LISTA de modelos elegibles en el picker.
 *
 * TODO (tarea futura): si se quiere que el picker de Settings muestre
 * modelos reales de la cuenta en vez del placeholder curado, cablear esto en
 * `getAiSettingsInfo`/`ai:getProviderStatus` con su propio cache y manejo de
 * error — no en caliente en este archivo.
 *
 * Forma de `model/list` (paginado) SIN VERIFICAR contra un binario `codex`
 * real ni contra `packages/effect-codex-app-server` de t3code (no disponible
 * en este sandbox, ver el comentario de framing en
 * `./codex-app-server-client.ts`): se asume `{ models: [...], nextCursor?:
 * string }` por request, pasando `{ cursor }` para pedir la próxima página,
 * hasta que `nextCursor` sea `undefined`. Cualquier forma inesperada
 * simplemente no aporta modelos (se ignora ese elemento) en vez de lanzar.
 */
import type { AiModelOption } from '../../../shared/ai-providers'
import { AI_PROVIDER_CATALOG } from '../../../shared/ai-providers'
import { CodexAppServerClient } from './codex-app-server-client'

/** Techo de páginas a pedir, por si un servidor real/fake nunca deja de mandar `nextCursor` (bug de protocolo, no debería pasar). */
const MAX_PAGES = 20

interface ModelListPage {
  models?: unknown[]
  nextCursor?: string
}

function coerceModelOption(raw: unknown): AiModelOption | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const id = obj.id ?? obj.model
  if (typeof id !== 'string' || id.length === 0) return null
  const label = typeof obj.label === 'string' ? obj.label : typeof obj.name === 'string' ? obj.name : id
  const vendor = typeof obj.vendor === 'string' ? obj.vendor : 'OpenAI'
  return { id, label, vendor }
}

/**
 * Intenta refrescar el catálogo de modelos de Codex spawneando un
 * `codex app-server` efímero, paginando `model/list`. Ante CUALQUIER fallo
 * (binario ausente, sin sesión, timeout, forma de respuesta inesperada)
 * devuelve el catálogo curado (`AI_PROVIDER_CATALOG.codex.models`) sin
 * lanzar — pensado para poder llamarse desde un contexto best-effort (nunca
 * debe tumbar el arranque ni la pantalla de Settings).
 */
export async function fetchCodexModelCatalog(
  createClient: () => CodexAppServerClient = () => new CodexAppServerClient(),
): Promise<readonly AiModelOption[]> {
  let client: CodexAppServerClient | null = null
  try {
    client = createClient()
    await client.request('initialize', {})
    client.notify('initialized', {})

    const models: AiModelOption[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.request<ModelListPage>('model/list', cursor ? { cursor } : {})
      for (const raw of result.models ?? []) {
        const option = coerceModelOption(raw)
        if (option) models.push(option)
      }
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }

    return models.length > 0 ? models : AI_PROVIDER_CATALOG.codex.models
  } catch {
    return AI_PROVIDER_CATALOG.codex.models
  } finally {
    client?.kill()
  }
}
