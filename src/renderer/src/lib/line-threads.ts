/**
 * Mapeo puro entre hilos de comentarios por línea (`CommentThread` con
 * `isLineThread`) y su posición dentro del diff de un archivo (lado + número
 * de línea), para que `SplitDiff`/`InlineDiff` puedan pintar el indicador del
 * gutter con un lookup O(1) por fila en vez de recorrer todos los hilos por
 * cada línea renderizada.
 */
import type { CommentThread } from '../../../shared/types'

export type LineSide = 'LEFT' | 'RIGHT'

/** Clave de posición: lado del diff + número de línea en ese lado. */
export function lineThreadKey(line: number, side: LineSide): string {
  return `${side}:${line}`
}

/**
 * Filtra los hilos de línea que pertenecen a `filePath` y los indexa por
 * posición. Un hilo sin `side` explícito se asume del lado `RIGHT` (línea
 * nueva/contexto), que es el comportamiento por defecto al crear hilos nuevos
 * en líneas de contexto o adición (ver `resolveNewThreadPosition`).
 *
 * Si dos hilos cayeran en la misma posición (no debería pasar con datos
 * reales de GitHub) gana el primero, para que el resultado sea determinístico.
 */
export function indexLineThreads(
  threads: readonly CommentThread[],
  filePath: string,
): Map<string, CommentThread> {
  const map = new Map<string, CommentThread>()
  for (const thread of threads) {
    if (!thread.isLineThread || thread.path !== filePath || thread.line === undefined) continue
    const side: LineSide = thread.side ?? 'RIGHT'
    const key = lineThreadKey(thread.line, side)
    if (!map.has(key)) map.set(key, thread)
  }
  return map
}

/**
 * Dado el número de línea old/new de la celda del diff donde el usuario pidió
 * comentar y si esa celda es una deleción, resuelve la posición (línea + lado)
 * que debe usarse al crear un hilo nuevo:
 * - Deleción -> número de línea vieja, lado `LEFT`.
 * - Contexto o adición -> número de línea nueva, lado `RIGHT`.
 * Devuelve `undefined` si no hay número de línea disponible para ese lado
 * (no debería ocurrir si el llamador solo ofrece el botón "+" cuando sí lo hay).
 */
export function resolveNewThreadPosition(
  isDeletion: boolean,
  oldNumber: number | undefined,
  newNumber: number | undefined,
): { line: number; side: LineSide } | undefined {
  if (isDeletion) {
    return oldNumber === undefined ? undefined : { line: oldNumber, side: 'LEFT' }
  }
  return newNumber === undefined ? undefined : { line: newNumber, side: 'RIGHT' }
}
