import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AI_PROVIDER_IDS } from '../../../../shared/ai-providers'
import type { AiProviderId } from '../../../../shared/ai-providers'
import type { AiProviderStatus, AiSettingsInfo, OpenRouterKeyStatus } from '../../../../shared/types'
import { Badge } from '../ui/Badge'
import { OpenRouterKeyForm } from './OpenRouterKeyForm'
import { CliLoginGuide } from './CliLoginGuide'

interface ProviderPickerProps {
  info: AiSettingsInfo
  statuses: Record<AiProviderId, AiProviderStatus> | null
  statusLoading: boolean
  statusError: string | null
  onRefetchStatus: () => void
  openRouterKeyStatus: OpenRouterKeyStatus | null
  openRouterKeyLoading: boolean
  openRouterKeyError: string | null
  openRouterKeySaving: boolean
  onSaveOpenRouterKey: (key: string) => Promise<boolean>
  onClearOpenRouterKey: () => Promise<boolean>
  onSelectProvider: (provider: AiProviderId) => Promise<boolean>
}

const STATUS_LABEL: Record<AiProviderStatus['status'], string> = {
  unavailable: 'No disponible',
  installed: 'Instalado, sin sesión',
  authenticated: 'Conectado',
}

const STATUS_TONE: Record<AiProviderStatus['status'], 'neutral' | 'warning' | 'success'> = {
  unavailable: 'neutral',
  installed: 'warning',
  authenticated: 'success',
}

/**
 * Vista de proveedores de IA (T30): una card por proveedor
 * (`AI_PROVIDER_IDS`, `shared/ai-providers.ts`) con su estado de login
 * (`ai:getProviderStatus`, T27) y selección del proveedor activo
 * (persistencia inmediata vía `setAiProvider` — a diferencia del selector de
 * modelo, que mantiene el flujo de "Guardar" explícito, ver `ModelPicker`).
 *
 * Debajo de la lista se muestra la acción contextual del proveedor
 * ACTIVO (`info.provider`) en vez de una por card: OpenRouter necesita un
 * campo de key; los CLIs solo necesitan guía + "Volver a comprobar" — meterlo
 * dentro de cada `<label>` de card habría hecho que clicks en esos controles
 * también dispararan el `onChange` del radio que envuelve la card.
 */
export function ProviderPicker({
  info,
  statuses,
  statusLoading,
  statusError,
  onRefetchStatus,
  openRouterKeyStatus,
  openRouterKeyLoading,
  openRouterKeyError,
  openRouterKeySaving,
  onSaveOpenRouterKey,
  onClearOpenRouterKey,
  onSelectProvider,
}: ProviderPickerProps): React.JSX.Element {
  const [switching, setSwitching] = useState<AiProviderId | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  async function handleSelect(provider: AiProviderId): Promise<void> {
    if (provider === info.provider || switching !== null) return
    setSwitching(provider)
    setSwitchError(null)
    const ok = await onSelectProvider(provider)
    setSwitching(null)
    if (!ok) setSwitchError('No se pudo cambiar de proveedor. Probá de nuevo.')
  }

  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Proveedor de IA
        </h3>
        {statusLoading && <Loader2 size={12} className="animate-spin text-muted" />}
      </div>
      <p className="mb-3 text-xs text-muted">
        Quién genera el análisis didáctico de los Pull Requests.
      </p>

      {statusError && (
        <p className="mb-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
          No se pudo comprobar el estado de los proveedores: {statusError}
        </p>
      )}

      <div className="space-y-2">
        {AI_PROVIDER_IDS.map((provider) => {
          const entry = info.catalog[provider]
          const status = statuses?.[provider]
          const checked = info.provider === provider
          const isSwitching = switching === provider

          return (
            <label
              key={provider}
              className={`flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 transition-colors duration-150 ${
                checked ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-accent/30'
              }`}
            >
              <input
                type="radio"
                name="ai-provider"
                className="accent-accent"
                checked={checked}
                disabled={switching !== null}
                onChange={() => void handleSelect(provider)}
              />
              <span className="flex flex-1 items-center justify-between gap-2">
                <span className="text-sm text-text">{entry.label}</span>
                {isSwitching ? (
                  <Loader2 size={12} className="animate-spin text-muted" />
                ) : status ? (
                  <Badge tone={STATUS_TONE[status.status]}>
                    {STATUS_LABEL[status.status]}
                    {status.status === 'authenticated' && status.account?.plan
                      ? ' · ' + status.account.plan
                      : ''}
                    {status.status === 'authenticated' && status.account?.email
                      ? ' · ' + status.account.email
                      : ''}
                  </Badge>
                ) : (
                  <Badge tone="neutral">…</Badge>
                )}
              </span>
            </label>
          )
        })}
      </div>

      {switchError && <p className="mt-2 text-xs text-danger">{switchError}</p>}

      {info.provider === 'openrouter' && (
        <OpenRouterKeyForm
          status={openRouterKeyStatus}
          loading={openRouterKeyLoading}
          error={openRouterKeyError}
          saving={openRouterKeySaving}
          onSave={onSaveOpenRouterKey}
          onClear={onClearOpenRouterKey}
        />
      )}
      {(info.provider === 'claude-code' || info.provider === 'codex') && (
        <CliLoginGuide
          provider={info.provider}
          status={statuses?.[info.provider]}
          loading={statusLoading}
          onRecheck={onRefetchStatus}
        />
      )}
    </div>
  )
}
