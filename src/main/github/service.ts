/**
 * Interfaz de la capa GitHub en `main`. Los métodos espejan uno a uno los
 * canales IPC `github:*` definidos en `src/shared/ipc.ts`: los tipos de
 * request/response se toman de ahí (`IpcRequest`/`IpcResponse`) para no
 * duplicar formas entre el contrato IPC y esta interfaz.
 *
 * Dos implementaciones conviven detrás de esta interfaz:
 * - `MockGithubService` (`./mock-service.ts`), disponible desde T4.
 * - La implementación real con Octokit, que llegará en T6.
 *
 * `src/main/ipc/handlers.ts` delega los 5 canales `github:*` a una única
 * instancia creada por `createGithubService()` (`./index.ts`).
 */
import type { IpcRequest, IpcResponse } from '../../shared/ipc'
import type { RepoRef } from '../../shared/types'

export interface GithubService {
  listPullRequests(
    req: IpcRequest<'github:listPullRequests'>,
  ): Promise<IpcResponse<'github:listPullRequests'>>

  getPullRequestDetail(
    req: IpcRequest<'github:getPullRequestDetail'>,
  ): Promise<IpcResponse<'github:getPullRequestDetail'>>

  getPullRequestFiles(
    req: IpcRequest<'github:getPullRequestFiles'>,
  ): Promise<IpcResponse<'github:getPullRequestFiles'>>

  getCommentThreads(
    req: IpcRequest<'github:getCommentThreads'>,
  ): Promise<IpcResponse<'github:getCommentThreads'>>

  postComment(req: IpcRequest<'github:postComment'>): Promise<IpcResponse<'github:postComment'>>

  /**
   * Escribe en `destDir` (T54) una copia local del repo AL COMMIT `headSha`
   * del PR — la usan los proveedores de IA agénticos para explorar el árbol
   * completo, no solo el diff. `destDir` ya existe (vacío) al llamar: lo crea
   * quien orquesta la escritura atómica (`./snapshot-store.ts`), no este
   * método. El contenido resultante es NO CONFIABLE (viene de un PR externo):
   * nunca se ejecuta, solo lo leen herramientas read-only.
   */
  writeSnapshot(req: { repo: RepoRef; headSha: string }, destDir: string): Promise<void>
}
