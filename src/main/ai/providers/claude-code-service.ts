/**
 * Implementación real de `AiService` con el Agent SDK OFICIAL de Anthropic
 * (`@anthropic-ai/claude-agent-sdk`, T28), usando la sesión de Claude
 * Pro/Max que el usuario ya autenticó en su máquina con `claude login` — NO
 * hay OAuth propio ni headers de suplantación acá: `query()` se autentica
 * solo, leyendo la misma sesión que usa el CLI (ver `.agents/TASKS.md` § F7,
 * "Decisión de arquitectura clave").
 *
 * Pipeline de `analyzePullRequest` (mismo contrato que el resto de los
 * proveedores de IA, ver `../service.ts`):
 * 1. Pide el detalle y los archivos del PR al `GithubService` ACTIVO
 *    (inyectado por constructor, igual que el resto de proveedores).
 * 2. AGÉNTICO (F11/T58): `ensureSnapshot(this.github, req.repo, detail.headSha)`
 *    (`../../github/snapshot-store.ts`, T54) materializa una copia local del
 *    repo AL COMMIT del PR — ese directorio es el `cwd` que se le pasa a
 *    `query()`, y el mensaje de usuario (`buildAgenticUserMessage`, en vez de
 *    `buildUserMessage`) le pide explícitamente que lo explore.
 * 3. Arma el mismo system prompt de producto que el resto de proveedores
 *    (`../prompts/analyze-pr.ts`, `ANALYZE_PR_SYSTEM_PROMPT`) — el SDK lo
 *    recibe por `options.systemPrompt` como STRING CUSTOM (no el preset
 *    `claude_code`): eso reemplaza por completo el prompt de sistema por
 *    defecto de Claude Code en vez de "aparentar ser" el cliente oficial.
 * 4. Llama a `query({ prompt, options })` en modo AGENTE de varias vueltas
 *    (`maxTurns: 30`) con herramientas de SOLO LECTURA (`options.tools:
 *    ['Read', 'Grep', 'Glob']` — nombres verificados contra `sdk.d.ts` del
 *    paquete instalado; NADA de `Write`/`Edit`/`Bash`/`WebFetch`/`WebSearch`/
 *    `Task`. El `.d.ts` no ofrece una tool de listado separada de `Glob`
 *    — `Glob` cubre listar). `options.allowedTools` repite la misma lista y
 *    `options.permissionMode: 'dontAsk'` ("no prompt for permissions, deny
 *    if not pre-approved"): un proceso headless de main NUNCA puede responder
 *    un prompt de permiso interactivo, así que cualquier modo que pueda
 *    quedarse esperando uno (`'default'`, `'plan'`) colgaría hasta el timeout
 *    total; `'dontAsk'` con `allowedTools` acotado a las 3 tools de lectura
 *    es el más restrictivo que sigue siendo utilizable sin humano en el loop
 *    (se prefirió a `'bypassPermissions'`, que exige
 *    `allowDangerouslySkipPermissions: true` y salta TODO permiso en vez de
 *    solo auto-aprobar una whitelist ya acotada por `tools`).
 *    Sigue sin persistir sesión (`persistSession: false`) NI cargar fuentes
 *    de settings del filesystem (`settingSources: []`) — CRÍTICO acá porque
 *    el `cwd` ahora es un snapshot de código de un PR ajeno: sin
 *    `settingSources: []` un `CLAUDE.md`/`.claude/settings.json` hostil
 *    dentro del snapshot podría inyectar instrucciones o disparar hooks
 *    (prompt injection vía contenido no confiable, ver la frontera de
 *    seguridad en `CLAUDE.md` del repo). Verificado con un snapshot de
 *    prueba con un `CLAUDE.md` trampa (T58, ver bitácora en TASKS.md): NO se
 *    carga.
 * 5. `query()` devuelve un `AsyncGenerator<SDKMessage>` (T13-compatible:
 *    streaming real, no un único objeto al final). Con
 *    `includePartialMessages: true` el SDK emite `SDKPartialAssistantMessage`
 *    (`type: 'stream_event'`) por cada evento crudo de la Messages API
 *    (`BetaRawMessageStreamEvent`) — de ahí se extraen SOLO los
 *    `content_block_delta` cuyo `delta.type === 'text_delta'` (se ignoran
 *    `thinking_delta`/`input_json_delta` de tool-use/etc.). Con tools
 *    habilitadas llegan mensajes `assistant`/`stream_event` intermedios por
 *    cada vuelta de tool-use (turnos que solo invocan `Read`/`Grep`/`Glob`
 *    sin emitir texto) — el `for await` ya resetea el timer de inactividad
 *    con CUALQUIER mensaje del stream (`timeouts.resetInactivityTimer()` al
 *    tope del loop, antes del `switch` por tipo), así que esas vueltas
 *    silenciosas no disparan el timeout de inactividad. El `result` final
 *    (`message.type === 'result'`) sigue siendo la única fuente de verdad
 *    para errores de nivel-turno (incluido `subtype: 'error_max_turns'` si
 *    el agente agota las 30 vueltas).
 * 6. Timeouts AGÉNTICOS (`../analysis-timeouts.ts`, T56): total 300s /
 *    inactividad 60s — más altos que los de generación directa porque
 *    explorar el snapshot con herramientas toma varias vueltas antes de la
 *    primera sección — con el `AbortController` que el SDK acepta en
 *    `options.abortController`.
 * 7. Errores mapeados a mensajes accionables: sesión no autenticada
 *    (`SDKAssistantMessage.error === 'authentication_failed'` o
 *    `'oauth_org_not_allowed'`) → "corré `claude login`"; binario del SDK no
 *    encontrado/no pudo lanzarse → mensaje claro sin tecnicismos internos;
 *    timeout total/inactividad → mismo mensaje que los demás proveedores
 *    pero con el nombre de este.
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
import type { IpcRequest } from '../../../shared/ipc'
import type { GeneratedAnalysis } from '../../../shared/types'
import { getEffectiveAiSelection } from '../env'
import { ANALYZE_PR_SYSTEM_PROMPT } from '../prompts/analyze-pr'
import { buildAgenticUserMessage, prId } from '../analysis-prompt'
import { StreamSectionParser } from '../stream-parser'
import { createThrottle } from '../throttle'
import { resolveCliPath } from './resolve-cli'
import { buildSanitizedSpawnEnv } from './spawn-env'
import { ensureSnapshot } from '../../github/snapshot-store'
import {
  AGENTIC_INACTIVITY_TIMEOUT_MS,
  AGENTIC_REQUEST_TIMEOUT_MS,
  createAnalysisTimeouts,
  PROGRESS_THROTTLE_MS,
} from '../analysis-timeouts'

/** Nombres EXACTOS de las tools read-only del Agent SDK (`sdk.d.ts` de `@anthropic-ai/claude-agent-sdk`, verificados contra el paquete instalado en T58): sin `Write`/`Edit`/`Bash`/`WebFetch`/`WebSearch`/`Task`. No existe una tool de listado separada de `Glob` en este SDK. */
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob']

/** Cuántas vueltas de tool-use + generación se permiten como máximo antes de que el SDK corte con `result.subtype: 'error_max_turns'` (F11/T58: exploración del snapshot con herramientas, no una sola generación). */
const AGENTIC_MAX_TURNS = 30

/** Mensaje accionable cuando `resolveCliPath('claude')` no encuentra el binario en ninguna ubicación conocida. */
const CLAUDE_CLI_NOT_FOUND_MESSAGE =
  'No se encontró el CLI "claude" instalado: instalá Claude Code (ver ' +
  'https://code.claude.com/docs/en/setup) y corré «claude login» antes de ' +
  'analizar con este proveedor.'

/** Mismo union que `EffortLevel` del Agent SDK (`sdk.d.ts`), repetido acá para no importar un tipo interno solo para esto. */
type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Punto ÚNICO de normalización defensiva del `effort` antes de pasarlo al
 * Agent SDK (T36, mismo espíritu que `normalizeClaudeCliEffort` de t3code).
 * Hoy es casi identidad: T34 (`resolveOptionValue`, `../../../shared/
 * ai-providers.ts`) ya resuelve `effort` contra las choices REALES del
 * modelo activo (fable-5/opus-4.8/sonnet-5 soportan `low..max` completo;
 * haiku-4-5 sin `xhigh`/`max`), así que cualquier valor que llegue acá ya es
 * válido para `model` — no hay remapeo que hacer con el catálogo actual.
 * Existe como HOOK explícito para el día en que el CLI/SDK instalado sea más
 * viejo que el catálogo (p. ej. una versión sin soporte de `xhigh`/`max`
 * aunque el catálogo ya los ofrezca): ese día este es el ÚNICO lugar a
 * tocar para remapear (p. ej. `xhigh`→`max` o `max`→`high`), sin bifurcar el
 * resto del servicio. `model` se recibe para que un futuro remapeo pueda ser
 * específico de modelo, aunque hoy no se use.
 */
export function normalizeClaudeEffort(effort: string, model: string): ClaudeEffort {
  void model
  return effort as ClaudeEffort
}

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
  ): Promise<GeneratedAnalysis> {
    const { model, options: modelOptions } = getEffectiveAiSelection()

    const claudeCliPath = resolveCliPath('claude')
    if (claudeCliPath === null) {
      throw new Error(CLAUDE_CLI_NOT_FOUND_MESSAGE)
    }

    const [detail, files] = await Promise.all([
      this.github.getPullRequestDetail(req),
      this.github.getPullRequestFiles(req),
    ])

    // AGÉNTICO (F11/T58): copia local del repo al commit del PR — el `cwd`
    // que `query()` explora con `Read`/`Grep`/`Glob` (ver el comentario del
    // módulo). Dedupeado/cacheado en disco por `ensureSnapshot` (T54): un
    // segundo análisis del mismo repo+sha no vuelve a pagar la descarga.
    const snapshotDir = await ensureSnapshot(this.github, req.repo, detail.headSha)

    const userMessage = buildAgenticUserMessage(detail, files)

    const controller = new AbortController()
    const timeouts = createAnalysisTimeouts(controller, {
      totalMs: AGENTIC_REQUEST_TIMEOUT_MS,
      inactivityMs: AGENTIC_INACTIVITY_TIMEOUT_MS,
    })

    // `AbortError` es la clase que exporta el propio SDK (no una
    // `DOMException` nativa), así que se distingue por `instanceof`, no por
    // `.name` (el SDK no le pone un `.name` custom).
    const abortErrorMessage = (error: unknown): string | null => {
      if (!(error instanceof AbortError)) return null
      if (timeouts.getAbortReason() === 'inactivity-timeout') {
        return (
          'Claude Code dejó de enviar datos: sin ningún fragmento nuevo por más de ' +
          AGENTIC_INACTIVITY_TIMEOUT_MS / 1000 +
          's (timeout de inactividad).'
        )
      }
      return (
        'Claude Code no respondió a tiempo (timeout total de ' + AGENTIC_REQUEST_TIMEOUT_MS / 1000 + 's).'
      )
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
          // AGÉNTICO (F11/T58): el agente explora el snapshot local del PR,
          // NO el `process.cwd()` de Electron.
          cwd: snapshotDir,
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
          // Solo lectura: `Read`/`Grep`/`Glob` (ver el comentario del módulo
          // y `READ_ONLY_TOOLS` arriba) — NADA de Write/Edit/Bash/WebFetch/
          // WebSearch/Task. `allowedTools` + `permissionMode: 'dontAsk'`
          // auto-aprueban esas 3 sin poder colgarse esperando un prompt de
          // permiso que nadie puede responder en un proceso headless.
          tools: READ_ONLY_TOOLS,
          allowedTools: READ_ONLY_TOOLS,
          permissionMode: 'dontAsk',
          // Loop de agente de varias vueltas (explorar con tools antes de
          // escribir secciones), no una sola generación.
          maxTurns: AGENTIC_MAX_TURNS,
          // Nunca persistir esta sesión efímera en `~/.claude/projects/` ni
          // heredar settings/hooks del filesystem — CRÍTICO ahora que el
          // `cwd` es un snapshot de código de un PR ajeno (ver comentario del
          // módulo: puede traer un `CLAUDE.md`/`.claude/settings.json`
          // hostil).
          persistSession: false,
          settingSources: [],
          includePartialMessages: true,
          abortController: controller,
          // `effort` (T36) SOLO si `modelOptions.effort` resolvió a algo (T34
          // ya lo valida contra las choices reales de `model`, vía el catálogo
          // de `../../../shared/ai-providers.ts`): un modelo sin descriptor
          // de effort deja `modelOptions.effort` en `undefined` y el campo se
          // omite ENTERO, dejando que el SDK use su propio default — mismo
          // comportamiento que antes de T36.
          ...(modelOptions.effort
            ? { effort: normalizeClaudeEffort(modelOptions.effort, model) }
            : {}),
        },
      })

      for await (const message of stream) {
        // Se resetea con CUALQUIER mensaje del stream, no solo con deltas de
        // texto: en modo agéntico llegan vueltas enteras de tool-use
        // (`Read`/`Grep`/`Glob` explorando el snapshot) sin emitir texto —
        // esas vueltas siguen contando como "el agente está vivo" y no deben
        // disparar el timeout de inactividad.
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
          // El `result` FINAL (uno por análisis, tras la última vuelta) es la
          // única fuente de verdad para errores de nivel-turno, incluido
          // `subtype: 'error_max_turns'` si el agente agota `maxTurns` sin
          // terminar. Los `assistant`/`stream_event` intermedios de cada
          // vuelta de tool-use ya se manejaron arriba (o se ignoraron).
          if (message.is_error) {
            const detailText = message.subtype === 'success' ? message.result : message.errors.join('; ')
            throw new Error('Claude Code devolvió un error: ' + detailText)
          }
          continue
        }

        // Cualquier otro tipo (system/init, task_*, hook_*, tool_use interno
        // del SDK, etc.): irrelevante para el parseo de secciones, se ignora.
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
