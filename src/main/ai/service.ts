/**
 * Interfaz de la capa IA en `main`. Un único método que espeja el canal IPC
 * `ai:analyzePullRequest` (`src/shared/ipc.ts`): el tipo de request/response
 * se toma de ahí (`IpcRequest`/`IpcResponse`) para no duplicar formas entre
 * el contrato IPC y esta interfaz.
 *
 * Dos implementaciones conviven detrás de esta interfaz:
 * - `MockAiService` (`./mock-service.ts`), disponible desde T9(mock)/T10.
 * - `OpenRouterAiService` (`./openrouter-service.ts`, T9-final): pipeline
 *   real contra OpenRouter (prompt versionado en `./prompts/analyze-pr.ts`),
 *   activo cuando hay `OPENROUTER_API_KEY` (ver `./env.ts`).
 *
 * `src/main/ipc/handlers.ts` delega el canal `ai:analyzePullRequest` a una
 * única instancia creada por `createAiService(githubService)` (`./index.ts`).
 *
 * T13 (streaming): `analyzePullRequest` acepta un segundo parámetro opcional
 * con `onProgress`, invocado cero o más veces DURANTE el análisis con un
 * snapshot parcial (`DraftDidacticSection[]`, `../../shared/events.ts`) y
 * exactamente una vez más al terminar (`meta.done === true`, con las
 * secciones finales). El valor de retorno de la promesa sigue siendo el
 * `DidacticAnalysis` completo de siempre — `onProgress` es solo para pintar
 * el panel en vivo mientras tanto, nunca la única forma de obtener el
 * resultado. Ambas implementaciones lo soportan: `OpenRouterAiService` lo
 * alimenta con los deltas SSE reales; `MockAiService` lo simula dividiendo
 * sus fixtures en trozos con un delay fijo, para poder verificar el
 * streaming end-to-end sin key ni costo.
 */
import type { IpcRequest, IpcResponse } from '../../shared/ipc'
import type { DraftDidacticSection } from '../../shared/events'

export interface AnalyzeProgressMeta {
  /** `true` en la última llamada a `onProgress`: el análisis ya terminó (con éxito). */
  done: boolean
}

export type AnalyzeProgressCallback = (
  sections: DraftDidacticSection[],
  meta: AnalyzeProgressMeta,
) => void

export interface AnalyzePullRequestOptions {
  onProgress?: AnalyzeProgressCallback
}

export interface AiService {
  analyzePullRequest(
    req: IpcRequest<'ai:analyzePullRequest'>,
    options?: AnalyzePullRequestOptions,
  ): Promise<IpcResponse<'ai:analyzePullRequest'>>
}
