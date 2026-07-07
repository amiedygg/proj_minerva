/**
 * Cache en memoria de análisis didácticos (T14), para que abrir la ventana
 * desacoplada (o simplemente volver a un PR ya analizado) no vuelva a pagar
 * una llamada al LLM. `ai:analyzePullRequest` (`../ipc/handlers.ts`) consulta
 * `get()` antes de invocar al `AiService`: un hit devuelve el análisis tal
 * cual, SIN llamar al servicio y SIN emitir ningún evento de streaming (no
 * hay nada que streamear, ya está completo). Al terminar un análisis con
 * éxito, el handler lo guarda con `set()`.
 *
 * LRU simple acotado a `MAX_ENTRIES`: un `Map` preserva orden de inserción,
 * así que basta con borrar y reinsertar una clave para "refrescarla" como la
 * más reciente (tanto en `get` como en `set`), y borrar la primera clave
 * (`.keys().next().value`, la menos recientemente usada) cuando el tamaño se
 * pasa del límite tras un `set`.
 *
 * `invalidate()` la usa el botón "Re-analizar": borra la entrada de ESE PR
 * (si había) sin tocar el resto del cache ni relanzar nada por su cuenta —
 * quien la llama es responsable de invocar `ai:analyzePullRequest` después.
 */
import type { DidacticAnalysis, RepoRef } from '../../shared/types'

const MAX_ENTRIES = 20

function prKey(repo: RepoRef, number: number): string {
  return repo.owner + '/' + repo.name + '#' + number
}

export class AnalysisCache {
  private readonly entries = new Map<string, DidacticAnalysis>()

  /** `null` si no hay entrada para ese PR. Un hit refresca su recencia (LRU). */
  get(repo: RepoRef, number: number): DidacticAnalysis | null {
    const key = prKey(repo, number)
    const value = this.entries.get(key)
    if (value === undefined) return null

    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  /** Guarda/reemplaza la entrada de ese PR como la más reciente; evict de la más antigua si se pasa de `MAX_ENTRIES`. */
  set(repo: RepoRef, number: number, analysis: DidacticAnalysis): void {
    const key = prKey(repo, number)
    this.entries.delete(key)
    this.entries.set(key, analysis)

    if (this.entries.size > MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey)
      }
    }
  }

  /** Borra la entrada de ese PR si había una; no-op si no. */
  invalidate(repo: RepoRef, number: number): void {
    this.entries.delete(prKey(repo, number))
  }

  /** Solo para tests: cuántas entradas hay guardadas ahora mismo. */
  get size(): number {
    return this.entries.size
  }
}

/** Instancia única compartida por todos los handlers IPC (`../ipc/handlers.ts`). */
export const analysisCache = new AnalysisCache()
