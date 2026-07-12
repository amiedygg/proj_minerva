/**
 * Implementación real de `AiService` con el server local `opencode serve`
 * (`./opencode-runtime.ts`, T55) hablado por el SDK oficial `@opencode-ai/sdk`
 * (T56, patrón `OpenCodeAdapter.ts` de t3code — repo `pingdotgg/t3code`,
 * adaptado a nuestra vuelta única sin Effect-TS). Quinto proveedor real de
 * `AiService`, tercer AGÉNTICO (F11, junto a Claude Code y Codex, T58): igual
 * que ellos, explora el snapshot local del PR (`ensureSnapshot`, T54) con
 * herramientas de solo lectura antes de responder.
 *
 * DECISIÓN SDK v2 vs v1 (root), verificada empíricamente contra `opencode`
 * 1.17.18 (script suelto, ver bitácora de T56 en TASKS.md): `@opencode-ai/sdk`
 * (root, `.`) exporta un `Event` SIN `message.part.delta` ni `session.idle`
 * (protocolo más viejo, sin streaming incremental de texto) — es el que usan
 * `./cli-probe.ts`/`./opencode-model-catalog.ts` (T57) porque a ellos les
 * alcanza una llamada REST de una vez (`provider.list()`), sin streaming.
 * `@opencode-ai/sdk/v2` SÍ trae `EventMessagePartDelta`/`EventSessionIdle`
 * (comparación directa de las dos uniones `Event` en
 * `node_modules/@opencode-ai/sdk/dist/{,v2/}gen/types.gen.d.ts`) — es el ÚNICO
 * de los dos que puede streamear texto incremental, así que es el que usa este
 * archivo. Ambos subpaths conviven sin conflicto (T57 sigue en v1 para lo
 * suyo).
 *
 * GOTCHA CRÍTICO DE WIRE (verificado con un script suelto contra el binario
 * real, NO adivinado — lección T29): la firma TS de MUCHOS métodos en
 * `dist/v2/gen/sdk.gen.d.ts` sugiere parámetros ANIDADOS al estilo
 * `{ path: { sessionID }, body: { model, parts, ... } }` (esa es la forma de
 * la clase genérica `Session`/`Event`, que NINGÚN objeto real del cliente usa)
 * — pero las clases que `createOpencodeClient()` realmente instancia
 * (`client.session` → `Session2`, `client.event` → `Event` "correcta", ambas
 * en la sección de abajo del mismo archivo) tienen una firma FLAT:
 * `client.session.promptAsync({ sessionID, model, system, parts, ... })`,
 * `client.session.create({ title })`, `client.event.subscribe(undefined,
 * { signal })`. Confirmado dos veces: (a) `buildClientParams` en
 * `dist/v2/gen/core/params.gen.js` itera las keys de UN SOLO objeto plano —
 * pasarle `{ path: {...}, body: {...} }` hace que ninguna key matchee y el
 * server recibe la URL con el placeholder `{sessionID}` sin reemplazar (500,
 * "Expected a string starting with \"ses\", got \"%7BsessionID%7D\""); (b) un
 * `tsc --strict` real contra `Session2`/`Event` (las clases que
 * `OpencodeClient` expone) type-checkea la forma FLAT y rechaza la anidada.
 *
 * FORMA EXACTA DE EVENTOS observada end-to-end (server real + modelo gratis
 * `opencode/big-pickle`, snapshot artesanal de 3 archivos, ver bitácora T56):
 * - `message.updated`: `{ properties: { sessionID, info: { id, role,... } } }`
 *   — `info.role` es `'user'` (el propio prompt) o `'assistant'`.
 * - `message.part.updated`: `{ properties: { sessionID, part: { id, type,
 *   messageID, text?, ... } } }` — SE OBSERVÓ que llega ANTES que los
 *   `message.part.delta` del mismo `partID` y con el `type` correcto
 *   (`'reasoning'` para el razonamiento interno del modelo, `'text'` para la
 *   respuesta final, `'tool'` para llamadas a herramientas — estas últimas
 *   NUNCA emitieron `message.part.delta`, solo `message.part.updated` con su
 *   `state`). Este archivo SOLO lee `part.type`/`part.id`/`part.messageID` de
 *   este evento, NUNCA `part.text`: el bug conocido (issues opencode
 *   anomalyco/opencode #27966 y #26697) es sobre reconstruir el texto final a
 *   partir de los snapshots de `part.text` de este evento (pueden faltar
 *   actualizaciones intermedias) — el texto SIEMPRE sale de los deltas.
 * - `message.part.delta`: `{ properties: { sessionID, messageID, partID,
 *   field, delta } }` — `field` fue `'text'` para partes `text` Y
 *   `reasoning` (ambas tienen un campo `text`); nunca se vio otro valor de
 *   `field`. Sin `type` propio: el tipo de la parte se resuelve por
 *   `partID` contra lo aprendido en `message.part.updated`.
 * - `session.error`: `{ properties: { sessionID?, error?: { name, data:
 *   {message,...} } } }` — `sessionID` es OPCIONAL (un error de proveedor
 *   puede no estar atado a una sesión puntual).
 * - `session.idle`: `{ properties: { sessionID } }` — fin del turno; llegó
 *   DESPUÉS del `message.part.updated` final de la parte `text` en la corrida
 *   de humo.
 * - Housekeeping del server sin relación con nuestro análisis (`plugin.added`,
 *   `catalog.updated`, `reference.updated`, `integration.updated`,
 *   `session.diff`, `session.status`, `session.updated`, `message.removed`):
 *   se ignoran (rama `else` implícita del filtrado de abajo).
 *
 * Pipeline de `analyzePullRequest` (mismo contrato que el resto de
 * proveedores, ver `../service.ts`):
 * 1. `getEffectiveAiSelection()` (`../env`) da el slug `<providerID>/<modelID>`
 *    del modelo activo; se parte por el PRIMER `/` (`parseOpencodeModelSlug`)
 *    porque el `modelID` de OpenCode puede traer más barras (p. ej. ids de
 *    gateway anidados).
 * 2. `getPullRequestDetail`/`getPullRequestFiles` del `GithubService` activo +
 *    `ensureSnapshot` (T54) materializan la copia local del repo al commit del
 *    PR; `getOpencodeServer()` (T55) da la URL del server compartido
 *    (ya lanzado con el config read-only, ver `./opencode-runtime.ts`).
 * 3. `createOpencodeClient({ baseUrl, directory: snapshotDir, throwOnError:
 *    true })`: el cliente queda atado a ESE directorio para toda la sesión
 *    (headers `x-opencode-directory` en cada request, incluida la
 *    suscripción de eventos).
 * 4. Se suscribe a eventos (`client.event.subscribe`) ANTES de crear la
 *    sesión y de mandar el prompt (no perder deltas tempranos) — mismo orden
 *    que `t3code`. `session.create` da el `sessionID`; `session.promptAsync`
 *    (no bloqueante: "returns immediately" según su propio docstring del SDK)
 *    dispara el turno mientras el stream de eventos ya se está consumiendo en
 *    paralelo.
 * 5. Se acumulan SOLO los `message.part.delta` cuyo `field==='text'`,
 *    `messageID` pertenece a un mensaje `role==='assistant'`
 *    (`message.updated`) y `partID` es de tipo `'text'`
 *    (`message.part.updated`, ver el gotcha de arriba) — así se excluye el
 *    razonamiento interno del modelo (`type:'reasoning'`) y cualquier eco del
 *    propio prompt (mensajes `role:'user'`). Cada delta resetea el timer de
 *    inactividad (igual que cualquier otro evento de la sesión: el agente
 *    sigue vivo explorando aunque no emita texto, mismo criterio que
 *    Claude Code/Codex en T58).
 * 6. Fin normal: `session.idle` de nuestro `sessionID` → `parser.finalize()`.
 *    Fin por error: `session.error` de nuestro `sessionID` (o sin `sessionID`,
 *    ver arriba) → throw con el detalle. Timeouts AGÉNTICOS compartidos
 *    (`../analysis-timeouts.ts`, T56: total 300s / inactividad 60s) sobre un
 *    único `AbortController` pasado como `signal` a `subscribe`/`create`/
 *    `promptAsync`; al salir (éxito, error o timeout) se llama
 *    `session.abort` best-effort (catch vacío: la sesión puede ya estar
 *    muerta) y se aborta el controller para cerrar la conexión SSE.
 * 7. Errores accionables en español: `ProviderAuthError` (sin upstream
 *    conectado, tanto si llega como excepción HTTP -`session.create`/
 *    `promptAsync`- como evento `session.error`) → sugiere `opencode auth
 *    login` + elegir otro modelo en Settings; servidor que no arranca → el
 *    mensaje de `getOpencodeServer()` (ya accionable) se propaga tal cual;
 *    cero deltas de texto al terminar → error explícito (mismo patrón
 *    `sawAnyDelta` que Claude Code/Codex).
 *
 * Nunca se loguea contenido del PR ni de la respuesta del modelo — solo tipos
 * de evento y metadatos (ids, nombres de campo) si algo falla.
 */
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import type { Event } from '@opencode-ai/sdk/v2'
import type { AiService, AnalyzePullRequestOptions } from '../service'
import type { GithubService } from '../../github/service'
import type { IpcRequest } from '../../../shared/ipc'
import type { GeneratedAnalysis } from '../../../shared/types'
import { getEffectiveAiSelection } from '../env'
import { ANALYZE_PR_SYSTEM_PROMPT } from '../prompts/analyze-pr'
import { buildAgenticUserMessage, prId } from '../analysis-prompt'
import { StreamSectionParser } from '../stream-parser'
import { createThrottle } from '../throttle'
import { ensureSnapshot } from '../../github/snapshot-store'
import { getOpencodeServer } from './opencode-runtime'
import {
  AGENTIC_INACTIVITY_TIMEOUT_MS,
  AGENTIC_REQUEST_TIMEOUT_MS,
  createAnalysisTimeouts,
  PROGRESS_THROTTLE_MS,
} from '../analysis-timeouts'

export interface ParsedOpencodeModelSlug {
  providerID: string
  modelID: string
}

/**
 * Parsea un slug `<providerID>/<modelID>` por el PRIMER `/` (el `modelID`
 * puede traer más barras, p. ej. un id de gateway anidado) — mismo criterio
 * que `parseOpenCodeModelSlug` de t3code. `null` si no hay separador, o si
 * cualquiera de las dos mitades queda vacía.
 */
export function parseOpencodeModelSlug(slug: string): ParsedOpencodeModelSlug | null {
  const trimmed = slug.trim()
  const separator = trimmed.indexOf('/')
  if (separator <= 0 || separator === trimmed.length - 1) return null
  return { providerID: trimmed.slice(0, separator), modelID: trimmed.slice(separator + 1) }
}

/** Payload de un evento `session.error` (unión con `name`/`data.message` casi siempre presente). */
type SessionErrorPayload = Extract<Event, { type: 'session.error' }>['properties']['error']

/** Forma parcial del `.cause.body` que arma `wrapClientError` (`@opencode-ai/sdk/dist/error-interceptor.js`) cuando el cliente lanza por `throwOnError: true`. */
interface OpencodeErrorBody {
  name?: unknown
  data?: { message?: unknown; providerID?: unknown }
}

function extractErrorBody(error: unknown): OpencodeErrorBody | null {
  if (!(error instanceof Error)) return null
  const cause = (error as { cause?: unknown }).cause
  if (!cause || typeof cause !== 'object') return null
  const body = (cause as { body?: unknown }).body
  if (!body || typeof body !== 'object') return null
  return body as OpencodeErrorBody
}

/** Mensaje accionable para "sin upstream conectado", reutilizado tanto para excepciones HTTP como para eventos `session.error`. */
function providerAuthErrorMessage(providerID: unknown): string {
  return (
    'OpenCode no tiene un proveedor de IA conectado' +
    (typeof providerID === 'string' && providerID.length > 0 ? ' (' + providerID + ')' : '') +
    ': corré «opencode auth login» en una terminal y conectá un proveedor, o elegí otro modelo en Settings.'
  )
}

/** Mapea una excepción lanzada por el cliente (`throwOnError: true`) a un mensaje accionable en español. */
function mapOpencodeError(error: unknown): Error {
  const body = extractErrorBody(error)
  if (body?.name === 'ProviderAuthError') {
    return new Error(providerAuthErrorMessage(body.data?.providerID), { cause: error })
  }
  if (error instanceof Error) {
    return new Error('OpenCode devolvió un error: ' + error.message, { cause: error })
  }
  return new Error('OpenCode devolvió un error desconocido.', { cause: error })
}

/** Mensaje accionable a partir del payload de un evento `session.error` (forma cruda del protocolo, no una excepción). */
function describeSessionErrorPayload(error: SessionErrorPayload): string {
  if (!error) return 'error de sesión sin detalle.'
  if (error.name === 'ProviderAuthError') {
    return providerAuthErrorMessage(error.data.providerID)
  }
  const data = error.data as Record<string, unknown>
  const message = data.message
  return typeof message === 'string' && message.length > 0 ? message : 'error desconocido de OpenCode.'
}

export class OpenCodeAiService implements AiService {
  constructor(private readonly github: GithubService) {}

  async analyzePullRequest(
    req: IpcRequest<'ai:analyzePullRequest'>,
    options?: AnalyzePullRequestOptions,
  ): Promise<GeneratedAnalysis> {
    const { model } = getEffectiveAiSelection()
    const parsedModel = parseOpencodeModelSlug(model)
    if (parsedModel === null) {
      throw new Error(
        'El modelo de OpenCode "' +
          model +
          '" no tiene el formato <proveedor>/<modelo> esperado. Elegí un modelo válido en Settings.',
      )
    }

    const [detail, files] = await Promise.all([
      this.github.getPullRequestDetail(req),
      this.github.getPullRequestFiles(req),
    ])

    // AGÉNTICO (F11/T56): copia local del repo al commit del PR — el
    // `directory` del cliente (ver comentario del módulo).
    const snapshotDir = await ensureSnapshot(this.github, req.repo, detail.headSha)

    // Server compartido (T55): ya accionable si el binario falta o no arranca.
    const server = await getOpencodeServer()
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory: snapshotDir,
      throwOnError: true,
    })

    const userMessage = buildAgenticUserMessage(detail, files)

    const controller = new AbortController()
    const timeouts = createAnalysisTimeouts(controller, {
      totalMs: AGENTIC_REQUEST_TIMEOUT_MS,
      inactivityMs: AGENTIC_INACTIVITY_TIMEOUT_MS,
    })

    const abortErrorMessage = (): string | null => {
      const reason = timeouts.getAbortReason()
      if (reason === 'inactivity-timeout') {
        return (
          'OpenCode dejó de enviar datos: sin ningún fragmento nuevo por más de ' +
          AGENTIC_INACTIVITY_TIMEOUT_MS / 1000 +
          's (timeout de inactividad).'
        )
      }
      if (reason === 'total-timeout') {
        return 'OpenCode no respondió a tiempo (timeout total de ' + AGENTIC_REQUEST_TIMEOUT_MS / 1000 + 's).'
      }
      return null
    }

    const parser = new StreamSectionParser()
    const throttle = createThrottle(PROGRESS_THROTTLE_MS)
    const onProgress = options?.onProgress
    let sawAnyDelta = false
    let sessionId: string | null = null

    timeouts.resetInactivityTimer()

    try {
      // Suscripción ANTES de crear la sesión / mandar el prompt (ver
      // comentario del módulo): no se pierde ningún delta temprano.
      const subscription = await client.event.subscribe(undefined, {
        signal: controller.signal,
        throwOnError: true,
      })

      const sessionResp = await client.session.create(
        { title: 'Minerva: análisis de PR ' + prId(req) },
        { signal: controller.signal, throwOnError: true },
      )
      sessionId = sessionResp.data.id

      // Bookkeeping SOLO para clasificar partes (role del mensaje dueño, tipo
      // de la parte) — el TEXTO en sí sale exclusivamente de
      // `message.part.delta` (ver gotcha del módulo, nunca de `part.text`).
      const messageRoleById = new Map<string, string>()
      const partTypeById = new Map<string, string>()

      let resolveSession!: () => void
      let rejectSession!: (error: Error) => void
      const sessionDone = new Promise<void>((resolve, reject) => {
        resolveSession = resolve
        rejectSession = reject
      })
      // Red de seguridad: si `sessionDone` termina rechazada sin que nadie la
      // haya esperado todavía (p. ej. `promptAsync` falló antes de llegar al
      // `await sessionDone` de abajo), esto evita un unhandled rejection —
      // el `catch` de más abajo sigue viendo el error real igual.
      sessionDone.catch(() => {})

      const currentSessionId = sessionId
      void (async () => {
        try {
          for await (const event of subscription.stream) {
            timeouts.resetInactivityTimer()

            if (event.type === 'message.updated') {
              messageRoleById.set(event.properties.info.id, event.properties.info.role)
              continue
            }

            if (event.type === 'message.part.updated') {
              const part = event.properties.part
              partTypeById.set(part.id, part.type)
              continue
            }

            if (event.type === 'message.part.delta') {
              const p = event.properties
              if (p.sessionID !== currentSessionId) continue
              if (p.field !== 'text') continue
              if (messageRoleById.get(p.messageID) !== 'assistant') continue
              if (partTypeById.get(p.partID) !== 'text') continue
              sawAnyDelta = true
              parser.push(p.delta)
              if (onProgress && throttle.shouldRun()) {
                onProgress(parser.snapshot(), { done: false })
              }
              continue
            }

            if (event.type === 'session.error') {
              if (event.properties.sessionID !== undefined && event.properties.sessionID !== currentSessionId) {
                continue
              }
              rejectSession(new Error('OpenCode devolvió un error: ' + describeSessionErrorPayload(event.properties.error)))
              return
            }

            if (event.type === 'session.idle') {
              if (event.properties.sessionID !== currentSessionId) continue
              resolveSession()
              return
            }

            // Cualquier otro evento (tool-use vía `message.part.updated` con
            // `type:'tool'`, permisos, diffs, housekeeping del server): fuera
            // de alcance de T56 — la fase "explorando" de UI es T60.
          }
          rejectSession(new Error('OpenCode cerró la conexión de eventos antes de terminar el análisis.'))
        } catch (error) {
          rejectSession(error instanceof Error ? error : new Error(String(error)))
        }
      })()

      await client.session.promptAsync(
        {
          sessionID: sessionId,
          model: parsedModel,
          system: ANALYZE_PR_SYSTEM_PROMPT,
          parts: [{ type: 'text', text: userMessage }],
        },
        { signal: controller.signal, throwOnError: true },
      )

      await sessionDone
    } catch (error) {
      const abortMessage = abortErrorMessage()
      if (abortMessage) throw new Error(abortMessage, { cause: error })
      throw mapOpencodeError(error)
    } finally {
      // Se ejecuta SIEMPRE (éxito, error o timeout): cierra la conexión SSE y
      // le avisa al server que la sesión terminó, best-effort (puede ya
      // estar muerta — de ahí el `catch` vacío).
      timeouts.clearAll()
      controller.abort()
      if (sessionId !== null) {
        await client.session.abort({ sessionID: sessionId }, { throwOnError: true }).catch(() => {})
      }
    }

    if (!sawAnyDelta) {
      throw new Error(
        'OpenCode no devolvió contenido de streaming (revisá que el server siga activo y que el modelo elegido responda).',
      )
    }

    const sections = parser.finalize((m) => console.warn(m))

    if (onProgress) {
      onProgress(sections, { done: true })
    }

    return {
      prId: prId(req),
      sections,
      generatedAt: new Date().toISOString(),
    }
  }
}
