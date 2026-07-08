/**
 * Implementación real de `AiService` con el Agent SDK OFICIAL de Anthropic
 * (`@anthropic-ai/claude-agent-sdk`, T28), usando la sesión de Claude
 * Pro/Max que el usuario ya autenticó en su máquina con `claude login` — NO
 * hay OAuth propio ni headers de suplantación acá: `query()` se autentica
 * solo, leyendo la misma sesión que usa el CLI (ver `.agents/TASKS.md` § F7,
 * "Decisión de arquitectura clave").
 *
 * Pipeline de `analyzePullRequest` (mismo contrato que `OpenRouterAiService`,
 * ver `../service.ts`):
 * 1. Pide el detalle y los archivos del PR al `GithubService` ACTIVO
 *    (inyectado por constructor, igual que el resto de proveedores).
 * 2. Arma el mismo prompt de usuario que OpenRouter (`../analysis-prompt.ts`,
 *    compartido desde T28) y el mismo system prompt de producto
 *    (`../prompts/analyze-pr.ts`, `ANALYZE_PR_SYSTEM_PROMPT`) — el SDK lo
 *    recibe por `options.systemPrompt` como STRING CUSTOM (no el preset
 *    `claude_code`): eso reemplaza por completo el prompt de sistema por
 *    defecto de Claude Code en vez de "aparentar ser" el cliente oficial.
 * 3. Llama a `query({ prompt, options })` de una SOLA vuelta de generación,
 *    sin herramientas (`options.tools: []` — deshabilita TODAS las
 *    herramientas built-in; no es un loop de agente) ni persistencia de
 *    sesión (`persistSession: false`) ni fuentes de settings del filesystem
 *    (`settingSources: []`, para no heredar hooks/CLAUDE.md de lo que sea
 *    que `process.cwd()` resuelva a en el proceso de Electron — un análisis
 *    headless no debe disparar hooks arbitrarios de `~/.claude/settings.json`
 *    ni de un `.claude/settings.json` de proyecto ajeno).
 * 4. `query()` devuelve un `AsyncGenerator<SDKMessage>` (T13-compatible:
 *    streaming real, no un único objeto al final). Con
 *    `includePartialMessages: true` el SDK emite `SDKPartialAssistantMessage`
 *    (`type: 'stream_event'`) por cada evento crudo de la Messages API
 *    (`BetaRawMessageStreamEvent`) — de ahí se extraen SOLO los
 *    `content_block_delta` cuyo `delta.type === 'text_delta'` (se ignoran
 *    `thinking_delta`/`input_json_delta`/etc., y cualquier mensaje que no
 *    sea de texto: `system` de init, `stream_event` de tool-use si algo se
 *    colara, etc.) y se empujan a un `StreamSectionParser`
 *    (`../stream-parser.ts`), exactamente como los deltas SSE de OpenRouter.
 * 5. Mismos timeouts que OpenRouter (`../analysis-timeouts.ts`): total 120s /
 *    inactividad 20s, con el `AbortController` que el SDK acepta en
 *    `options.abortController`.
 * 6. Errores mapeados a mensajes accionables: sesión no autenticada
 *    (`SDKAssistantMessage.error === 'authentication_failed'` o
 *    `'oauth_org_not_allowed'`) → "corré `claude login`"; binario del SDK no
 *    encontrado/no pudo lanzarse → mensaje claro sin tecnicismos internos;
 *    timeout total/inactividad → mismo mensaje que OpenRouter pero con el
 *    nombre de este proveedor.
 *
 * Nunca se loguea contenido de la sesión ni tokens: el SDK los maneja
 * internamente (viven en `~/.claude/`, fuera del alcance de Minerva).
 *
 * RESOLUCIÓN DEL BINARIO (T31): `@anthropic-ai/claude-agent-sdk` trae un
 * binario nativo por plataforma como dependencia opcional (~250MB por SO),
 * que Minerva NO bundlea (excluido en `electron-builder.yml`, ver TASKS.md
 * § T31) — en su lugar se usa el `claude` que el usuario ya instaló con el
 * instalador oficial. `./resolve-cli.ts` busca ese binario en `PATH` y en
 * ubicaciones comunes (un proceso GUI puede no heredar el `PATH` completo de
 * una terminal) y su resultado se pasa por `options.pathToClaudeCodeExecutable`
 * — sin esto el SDK intentaría lanzar el binario bundleado que ya no existe
 * en el paquete de producción. Si no se encuentra, se falla ANTES de llamar
 * a `query()` con el mismo mensaje accionable que el resto de los casos de
 * "no autenticado" (el usuario necesita instalar el CLI de todos modos).
 */
import { AbortError, query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk'
import type { AiService, AnalyzePullRequestOptions } from '../service'
import type { GithubService } from '../../github/service'
import type { IpcRequest, IpcResponse } from '../../../shared/ipc'
import { getEffectiveAiSelection } from '../env'
import { ANALYZE_PR_SYSTEM_PROMPT } from '../prompts/analyze-pr'
import { buildUserMessage, prId } from '../analysis-prompt'
import { StreamSectionParser } from '../stream-parser'
import { createThrottle } from '../throttle'
import { resolveCliPath } from './resolve-cli'
import { buildSanitizedSpawnEnv } from './spawn-env'
import {
  createAnalysisTimeouts,
  INACTIVITY_TIMEOUT_MS,
  PROGRESS_THROTTLE_MS,
  REQUEST_TIMEOUT_MS,
} from '../analysis-timeouts'

/** Mensaje accionable cuando `resolveCliPath('claude')` no encuentra el binario en ninguna ubicación conocida. */
const CLAUDE_CLI_NOT_FOUND_MESSAGE =
  'No se encontró el CLI "claude" instalado: instalá Claude Code (ver ' +
  'https://docs.claude.com/en/docs/claude-code/overview) y corré «claude login» antes de ' +
  'analizar con este proveedor.'

/** Mensaje accionable por cada código de error que puede traer un `SDKAssistantMessage`/`SDKResultMessage`. */
function mapAssistantError(code: SDKAssistantMessageError | string): string {
  switch (code) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
      return (
        'Claude Code no tiene una sesión válida: corré «claude login» en una terminal ' +
        '(con la cuenta Pro/Max que quieras usar) y volvé a intentar el análisis.'
      )
    case 'billing_error':
      return 'La cuenta de Claude autenticada reportó un problema de facturación.'
    case 'rate_limit':
      return 'Rate limit de Claude Code: intenta de nuevo en unos minutos.'
    case 'overloaded':
      return 'Claude está sobrecargado en este momento: intenta de nuevo más tarde.'
    case 'model_not_found':
      return 'El modelo de Claude Code seleccionado no existe o no está disponible para esta cuenta.'
    case 'max_output_tokens':
      return 'Claude Code cortó la respuesta por límite de tokens de salida.'
    default:
      return 'Claude Code devolvió un error (' + code + ').'
  }
}

/** `true` si el mensaje de un error de spawn/proceso sugiere que el binario del Agent SDK no se pudo lanzar. */
function looksLikeMissingCli(message: string): boolean {
  return /executable not found|native binary|ENOENT|Failed to spawn/i.test(message)
}

export class ClaudeCodeAiService implements AiService {
  constructor(private readonly github: GithubService) {}

  async analyzePullRequest(
    req: IpcRequest<'ai:analyzePullRequest'>,
    options?: AnalyzePullRequestOptions,
  ): Promise<IpcResponse<'ai:analyzePullRequest'>> {
    const { model } = getEffectiveAiSelection()

    const claudeCliPath = resolveCliPath('claude')
    if (claudeCliPath === null) {
      throw new Error(CLAUDE_CLI_NOT_FOUND_MESSAGE)
    }

    const [detail, files] = await Promise.all([
      this.github.getPullRequestDetail(req),
      this.github.getPullRequestFiles(req),
    ])

    const userMessage = buildUserMessage(detail, files)

    const controller = new AbortController()
    const timeouts = createAnalysisTimeouts(controller)

    // Mismo espíritu que `OpenRouterAiService.abortErrorMessage`: `AbortError`
    // es la clase que exporta el propio SDK (no una `DOMException` nativa),
    // así que se distingue por `instanceof`, no por `.name` (el SDK no le
    // pone un `.name` custom).
    const abortErrorMessage = (error: unknown): string | null => {
      if (!(error instanceof AbortError)) return null
      if (timeouts.getAbortReason() === 'inactivity-timeout') {
        return (
          'Claude Code dejó de enviar datos: sin ningún fragmento nuevo por más de ' +
          INACTIVITY_TIMEOUT_MS / 1000 +
          's (timeout de inactividad).'
        )
      }
      return 'Claude Code no respondió a tiempo (timeout total de ' + REQUEST_TIMEOUT_MS / 1000 + 's).'
    }

    const parser = new StreamSectionParser()
    const throttle = createThrottle(PROGRESS_THROTTLE_MS)
    const onProgress = options?.onProgress
    let sawAnyDelta = false

    timeouts.resetInactivityTimer()

    try {
      const stream = query({
        prompt: userMessage,
        options: {
          model,
          // Ruta absoluta resuelta arriba (T31): el binario bundleado por
          // plataforma del SDK no se empaqueta, así que sin esto `query()`
          // intentaría lanzar un binario que no existe en producción.
          pathToClaudeCodeExecutable: claudeCliPath,
          // Entorno saneado del proceso hijo que el SDK spawnea: no hereda
          // secretos de OTROS proveedores (mismo criterio que
          // `./codex-app-server-client.ts`, ver `./spawn-env.ts`). El SDK
          // reemplaza el entorno del subproceso ENTERO con este objeto (no
          // lo mergea con `process.env`), por eso se parte de una copia.
          env: buildSanitizedSpawnEnv(),
          // STRING custom: reemplaza el prompt de sistema por defecto de
          // Claude Code, no lo extiende (ver el comentario de arriba —
          // nunca usar el preset `claude_code` con `append` acá, eso sería
          // "aparentar" ser el cliente oficial).
          systemPrompt: ANALYZE_PR_SYSTEM_PROMPT,
          // Una sola vuelta de generación: sin herramientas (no un loop de
          // agente) y sin más de un turno aunque el modelo insista.
          tools: [],
          maxTurns: 1,
          // Nunca persistir esta sesión efímera en `~/.claude/projects/` ni
          // heredar settings/hooks del filesystem (ver comentario de arriba).
          persistSession: false,
          settingSources: [],
          includePartialMessages: true,
          abortController: controller,
        },
      })

      for await (const message of stream) {
        timeouts.resetInactivityTimer()

        if (message.type === 'stream_event') {
          const event = message.event
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            sawAnyDelta = true
            parser.push(event.delta.text)
            if (onProgress && throttle.shouldRun()) {
              onProgress(parser.snapshot(), { done: false })
            }
          }
          continue
        }

        if (message.type === 'assistant') {
          if (message.error) {
            throw new Error(mapAssistantError(message.error))
          }
          continue
        }

        if (message.type === 'result') {
          if (message.is_error) {
            const detailText = message.subtype === 'success' ? message.result : message.errors.join('; ')
            throw new Error('Claude Code devolvió un error: ' + detailText)
          }
          continue
        }

        // Cualquier otro tipo (system/init, task_*, hook_*, etc.): irrelevante
        // para este análisis de una sola vuelta sin herramientas, se ignora.
      }
    } catch (error) {
      timeouts.clearAll()
      const abortMessage = abortErrorMessage(error)
      if (abortMessage) throw new Error(abortMessage, { cause: error })
      if (error instanceof Error && looksLikeMissingCli(error.message)) {
        throw new Error(
          'Claude Code (Agent SDK) no encontró un binario ejecutable: ' + error.message,
          { cause: error },
        )
      }
      throw error
    }

    timeouts.clearAll()

    if (!sawAnyDelta) {
      throw new Error(
        'Claude Code no devolvió contenido de streaming (revisa que la sesión siga activa: «claude login»).',
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
