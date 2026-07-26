import { useCallback, useEffect, useState } from 'react'
import type { GhAccount } from '../../../shared/types'

interface UseGhAccountsResult {
  accounts: GhAccount[]
  loading: boolean
  /**
   * Vuelve a pedir la lista. Main la cachea con TTL 5s
   * (`main/auth/gh-cli-auth.ts`), así que dos clics seguidos devuelven lo
   * mismo — en tiempo humano (correr `gh auth login` en otra terminal y
   * volver) el resultado siempre es fresco.
   */
  reload: () => Promise<void>
}

/**
 * Cuentas que `gh` conoce (F18), para el selector de la sección "Acceso a
 * GitHub". Canal `auth:listGhAccounts` — lectura pura, ya cacheada en main
 * (TTL 5s + single-flight), así que este hook no agrega cache propia.
 *
 * `enabled` existe para NO spawnear `gh` cuando la sección no aplica (escape
 * hatch `MINERVA_GITHUB_ACCESS=oauth`): el hook debe llamarse igual en todos
 * los renders (regla de hooks), así que la condición entra como argumento y
 * no como un `if` alrededor de la llamada.
 *
 * Un fallo del canal se trata como lista vacía a propósito, sin superficie de
 * error: la lista es una AYUDA para elegir cuenta, y quien de verdad reporta
 * el problema de `gh` es el `AuthStatus` que la misma sección ya pinta
 * (`cli_unavailable`/`cli_unauthenticated`). Dos mensajes de error para la
 * misma causa raíz solo confundirían.
 *
 * `accounts === null` (todavía sin respuesta) es el ÚNICO origen de
 * `loading`, y se deriva en el `return` en vez de mantenerse en un estado
 * aparte: así el efecto no llama a `setState` en su cuerpo, que es lo que
 * prohíbe `react-hooks/set-state-in-effect` (mismo criterio que `useAuth` y
 * `useSettings` — solo se hace `setState` dentro del callback de la promesa).
 */
export function useGhAccounts(enabled: boolean): UseGhAccountsResult {
  const [accounts, setAccounts] = useState<GhAccount[] | null>(null)
  const [reloading, setReloading] = useState(false)

  const fetchAccounts = useCallback(async (): Promise<GhAccount[]> => {
    try {
      return await window.minerva.auth.listGhAccounts()
    } catch {
      return []
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void fetchAccounts().then((result) => {
      if (!cancelled) setAccounts(result)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, fetchAccounts])

  // Handler de evento (no un efecto): acá `setState` síncrono es correcto.
  const reload = useCallback(async (): Promise<void> => {
    setReloading(true)
    const result = await fetchAccounts()
    setAccounts(result)
    setReloading(false)
  }, [fetchAccounts])

  return {
    accounts: enabled && accounts !== null ? accounts : [],
    loading: enabled && (accounts === null || reloading),
    reload,
  }
}
