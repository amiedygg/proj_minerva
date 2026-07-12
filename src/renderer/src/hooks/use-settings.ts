import { useCallback, useEffect, useState } from 'react'
import type { AiProviderId } from '../../../shared/ai-providers'
import type { AiSettingsInfo, GithubAccessMode } from '../../../shared/types'
import { useAppStore } from '../stores/app-store'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface UseSettingsResult {
  /** `null` mientras no se haya cargado la primera vez (ver el efecto de abajo). */
  info: AiSettingsInfo | null
  loading: boolean
  error: string | null
  /**
   * Cambia el proveedor de IA activo (persistencia inmediata, sin botón de
   * guardar aparte — a diferencia de `saveModel`). `true` si se guardó bien;
   * `false` si falló (revisar `error`).
   */
  selectProvider: (provider: AiProviderId) => Promise<boolean>
  /**
   * Guarda el modelo elegido para `provider` (normalmente `info.provider`,
   * el proveedor activo). `true` si se guardó bien; `false` si falló
   * (revisar `error`).
   */
  saveModel: (provider: AiProviderId, model: string) => Promise<boolean>
  /**
   * Persiste el valor elegido para una opción de modelo (T34/T37, p. ej.
   * `effort`) de `provider` — persistencia inmediata, sin botón de "Guardar"
   * aparte (mismo criterio que `selectProvider`). `true` si se guardó bien;
   * `false` si falló (revisar `error`).
   */
  setModelOption: (provider: AiProviderId, optionId: string, value: string) => Promise<boolean>
  /**
   * Cambia el modo de acceso a GitHub (T72, F14; patrón `selectProvider`):
   * persiste vía `settings:setGithubAccessMode` y ADEMÁS refresca
   * `auth:getStatus` al store (`setAuthStatus`) para que TitleBar/Sidebar
   * reaccionen de inmediato, sin esperar al polling declarativo de
   * `use-auth.ts`. `true` si se guardó bien; `false` si falló (revisar
   * `error`) — el refresco de auth es best-effort y no afecta este resultado.
   */
  setGithubAccessMode: (mode: GithubAccessMode) => Promise<boolean>
  reload: () => void
}

/**
 * Selección de proveedor+modelo de IA vía `settings:get`/`settings:setAiProvider`/
 * `settings:setProviderModel` (T12; forma multi-proveedor desde T26, `AiSettingsInfo`;
 * UI de proveedor+modelo en T30). El valor cargado se guarda en `app-store`
 * (`aiModelInfo`), no en estado local: varios consumidores usan este mismo hook
 * (`SettingsModal`/`ProviderPicker`/`ModelPicker` y el hint sutil del panel
 * didáctico) y todos deben ver el mismo valor sin refetchear cada uno por su
 * lado — mismo patrón que `authStatus`/`useAuth`.
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
  const setAuthStatus = useAppStore((s) => s.setAuthStatus)
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

  const selectProvider = useCallback(
    async (provider: AiProviderId): Promise<boolean> => {
      setError(null)
      try {
        const result = await window.minerva.settings.setAiProvider({ provider })
        setInfo(result)
        return true
      } catch (err) {
        setError(toErrorMessage(err))
        return false
      }
    },
    [setInfo],
  )

  const saveModel = useCallback(
    async (provider: AiProviderId, model: string): Promise<boolean> => {
      setError(null)
      try {
        const result = await window.minerva.settings.setProviderModel({ provider, model })
        setInfo(result)
        return true
      } catch (err) {
        setError(toErrorMessage(err))
        return false
      }
    },
    [setInfo],
  )

  const setModelOption = useCallback(
    async (provider: AiProviderId, optionId: string, value: string): Promise<boolean> => {
      setError(null)
      try {
        const result = await window.minerva.settings.setModelOption({ provider, optionId, value })
        setInfo(result)
        return true
      } catch (err) {
        setError(toErrorMessage(err))
        return false
      }
    },
    [setInfo],
  )

  const setGithubAccessMode = useCallback(
    async (mode: GithubAccessMode): Promise<boolean> => {
      setError(null)
      try {
        const result = await window.minerva.settings.setGithubAccessMode({ mode })
        setInfo(result)
        try {
          const authStatus = await window.minerva.auth.getStatus()
          setAuthStatus(authStatus)
        } catch {
          // Best-effort: si este refresco puntual falla, el polling
          // declarativo de `use-auth.ts` (T71) lo recupera en ≤3s.
        }
        return true
      } catch (err) {
        setError(toErrorMessage(err))
        return false
      }
    },
    [setInfo, setAuthStatus],
  )

  return {
    info,
    loading,
    error,
    selectProvider,
    saveModel,
    setModelOption,
    setGithubAccessMode,
    reload,
  }
}
