import { useCallback, useEffect, useState } from 'react'
import type { AuthState, AuthStatus, GithubAccessMode } from '../../../shared/types'
import { useAppStore } from '../stores/app-store'

const POLL_INTERVAL_MS = 3000

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Cuándo el polling debe estar activo (T71, F14): `device_pending` (motivo
 * original, T6 — descubrir cuándo `main` termina el device flow) o, en modo
 * `gh-cli`, cualquier estado que no sea `signed_in` (F14 — si el usuario
 * corre `gh auth login` en una terminal, o si el modo cambia desde Settings,
 * la UI debe enterarse sola sin plumbing manual). Recibe los primitivos
 * (`state`/`mode`), no el objeto `AuthStatus` completo, para que el efecto de
 * abajo pueda declarar EXACTAMENTE esas dos dependencias primitivas.
 */
function shouldPoll(state: AuthState, mode: GithubAccessMode): boolean {
  return state === 'device_pending' || (mode === 'gh-cli' && state !== 'signed_in')
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
 * fuera de alcance de T6): el polling es DECLARATIVO (T71, F14) — un solo
 * efecto sobre `[status.state, status.mode]` arma un `setInterval` de
 * `POLL_INTERVAL_MS` mientras `shouldPoll(state, mode)` sea cierto y lo
 * limpia en el cleanup en cuanto deja de serlo (incluido el desmontaje).
 * Cubre dos casos con el mismo mecanismo: `device_pending` (login OAuth en
 * curso) y modo `gh-cli` mientras no haya sesión (`cli_unavailable`/
 * `cli_unauthenticated`) — correr `gh auth login` en una terminal, o cambiar
 * el modo desde Settings, se refleja solo en ≤`POLL_INTERVAL_MS` + el TTL del
 * probe de `gh` (5s, `main/auth/gh-cli-auth.ts`), sin arrancar/parar el
 * intervalo a mano desde `signIn`/`setGithubAccessMode`.
 *
 * El estado vive en el store de zustand (`authStatus`), no en estado local:
 * hay varios consumidores (TitleBar, Sidebar, hooks de datos) y todos deben
 * ver la MISMA transición de sesión — en particular `usePullRequests`, que
 * refetchea cuando `authStatus` cambia.
 */
export function useAuth(): UseAuthResult {
  const status = useAppStore((s) => s.authStatus)
  const setStatus = useAppStore((s) => s.setAuthStatus)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Estado inicial al montar (una sola vez): si `main` ya tiene un modo
  // gh-cli sin sesión o un device flow en curso (p. ej. la ventana se
  // recargó a mitad del proceso), el efecto de polling de abajo reacciona
  // solo en cuanto este resultado entra al store.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await window.minerva.auth.getStatus()
        if (!cancelled) setStatus(result)
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setStatus])

  // Polling declarativo (T71): se arma/limpia según el par (state, mode)
  // vigente, sin que `signIn`/`signOut`/un cambio de modo tengan que
  // arrancarlo o pararlo a mano. Deps primitivas a propósito (no `status`
  // completo): el efecto solo debe re-correr cuando ESTOS dos campos
  // cambian, no cuando `setStatus` reemplaza el objeto con los mismos
  // valores (p. ej. cada tick del propio polling).
  useEffect(() => {
    if (!shouldPoll(status.state, status.mode)) return undefined
    const timer = setInterval(() => {
      void window.minerva.auth
        .getStatus()
        .then((next) => setStatus(next))
        .catch((err: unknown) => setError(toErrorMessage(err)))
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [status.state, status.mode, setStatus])

  const signIn = useCallback(async () => {
    setError(null)
    try {
      const result = await window.minerva.auth.startDeviceFlow()
      setStatus(result)
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }, [setStatus])

  const signOut = useCallback(async () => {
    setError(null)
    try {
      const result = await window.minerva.auth.signOut()
      setStatus(result)
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }, [setStatus])

  return { status, loading, error, signIn, signOut }
}
