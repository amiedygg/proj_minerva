import { useEffect, useState } from 'react'
import type { AiModelOption, AiProviderId } from '../../../shared/ai-providers'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface UseProviderModelsResult {
  /** Modelos de `provider`: dinámicos (`ai:getProviderModels`) si ya resolvieron, si no `fallback`. */
  models: readonly AiModelOption[]
  loading: boolean
  error: string | null
}

/**
 * Modelos reales de `provider` (T35/T37, canal async `ai:getProviderModels`):
 * para Codex/OpenCode trae los modelos DINÁMICOS de la cuenta/server local
 * (con sus `supportedReasoningEfforts` reales vía `options` en el caso de
 * Codex); para Claude Code, hoy el mismo curado que ya vive en
 * `info.catalog` (el canal solo refresca de verdad para Codex/OpenCode, ver
 * `main/ai/providers/provider-models.ts`).
 *
 * `fallback` (el catálogo ESTÁTICO de `info.catalog[provider].models`, T26)
 * es el valor inicial de `models` para que el picker nunca quede vacío
 * mientras el fetch (que puede tardar 1-2s la primera vez con Codex) está en
 * curso, y también lo que queda si el fetch falla. Cancel-safe: mismo patrón
 * que `use-provider-status.ts`.
 *
 * A propósito NO sincroniza `models` de vuelta a `fallback` cuando cambia
 * `provider` dentro del mismo montaje (nunca pasa hoy: `ModelPicker` se monta
 * con `key={info.provider}`, ver `SettingsModal`, así que un cambio de
 * proveedor siempre re-crea este hook desde cero) — si eso cambiara, agregar
 * ese reset requeriría el mismo patrón de remount-por-key, no un efecto de
 * sincronización.
 */
export function useProviderModels(
  provider: AiProviderId,
  fallback: readonly AiModelOption[],
): UseProviderModelsResult {
  const [models, setModels] = useState<readonly AiModelOption[]>(fallback)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.minerva.ai
      .getProviderModels({ provider })
      .then((result) => {
        if (!cancelled) setModels(result)
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
  }, [provider])

  return { models, loading, error }
}
