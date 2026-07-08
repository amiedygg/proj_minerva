/**
 * Implementación real de `AiService` con el binario OFICIAL `codex app-server`
 * (Codex CLI de OpenAI, T29), hablado por JSON-RPC 2.0 sobre stdio
 * (`./codex-app-server-client.ts`) — usa la sesión de suscripción ChatGPT
 * Plus/Pro que el usuario ya autenticó en su máquina con `codex login`. NO
 * hay OAuth propio, reescritura de URLs a `chatgpt.com/backend-api`, ni
 * headers de suplantación acá (ver `.agents/TASKS.md` § F7, "Decisión de
 * arquitectura clave"): el proceso hijo se autentica solo, leyendo la misma
 * sesión que usa el CLI.
 *
 * Pipeline de `analyzePullRequest` (mismo contrato que `OpenRouterAiService`/
 * `ClaudeCodeAiService`, ver `../service.ts`):
 * 1. Pide el detalle y los archivos del PR al `GithubService` ACTIVO
 *    (inyectado por constructor) y arma el mismo mensaje de usuario que el
 *    resto de proveedores (`../analysis-prompt.ts`).
 * 2. Spawnea un `codex app-server` EFÍMERO (una instancia de
 *    `CodexAppServerClient` por análisis, muerta en el `finally`) y hace el
 *    handshake, con la forma de mensajes VERIFICADA contra el protocolo real
 *    de `codex app-server` 0.142.x (esquema generado con
 *    `codex app-server generate-ts` + un turno real de humo):
 *      - `initialize` (request) con `clientInfo` + `capabilities`
 *        (`experimentalApi: true` — los métodos v2 `thread/start`/`turn/start`/
 *        `account/read`/`model/list` viven bajo esa capability).
 *      - `initialized` (notification, sin params).
 *      - `account/read` (request `{ refreshToken: false }`) → valida sesión:
 *        `{ account: Account | null, requiresOpenaiAuth }`. OJO:
 *        `requiresOpenaiAuth` es `true` incluso con sesión válida (declara que
 *        el server EXIGE auth de OpenAI, no que falte) — la señal real de "hay
 *        sesión" es `account != null`. Sin cuenta → mensaje accionable.
 *      - `thread/start` (request) con `model`, `baseInstructions` (= nuestro
 *        `ANALYZE_PR_SYSTEM_PROMPT`; es el análogo de Codex al `systemPrompt`
 *        custom del Agent SDK) y `sandbox: 'read-only'` + `approvalPolicy:
 *        'never'`: Codex es un agente de código; sin acotarlo intentaría
 *        ejecutar comandos y pedir aprobaciones. Nosotros solo queremos que
 *        GENERE el texto del análisis, sin tocar el disco. El id del hilo sale
 *        de `result.thread.id`.
 *      - `turn/start` (request) con `input` = `Array<UserInput>` (un solo
 *        bloque `{ type: 'text', text, text_elements: [] }`) y, desde T36,
 *        `effort` (string `'low'|'medium'|'high'|'xhigh'`) SOLO si
 *        `getEffectiveAiSelection().options.effort` resolvió a algo — el
 *        modelo activo sin descriptor de effort (T34) deja `options` vacío y
 *        el campo se omite, comportamiento idéntico a antes de T36. CLAVE:
 *        `turn/start` RESUELVE DE INMEDIATO con un ack (`turn.status:
 *        'inProgress'`), NO espera a que el turno termine — el fin llega por
 *        la notificación `turn/completed`. (El bug original de esta clase era
 *        matar el proceso apenas resolvía `turn/start`, antes de recibir un
 *        solo delta.)
 * 3. Durante el turno, el servidor emite notificaciones; los deltas de texto
 *    del asistente llegan como `item/agentMessage/delta` con `params.delta`
 *    (string) y se empujan al `StreamSectionParser` (`../stream-parser.ts`),
 *    con `onProgress` throttleado. El fin del turno es `turn/completed`; una
 *    notificación `error` o un `turn.status: 'failed'` lo aborta.
 * 4. Timeouts compartidos (`../analysis-timeouts.ts`, total 120s / inactividad
 *    20s) sobre el mismo `AbortController`; al abortar se mata el cliente.
 * 5. El proceso hijo se mata SIEMPRE en el `finally` — nunca queda huérfano.
 */
import type { AiService, AnalyzePullRequestOptions } from '../service'
import type { GithubService } from '../../github/service'
import type { IpcRequest } from '../../../shared/ipc'
import type { GeneratedAnalysis } from '../../../shared/types'
import { getEffectiveAiSelection } from '../env'
import { ANALYZE_PR_SYSTEM_PROMPT } from '../prompts/analyze-pr'
import { buildUserMessage, prId } from '../analysis-prompt'
import { StreamSectionParser } from '../stream-parser'
import { createThrottle } from '../throttle'
import {
  createAnalysisTimeouts,
  INACTIVITY_TIMEOUT_MS,
  PROGRESS_THROTTLE_MS,
  REQUEST_TIMEOUT_MS,
} from '../analysis-timeouts'
import {
  CodexAppServerClient,
  CodexSpawnError,
  JsonRpcRemoteError,
  type JsonRpcNotification,
} from './codex-app-server-client'

/** Mensaje accionable único para "no hay sesión de Codex". */
const CODEX_LOGIN_HINT =
  'Codex no tiene una sesión válida: corré «codex login» en una terminal (con tu cuenta ' +
  'ChatGPT Plus/Pro) y volvé a intentar el análisis.'

/** Info de cliente que se envía en `initialize` (aparece en el `userAgent` que arma el server). */
const CLIENT_INFO = { name: 'minerva', title: 'Minerva', version: '0.1.0' }

interface AccountReadResult {
  account: { type?: string; email?: string | null; planType?: string } | null
  requiresOpenaiAuth?: boolean
}

interface ThreadStartResult {
  thread?: { id?: string }
}

/** El texto del asistente llega SOLO por `item/agentMessage/delta` con `params.delta` (string). */
function extractAgentDelta(notification: JsonRpcNotification): string | null {
  if (notification.method !== 'item/agentMessage/delta') return null
  const params = notification.params
  if (!params || typeof params !== 'object') return null
  const delta = (params as Record<string, unknown>).delta
  return typeof delta === 'string' && delta.length > 0 ? delta : null
}

/** `true` si `account/read` no reporta una cuenta (sesión ausente). `requiresOpenaiAuth` se ignora a propósito: es `true` aun con sesión válida. */
function isUnauthenticated(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true
  return (result as AccountReadResult).account == null
}

/** Extrae el id de thread de la respuesta a `thread/start` (`result.thread.id`). */
function extractThreadId(result: unknown): string {
  const id = (result as ThreadStartResult | null)?.thread?.id
  if (typeof id === 'string' && id.length > 0) return id
  throw new Error('codex app-server no devolvió un id de thread en la respuesta a "thread/start".')
}

/** Mensaje de error de una notificación `error` del servidor, o de un `turn/completed` con `turn.status: 'failed'`. */
function turnFailureMessage(notification: JsonRpcNotification): string | null {
  const params = notification.params as Record<string, unknown> | undefined
  if (notification.method === 'error') {
    const message = params?.message
    return typeof message === 'string' ? message : 'Codex devolvió un error durante el turno.'
  }
  if (notification.method === 'turn/completed') {
    const turn = params?.turn as { status?: string; error?: unknown } | undefined
    if (turn?.status === 'failed') {
      const err = turn.error
      if (err && typeof err === 'object') {
        const m = (err as Record<string, unknown>).message
        if (typeof m === 'string') return m
      }
      return 'El turno de Codex terminó en estado "failed".'
    }
  }
  return null
}

export class CodexAiService implements AiService {
  constructor(private readonly github: GithubService) {}

  async analyzePullRequest(
    req: IpcRequest<'ai:analyzePullRequest'>,
    options?: AnalyzePullRequestOptions,
  ): Promise<GeneratedAnalysis> {
    const { model, options: modelOptions } = getEffectiveAiSelection()

    const [detail, files] = await Promise.all([
      this.github.getPullRequestDetail(req),
      this.github.getPullRequestFiles(req),
    ])

    const userMessage = buildUserMessage(detail, files)

    const controller = new AbortController()
    const timeouts = createAnalysisTimeouts(controller)

    const parser = new StreamSectionParser()
    const throttle = createThrottle(PROGRESS_THROTTLE_MS)
    const onProgress = options?.onProgress
    let sawAnyDelta = false

    let client: CodexAppServerClient | null = null
    controller.signal.addEventListener('abort', () => client?.kill())

    const abortErrorMessage = (): string | null => {
      const reason = timeouts.getAbortReason()
      if (reason === 'inactivity-timeout') {
        return (
          'Codex dejó de enviar datos: sin ningún fragmento nuevo por más de ' +
          INACTIVITY_TIMEOUT_MS / 1000 +
          's (timeout de inactividad).'
        )
      }
      if (reason === 'total-timeout') {
        return 'Codex no respondió a tiempo (timeout total de ' + REQUEST_TIMEOUT_MS / 1000 + 's).'
      }
      return null
    }

    timeouts.resetInactivityTimer()

    try {
      client = new CodexAppServerClient()

      await client.request('initialize', {
        clientInfo: CLIENT_INFO,
        capabilities: { experimentalApi: true, requestAttestation: false },
      })
      client.notify('initialized', undefined)

      let account: unknown
      try {
        account = await client.request('account/read', { refreshToken: false })
      } catch (error) {
        throw new Error(CODEX_LOGIN_HINT, { cause: error })
      }
      if (isUnauthenticated(account)) {
        throw new Error(CODEX_LOGIN_HINT)
      }

      const threadResult = await client.request('thread/start', {
        model,
        baseInstructions: ANALYZE_PR_SYSTEM_PROMPT,
        sandbox: 'read-only',
        approvalPolicy: 'never',
      })
      const threadId = extractThreadId(threadResult)

      // El fin del turno es una NOTIFICACIÓN (`turn/completed`), no la
      // resolución de `turn/start` (que es un ack inmediato). Esta promesa se
      // resuelve/rechaza desde el listener de notificaciones de abajo.
      let resolveTurn!: () => void
      let rejectTurn!: (error: Error) => void
      const turnDone = new Promise<void>((resolve, reject) => {
        resolveTurn = resolve
        rejectTurn = reject
      })

      const unsubscribe = client.onNotification((notification) => {
        timeouts.resetInactivityTimer()

        const delta = extractAgentDelta(notification)
        if (delta !== null) {
          sawAnyDelta = true
          parser.push(delta)
          if (onProgress && throttle.shouldRun()) {
            onProgress(parser.snapshot(), { done: false })
          }
          return
        }

        const failure = turnFailureMessage(notification)
        if (failure !== null) {
          rejectTurn(new Error('Codex devolvió un error: ' + failure))
          return
        }
        if (notification.method === 'turn/completed') {
          resolveTurn()
        }
      })

      // `turn/start` resuelve con un ack (`inProgress`); se await-ea solo para
      // capturar un fallo temprano (id de thread inválido, etc.). El resultado
      // NO significa que el turno terminó.
      try {
        await client.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: userMessage, text_elements: [] }],
          // `effort` (T36) SOLO se manda si `modelOptions.effort` resolvió a
          // algo (T34 ya lo valida contra las choices reales del modelo
          // activo, vía `model/list`/T35): si el modelo activo no tiene
          // descriptor de effort, `modelOptions.effort` es `undefined` y el
          // campo se omite ENTERO — mismo comportamiento de hoy (Codex decide
          // su default).
          ...(modelOptions.effort ? { effort: modelOptions.effort } : {}),
        })
        await turnDone
      } finally {
        unsubscribe()
      }
    } catch (error) {
      timeouts.clearAll()
      const abortMessage = abortErrorMessage()
      if (abortMessage) throw new Error(abortMessage, { cause: error })
      if (error instanceof CodexSpawnError) {
        throw new Error('Codex no se pudo lanzar: ' + error.message, { cause: error })
      }
      if (error instanceof JsonRpcRemoteError) {
        throw new Error('Codex devolvió un error: ' + error.message, { cause: error })
      }
      throw error
    } finally {
      client?.kill()
    }

    timeouts.clearAll()

    if (!sawAnyDelta) {
      throw new Error(
        'Codex no devolvió contenido de streaming (revisá que la sesión siga activa: «codex login»).',
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
