/**
 * Implementación real de `AiService` con OpenRouter (API OpenAI-compatible,
 * `POST /chat/completions`), para poder alternar entre múltiples LLMs sin
 * cambiar de proveedor (decisión de Edilson, ver `.agents/PLAN.md`).
 *
 * Pipeline de `analyzePullRequest` (T13: streaming vía SSE, ver más abajo):
 * 1. Pide el detalle y los archivos del PR al `GithubService` ACTIVO
 *    (inyectado por constructor — funciona igual con el mock que con el
 *    real, ver `./index.ts`).
 * 2. Arma el prompt: system prompt versionado (`./prompts/analyze-pr.ts`,
 *    que desde T13 pide el protocolo de texto tagueado por líneas, no JSON)
 *    + mensaje de usuario con metadatos + diffs (`./analysis-prompt.ts`,
 *    compartido con el resto de proveedores desde T28 — ver ese archivo).
 * 3. Llama a OpenRouter con `fetch` nativo (sin SDK, sin dependencias
 *    nuevas) con `stream: true`, y lee la respuesta como Server-Sent Events
 *    (`data: {...}\n\n`, terminada en `data: [DONE]`) a mano con el reader
 *    del `ReadableStream` de `response.body` — sin librería de SSE, el
 *    formato es simple y ya se controla el parseo línea a línea igual que
 *    `./stream-parser.ts`.
 * 4. Cada delta de texto (`choices[0].delta.content`) se empuja a un
 *    `StreamSectionParser` (`./stream-parser.ts`); un snapshot navegable se
 *    publica por `onProgress` con throttle (`./throttle.ts`, ~150ms) para no
 *    saturar de eventos IPC al renderer. Al terminar el stream,
 *    `parser.finalize()` da el `DidacticSection[]` final (misma validación
 *    que antes vivía en `mapSections`, reutilizada vía `mapRawSection`).
 * 5. Dos timeouts con el mismo `AbortController` (`./analysis-timeouts.ts`,
 *    compartido con `ClaudeCodeAiService` desde T28): total (120s, todo el
 *    análisis) e inactividad (20s sin recibir NINGÚN delta) — cualquiera de
 *    los dos aborta la conexión con un mensaje que dice cuál fue.
 *
 * La API key nunca se loguea ni se incluye en ningún mensaje de error.
 */
import type { AiService, AnalyzePullRequestOptions } from './service'
import type { GithubService } from '../github/service'
import type { IpcRequest, IpcResponse } from '../../shared/ipc'
import { getAiEnv } from './env'
import { ANALYZE_PR_SYSTEM_PROMPT } from './prompts/analyze-pr'
import { buildUserMessage, prId } from './analysis-prompt'
import { StreamSectionParser } from './stream-parser'
import { createThrottle } from './throttle'
import {
  createAnalysisTimeouts,
  INACTIVITY_TIMEOUT_MS,
  PROGRESS_THROTTLE_MS,
  REQUEST_TIMEOUT_MS,
} from './analysis-timeouts'

// Re-exportado por compatibilidad: `buildUserMessage` vivía acá hasta T28
// (`./openrouter-service.test.ts` lo importa desde este módulo).
export { buildUserMessage }

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Recomendados por OpenRouter para atribuir la app en su dashboard/rankings
// (no son secretos): https://openrouter.ai/docs/quickstart
const HTTP_REFERER = 'https://github.com/edygg/proj_minerva'
const APP_TITLE = 'proj_minerva'

interface OpenRouterStreamDelta {
  content?: string | null
}

interface OpenRouterStreamChoice {
  delta?: OpenRouterStreamDelta
}

interface OpenRouterStreamChunk {
  choices?: OpenRouterStreamChoice[]
}

function mapHttpError(status: number, bodyPreview: string): string {
  switch (status) {
    case 401:
      return 'API key de OpenRouter inválida.'
    case 402:
      return 'Sin créditos en OpenRouter.'
    case 429:
      return 'Rate limit de OpenRouter: intenta de nuevo en unos segundos.'
    default:
      return (
        'OpenRouter respondió con error (status ' +
        status +
        ')' +
        (bodyPreview ? ': ' + bodyPreview : '.')
      )
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 300)
  } catch {
    return ''
  }
}

export class OpenRouterAiService implements AiService {
  constructor(private readonly github: GithubService) {}

  async analyzePullRequest(
    req: IpcRequest<'ai:analyzePullRequest'>,
    options?: AnalyzePullRequestOptions,
  ): Promise<IpcResponse<'ai:analyzePullRequest'>> {
    const { openRouterApiKey, aiModel } = getAiEnv()
    if (!openRouterApiKey) {
      // No debería pasar en la práctica: `createAiService` (./index.ts) solo
      // instancia este servicio cuando hay key. Defensivo por si alguien lo
      // instancia directamente.
      throw new Error('OpenRouter no está configurado (falta OPENROUTER_API_KEY).')
    }

    const [detail, files] = await Promise.all([
      this.github.getPullRequestDetail(req),
      this.github.getPullRequestFiles(req),
    ])

    const userMessage = buildUserMessage(detail, files)

    const controller = new AbortController()
    const timeouts = createAnalysisTimeouts(controller)

    // Se preserva `cause` para no perder el error original en herramientas de
    // diagnóstico locales (nunca cruza IPC: `register.ts` solo reenvía
    // `message` al renderer, ver su comentario). `null` si `error` no es un
    // abort de NUESTRO controller (p. ej. un error de red normal).
    const abortErrorMessage = (error: unknown): string | null => {
      if (!(error instanceof Error) || error.name !== 'AbortError') return null
      if (timeouts.getAbortReason() === 'inactivity-timeout') {
        return (
          'OpenRouter dejó de enviar datos: sin ningún fragmento nuevo por más de ' +
          INACTIVITY_TIMEOUT_MS / 1000 +
          's (timeout de inactividad).'
        )
      }
      return 'OpenRouter no respondió a tiempo (timeout total de ' + REQUEST_TIMEOUT_MS / 1000 + 's).'
    }

    let response: Response
    try {
      response = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + openRouterApiKey,
          'HTTP-Referer': HTTP_REFERER,
          'X-Title': APP_TITLE,
        },
        body: JSON.stringify({
          model: aiModel,
          stream: true,
          messages: [
            { role: 'system', content: ANALYZE_PR_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
        }),
        signal: controller.signal,
      })
    } catch (error) {
      timeouts.clearAll()
      const abortMessage = abortErrorMessage(error)
      if (abortMessage) {
        throw new Error(abortMessage, { cause: error })
      }
      throw new Error(
        'No se pudo conectar con OpenRouter: ' +
          (error instanceof Error ? error.message : 'error desconocido'),
        { cause: error },
      )
    }

    if (!response.ok) {
      timeouts.clearAll()
      throw new Error(mapHttpError(response.status, await safeReadText(response)))
    }

    const reader = response.body?.getReader()
    if (!reader) {
      timeouts.clearAll()
      throw new Error('OpenRouter no devolvió un stream legible (posible incompatibilidad de streaming).')
    }

    const parser = new StreamSectionParser()
    const throttle = createThrottle(PROGRESS_THROTTLE_MS)
    const onProgress = options?.onProgress
    const decoder = new TextDecoder()
    let sseBuffer = ''
    let sawAnyDelta = false

    timeouts.resetInactivityTimer()

    try {
      for (;;) {
        let readResult
        try {
          readResult = await reader.read()
        } catch (error) {
          const abortMessage = abortErrorMessage(error)
          if (abortMessage) throw new Error(abortMessage, { cause: error })
          throw new Error(
            'Se perdió la conexión con OpenRouter durante el streaming: ' +
              (error instanceof Error ? error.message : 'error desconocido'),
            { cause: error },
          )
        }

        if (readResult.done) break
        timeouts.resetInactivityTimer()

        sseBuffer += decoder.decode(readResult.value, { stream: true })
        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop() ?? ''

        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line.startsWith('data:')) continue

          const data = line.slice('data:'.length).trim()
          if (data === '[DONE]' || data.length === 0) continue

          let chunk: OpenRouterStreamChunk
          try {
            chunk = JSON.parse(data) as OpenRouterStreamChunk
          } catch {
            continue // Línea SSE no-JSON (comentario/keep-alive de OpenRouter): se ignora.
          }

          const delta = chunk.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            sawAnyDelta = true
            parser.push(delta)
            if (onProgress && throttle.shouldRun()) {
              onProgress(parser.snapshot(), { done: false })
            }
          }
        }
      }
    } finally {
      timeouts.clearAll()
    }

    if (!sawAnyDelta) {
      throw new Error(
        'OpenRouter no devolvió contenido de streaming (el modelo elegido podría no soportar streaming).',
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
