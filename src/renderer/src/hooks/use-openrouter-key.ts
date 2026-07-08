import { useCallback, useEffect, useState } from 'react'
import type { OpenRouterKeyStatus } from '../../../shared/types'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface UseOpenRouterKeyResult {
  /** `null` mientras no se haya cargado la primera vez. */
  status: OpenRouterKeyStatus | null
  loading: boolean
  error: string | null
  /** `true` mientras hay un guardado/borrado en curso (botones Guardar/Borrar). */
  saving: boolean
  /** Guarda `key` cifrada vía `safeStorage`. `true` si se guardó bien. */
  save: (key: string) => Promise<boolean>
  /** Equivale a guardar una key vacía (borra lo persistido en `safeStorage`). */
  clear: () => Promise<boolean>
}

/**
 * Estado de configuración de `OPENROUTER_API_KEY` (T32, canales
 * `settings:setOpenRouterKey`/`settings:getOpenRouterKeyStatus`; UI en T30).
 * La key en sí NUNCA cruza al renderer — este hook solo maneja
 * `{ configured, source }` (ver `OpenRouterKeyStatus` en `shared/types.ts`).
 *
 * Vive fuera de `app-store` por el mismo motivo que `use-provider-status.ts`:
 * solo lo usa la card de OpenRouter en Settings, que se remonta entera cada
 * vez que el modal se abre.
 */
export function useOpenRouterKey(): UseOpenRouterKeyResult {
  const [status, setStatus] = useState<OpenRouterKeyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.minerva.settings
      .getOpenRouterKeyStatus()
      .then((result) => {
        if (!cancelled) setStatus(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setKey = useCallback(async (key: string): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      const result = await window.minerva.settings.setOpenRouterKey({ key })
      setStatus(result)
      return true
    } catch (err) {
      setError(toErrorMessage(err))
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  const save = useCallback((key: string) => setKey(key), [setKey])
  const clear = useCallback(() => setKey(''), [setKey])

  return { status, loading, error, saving, save, clear }
}
