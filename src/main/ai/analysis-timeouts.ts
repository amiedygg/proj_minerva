/**
 * Lógica de doble timeout compartida entre los proveedores de IA que
 * streamean una respuesta larga desde un backend externo (`OpenRouterAiService`
 * vía SSE; `ClaudeCodeAiService`, T28, vía el Agent SDK oficial): un timeout
 * TOTAL desde que arranca el análisis y un timeout de INACTIVIDAD que se
 * reinicia con cada delta recibido. Cualquiera de los dos aborta el
 * `AbortController` que el proveedor ya le pasa a su transporte (fetch con
 * `signal`, o `Options.abortController` del Agent SDK).
 *
 * `getAbortReason()` le dice a quien llama CUÁL de los dos disparó el abort
 * (o `null` si el controller nunca fue abortado por este helper — p. ej. lo
 * abortó el usuario cancelando desde la UI, si eso existiera hoy) para que
 * cada proveedor arme su propio mensaje final con su propio nombre ("timeout
 * total de OpenRouter" vs. "timeout total de Claude Code").
 */

/** Timeout total del análisis completo (desde que arranca hasta el último delta). */
export const REQUEST_TIMEOUT_MS = 120_000
/** Si pasan más de esto sin recibir NINGÚN delta nuevo, se aborta (conexión/proceso colgado). */
export const INACTIVITY_TIMEOUT_MS = 20_000
/** Cuánto, como mucho, se llama a `onProgress` mientras llegan deltas (ver `./throttle.ts`). */
export const PROGRESS_THROTTLE_MS = 150

export type AbortReason = 'total-timeout' | 'inactivity-timeout' | null

export interface AnalysisTimeouts {
  /** Reinicia el timer de inactividad: llamar cada vez que llega un delta/mensaje nuevo. */
  resetInactivityTimer(): void
  /** Cancela ambos timers. Llamar SIEMPRE en el `finally`/catch del pipeline, éxito o error. */
  clearAll(): void
  /** Cuál de los dos timeouts disparó el abort del `controller`, o `null` si ninguno (todavía). */
  getAbortReason(): AbortReason
}

export function createAnalysisTimeouts(controller: AbortController): AnalysisTimeouts {
  let abortReason: AbortReason = null

  const totalTimeoutId = setTimeout(() => {
    abortReason = 'total-timeout'
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  let inactivityTimeoutId: ReturnType<typeof setTimeout> | null = null

  function resetInactivityTimer(): void {
    if (inactivityTimeoutId !== null) clearTimeout(inactivityTimeoutId)
    inactivityTimeoutId = setTimeout(() => {
      abortReason = 'inactivity-timeout'
      controller.abort()
    }, INACTIVITY_TIMEOUT_MS)
  }

  function clearAll(): void {
    clearTimeout(totalTimeoutId)
    if (inactivityTimeoutId !== null) {
      clearTimeout(inactivityTimeoutId)
      inactivityTimeoutId = null
    }
  }

  return {
    resetInactivityTimer,
    clearAll,
    getAbortReason: () => abortReason,
  }
}
