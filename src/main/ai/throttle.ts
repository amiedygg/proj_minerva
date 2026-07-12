/**
 * Throttle mínimo basado en tiempo transcurrido, sin dependencias. Lo usan
 * los servicios de IA reales (`providers/opencode-service.ts`,
 * `providers/claude-code-service.ts`, `providers/codex-service.ts`) para no
 * llamar a `onProgress` (que termina en un `webContents.send` a todas las
 * ventanas) en cada delta que llega del modelo — solo como mucho una vez por
 * `intervalMs`.
 *
 * Puro y testeable sin temporizadores reales: el reloj (`now`) es inyectable
 * (por defecto `Date.now`), así los tests pueden avanzarlo a mano.
 */
export interface Throttle {
  /** `true` si ya pasó `intervalMs` desde la última vez que devolvió `true` (o desde la creación/último `reset`). */
  shouldRun(): boolean
  /** Vuelve a permitir una ejecución inmediata en la próxima llamada a `shouldRun`. */
  reset(): void
}

export function createThrottle(intervalMs: number, now: () => number = Date.now): Throttle {
  let last = -Infinity

  return {
    shouldRun(): boolean {
      const current = now()
      if (current - last >= intervalMs) {
        last = current
        return true
      }
      return false
    },
    reset(): void {
      last = -Infinity
    },
  }
}
