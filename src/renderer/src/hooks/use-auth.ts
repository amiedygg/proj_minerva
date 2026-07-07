import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthStatus } from '../../../shared/types'
import { useAppStore } from '../stores/app-store'

const POLL_INTERVAL_MS = 3000

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface UseAuthResult {
  status: AuthStatus
  loading: boolean
  error: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

/**
 * Estado de auth vía `auth:*`. No hay canal de eventos push (a propósito,
 * fuera de alcance de T6): mientras `status.state === 'device_pending'` este
 * hook repite `auth:getStatus` cada `POLL_INTERVAL_MS` para descubrir cuándo
 * `main` termina el polling del device flow (login exitoso, expirado o
 * denegado). El intervalo se limpia al desmontar o en cuanto se sale de
 * `device_pending`.
 *
 * El estado vive en el store de zustand (`authStatus`), no en estado local:
 * hay varios consumidores (TitleBar, Sidebar, hooks de datos) y todos deben
 * ver la MISMA transición de sesión — en particular `usePullRequests`, que
 * refetchea cuando `authStatus.state` cambia.
 */
export function useAuth(): UseAuthResult {
  const status = useAppStore((s) => s.authStatus)
  const setStatus = useAppStore((s) => s.setAuthStatus)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  // Limpieza al desmontar: no depende de `clearPoll` en el arreglo porque
  // esa referencia es estable (viene de `useCallback` sin dependencias).
  useEffect(() => clearPoll, [clearPoll])

  const startPolling = useCallback(() => {
    clearPoll()
    pollTimerRef.current = setInterval(() => {
      void window.minerva.auth
        .getStatus()
        .then((next) => {
          setStatus(next)
          if (next.state !== 'device_pending') clearPoll()
        })
        .catch((err: unknown) => {
          setError(toErrorMessage(err))
          clearPoll()
        })
    }, POLL_INTERVAL_MS)
  }, [clearPoll, setStatus])

  // Estado inicial al montar. Si `main` ya tiene un device flow en curso
  // (p. ej. la ventana se recargó a mitad del login), retoma el polling para
  // descubrir cuándo termina — sin esto el UI se quedaría en `device_pending`.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await window.minerva.auth.getStatus()
        if (cancelled) return
        setStatus(result)
        if (result.state === 'device_pending') startPolling()
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setStatus, startPolling])

  const signIn = useCallback(async () => {
    setError(null)
    try {
      const result = await window.minerva.auth.startDeviceFlow()
      setStatus(result)
      if (result.state === 'device_pending') startPolling()
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }, [setStatus, startPolling])

  const signOut = useCallback(async () => {
    clearPoll()
    setError(null)
    try {
      const result = await window.minerva.auth.signOut()
      setStatus(result)
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }, [clearPoll, setStatus])

  return { status, loading, error, signIn, signOut }
}
