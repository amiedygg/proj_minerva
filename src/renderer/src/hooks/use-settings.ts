import { useCallback, useEffect, useState } from 'react'
import type { EffectiveAiModelInfo } from '../../../shared/types'
import { useAppStore } from '../stores/app-store'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface UseSettingsResult {
  /** `null` mientras no se haya cargado la primera vez (ver el efecto de abajo). */
  info: EffectiveAiModelInfo | null
  loading: boolean
  error: string | null
  /** `true` si se guardó bien; `false` si falló (revisar `error`). */
  save: (aiModel: string) => Promise<boolean>
  reload: () => void
}

/**
 * Modelo de IA efectivo vía `settings:get`/`settings:setAiModel` (T12). El
 * valor cargado se guarda en `app-store` (`aiModelInfo`), no en estado local:
 * varios consumidores usan este mismo hook (`SettingsModal`/`ModelPicker` y
 * el hint sutil del panel didáctico) y todos deben ver el mismo valor sin
 * refetchear cada uno por su lado — mismo patrón que `authStatus`/`useAuth`.
 *
 * Carga automáticamente una vez si `aiModelInfo` todavía es `null` (primer
 * montaje de cualquier consumidor). El efecto de carga inicial lee el store
 * de forma imperativa (`useAppStore.getState()`) en vez de depender
 * reactivamente de `info`, y solo llama a `setState` dentro de callbacks de
 * la promesa (no de forma síncrona en el cuerpo del efecto): mismo criterio
 * que sigue `useAuth` (`use-auth.ts`) para su carga inicial, para no caer en
 * el antipatrón que marca `react-hooks/set-state-in-effect`.
 */
export function useSettings(): UseSettingsResult {
  const info = useAppStore((s) => s.aiModelInfo)
  const setInfo = useAppStore((s) => s.setAiModelInfo)
  const [loading, setLoading] = useState(() => useAppStore.getState().aiModelInfo === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (useAppStore.getState().aiModelInfo !== null) return
    let cancelled = false
    void window.minerva.settings
      .get()
      .then((result) => {
        if (!cancelled) setInfo(result)
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
  }, [setInfo])

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    void window.minerva.settings
      .get()
      .then((result) => setInfo(result))
      .catch((err: unknown) => setError(toErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [setInfo])

  const save = useCallback(
    async (aiModel: string): Promise<boolean> => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.minerva.settings.setAiModel({ aiModel })
        setInfo(result)
        return true
      } catch (err) {
        setError(toErrorMessage(err))
        return false
      } finally {
        setLoading(false)
      }
    },
    [setInfo],
  )

  return { info, loading, error, save, reload }
}
