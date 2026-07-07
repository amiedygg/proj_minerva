import { useEffect, useState } from 'react'

export type ConnectionState = 'checking' | 'connected' | 'error'

/**
 * Ping trivial a `main` vía IPC para mostrar un indicador de conexión en el
 * `TitleBar`. Reemplaza el botón manual de "ping main" de T2 sin tocar la
 * infraestructura IPC.
 */
export function useConnectionStatus(): ConnectionState {
  // Defensivo: si el preload falló en cargar, `window.minerva` no existe.
  // Se resuelve en el inicializador perezoso de `useState` (corre durante el
  // render, no en un efecto) para no llamar a `setState` de forma síncrona
  // dentro del cuerpo del efecto (`react-hooks/set-state-in-effect`).
  const [status, setStatus] = useState<ConnectionState>(() =>
    typeof window.minerva === 'undefined' ? 'error' : 'checking',
  )

  useEffect(() => {
    if (typeof window.minerva === 'undefined') return
    let cancelled = false
    window.minerva.system
      .ping()
      .then(() => {
        if (!cancelled) setStatus('connected')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return status
}
