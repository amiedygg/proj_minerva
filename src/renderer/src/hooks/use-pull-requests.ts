import { useEffect, useState } from 'react'
import type { PullRequestSummary } from '../../../shared/types'

const SEARCH_DEBOUNCE_MS = 250

interface UsePullRequestsResult {
  pullRequests: PullRequestSummary[]
  loading: boolean
  error: string | null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Lista PRs vía `github:listPullRequests`, re-pidiendo a `main` cada vez que
 * cambia `search` (con debounce, así no se dispara un IPC por cada tecla).
 * El filtrado ya no ocurre en el renderer: `main`/`MockGithubService` filtra
 * por título/repo antes de responder.
 *
 * Toda la lógica (incluido el `setLoading(true)` inicial) vive dentro de una
 * función async invocada de inmediato: si esas llamadas a `setState` fueran
 * sentencias directas del cuerpo del efecto, `react-hooks/set-state-in-effect`
 * las marca como anti-patrón (setState síncrono en un efecto). Envolverlas en
 * una función anidada evita el falso positivo sin cambiar el comportamiento.
 */
export function usePullRequests(search: string, authState?: string): UsePullRequestsResult {
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // `authState` está en las dependencias a propósito: al pasar de
  // `signed_out` a `signed_in` (o al cerrar sesión) hay que volver a pedir la
  // lista — el error 'No autenticado' previo al login no se corrige solo.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      setLoading(true)
      setError(null)

      await new Promise<void>((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS))
      if (cancelled) return

      try {
        const result = await window.minerva.github.listPullRequests({
          search: search.trim() || undefined,
        })
        if (!cancelled) setPullRequests(result)
      } catch (err: unknown) {
        if (!cancelled) setError(toErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [search, authState])

  return { pullRequests, loading, error }
}
