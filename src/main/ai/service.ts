/**
 * Interfaz de la capa IA en `main`. Un único método que espeja el canal IPC
 * `ai:analyzePullRequest` (`src/shared/ipc.ts`) en su `req` (se toma
 * `IpcRequest` de ahí para no duplicar la forma); su `res` YA NO es
 * `IpcResponse<'ai:analyzePullRequest'>` (T39, ver más abajo).
 *
 * Varias implementaciones conviven detrás de esta interfaz:
 * - `MockAiService` (`./mock-service.ts`), disponible desde T9(mock)/T10.
 * - `ClaudeCodeAiService`/`CodexAiService`/`OpenCodeAiService`
 *   (`./providers/*-service.ts`, T28/T29/T56): pipeline real contra el CLI
 *   oficial de cada proveedor (prompt versionado en `./prompts/analyze-pr.ts`),
 *   activo cuando `./providers/cli-probe.ts` confirma sesión iniciada (ver
 *   `./index.ts`). Hasta T59 había una cuarta, `OpenRouterAiService`, que
 *   hablaba HTTP directo con `openrouter.ai` — eliminada por decisión de
 *   Edilson (esos modelos se usan ahora DENTRO de OpenCode).
 *
 * `src/main/ipc/handlers.ts` delega el canal `ai:analyzePullRequest` a una
 * única instancia creada por `createAiService(githubService)` (`./index.ts`).
 *
 * T13 (streaming): `analyzePullRequest` acepta un segundo parámetro opcional
 * con `onProgress`, invocado cero o más veces DURANTE el análisis con un
 * snapshot parcial (`DraftDidacticSection[]`, `../../shared/events.ts`) y
 * exactamente una vez más al terminar (`meta.done === true`, con las
 * secciones finales). `onProgress` es solo para pintar el panel en vivo
 * mientras tanto, nunca la única forma de obtener el resultado.
 *
 * T39: `analyzePullRequest` retorna `Promise<GeneratedAnalysis>` (SOLO el
 * contenido: `prId`+`sections`+`generatedAt`), NO el `DidacticAnalysis`
 * completo que recibe el renderer. El handler (`../ipc/handlers.ts`) es quien
 * enriquece ese contenido a `DidacticAnalysis` sellando `headSha` (SHA del
 * head del PR al generar) y `generatedWith` (proveedor/modelo/opciones
 * efectivos), antes de cachear/persistir/devolver — ver T40. Ninguna
 * implementación de `AiService` debe tocar esos dos campos.
 */
import type { IpcRequest } from '../../shared/ipc'
import type { GeneratedAnalysis } from '../../shared/types'
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
  ): Promise<GeneratedAnalysis>
}
