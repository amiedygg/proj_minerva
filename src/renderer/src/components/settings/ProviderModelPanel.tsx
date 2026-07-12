import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AiProviderId } from '../../../../shared/ai-providers'
import type { AiProviderStatus, AiSettingsInfo } from '../../../../shared/types'
import { useProviderModels } from '../../hooks/use-provider-models'
import { Badge } from '../ui/Badge'
import { ModelOptionPicker } from './ModelOptionPicker'
import { CliLoginGuide } from './CliLoginGuide'

/** Placeholder del campo "Otro (avanzado)" por proveedor con id libre habilitado (T57: OpenCode; T59: único que queda tras eliminar OpenRouter). */
const CUSTOM_MODEL_PLACEHOLDER: Partial<Record<AiProviderId, string>> = {
  opencode: 'slug <provider>/<modelo> de tu opencode, p. ej. anthropic/claude-sonnet-5',
}

interface ProviderModelPanelProps {
  info: AiSettingsInfo
  viewedProvider: AiProviderId
  statuses: Record<AiProviderId, AiProviderStatus> | null
  statusLoading: boolean
  error: string | null
  onRefetchStatus: () => void
  saveModel: (provider: AiProviderId, model: string) => Promise<boolean>
  selectProvider: (provider: AiProviderId) => Promise<boolean>
  setModelOption: (provider: AiProviderId, optionId: string, value: string) => Promise<boolean>
}

/**
 * Contenido del tab visto (`viewedProvider`, T62/F12): lista de modelos como
 * CARDS clickeables — sin radios ni botón "Guardar" aparte, click = activar
 * ese proveedor+modelo en un solo gesto — más "Otro (avanzado)" para
 * OpenCode, el selector de razonamiento del modelo ACTIVO (`ModelOptionPicker`,
 * intacto) y la guía de login del CLI.
 *
 * `SettingsModal` lo monta con `key={viewedProvider}`: cambiar de tab
 * remonta este componente desde cero, así `useProviderModels` re-fetchea sin
 * necesitar un efecto de sincronización (prohibido por el lint react-hooks
 * de este repo) y el estado local (`activating`, el input de "Otro") arranca
 * limpio para el proveedor nuevo — incluido el prefill del input "Otro" con
 * `info.model` cuando corresponde, vía lazy initializer de `useState` (el
 * remount garantiza que ese initializer siempre ve el `info` correcto).
 *
 * Activar (click en una card o "Usar" del campo "Otro"): `saveModel(viewedProvider,
 * modelId)` y, SOLO si el tab visto no era ya el proveedor activo,
 * `selectProvider(viewedProvider)` a continuación — dos canales IPC
 * existentes (`settings:setProviderModel`/`settings:setAiProvider`), sin IPC
 * nuevo. El proveedor "estaba activo" se captura ANTES del primer `await`
 * (`wasActive`) porque `info.provider` puede cambiar entre renders una vez
 * que `saveModel` resuelve.
 */
export function ProviderModelPanel({
  info,
  viewedProvider,
  statuses,
  statusLoading,
  error,
  onRefetchStatus,
  saveModel,
  selectProvider,
  setModelOption,
}: ProviderModelPanelProps): React.JSX.Element {
  const fallbackModels = info.catalog[viewedProvider].models
  const { models, error: modelsError } = useProviderModels(viewedProvider, fallbackModels)

  const isActiveTab = viewedProvider === info.provider
  const allowCustom = viewedProvider === 'opencode'
  const activeModelInList = models.some((model) => model.id === info.model)
  const customIsActive = isActiveTab && allowCustom && !activeModelInList

  const [activating, setActivating] = useState<string | null>(null)
  const [activateError, setActivateError] = useState<string | null>(null)
  const [customValue, setCustomValue] = useState(() => (customIsActive ? info.model : ''))

  const anyActivating = activating !== null
  const activeModel = isActiveTab ? models.find((model) => model.id === info.model) : undefined

  async function activate(rawModelId: string): Promise<void> {
    const modelId = rawModelId.trim()
    if (!modelId || anyActivating) return
    if (isActiveTab && modelId === info.model) return

    setActivating(modelId)
    setActivateError(null)
    const wasActive = isActiveTab

    let ok = await saveModel(viewedProvider, modelId)
    if (ok && !wasActive) {
      ok = await selectProvider(viewedProvider)
    }

    setActivating(null)
    if (!ok) setActivateError('No se pudo activar el modelo. Probá de nuevo.')
  }

  return (
    <div
      role="tabpanel"
      id={'settings-tabpanel-' + viewedProvider}
      aria-labelledby={'settings-tab-' + viewedProvider}
      className="p-4"
    >
      <p className="mb-3 text-xs text-muted">
        Elegí el modelo que analiza los Pull Requests. Al elegirlo, {info.catalog[viewedProvider].label} pasa a
        ser el proveedor activo.
      </p>

      {modelsError && (
        <p className="mb-2 text-xs text-muted">
          No se pudo actualizar la lista de modelos ({modelsError}); mostrando el catálogo curado.
        </p>
      )}

      <div className="space-y-2">
        {models.map((model) => {
          const isModelActive = isActiveTab && model.id === info.model
          const isThisActivating = activating === model.id

          return (
            <button
              key={model.id}
              type="button"
              disabled={anyActivating}
              onClick={() => void activate(model.id)}
              className={`flex w-full items-start justify-between gap-2.5 rounded-md border p-2.5 text-left transition-colors duration-150 ${
                isModelActive ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-accent/30'
              } ${anyActivating ? 'opacity-60' : ''}`}
            >
              <span className="flex flex-col">
                <span className="text-sm text-text">
                  {model.label} <span className="text-muted">· {model.vendor}</span>
                </span>
                <span className="font-mono text-[11px] text-muted">{model.id}</span>
              </span>
              {isThisActivating ? (
                <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-muted" />
              ) : isModelActive ? (
                <Badge tone="success">Activo</Badge>
              ) : null}
            </button>
          )
        })}

        {allowCustom && (
          <div
            className={`rounded-md border p-2.5 transition-colors duration-150 ${
              customIsActive ? 'border-accent/50 bg-accent/10' : 'border-border'
            } ${anyActivating ? 'opacity-60' : ''}`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-sm text-text">Otro (avanzado)</span>
              {customIsActive && <Badge tone="success">Activo</Badge>}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={customValue}
                onChange={(event) => setCustomValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void activate(customValue)
                }}
                disabled={anyActivating}
                placeholder={CUSTOM_MODEL_PLACEHOLDER[viewedProvider] ?? ''}
                maxLength={100}
                className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-text placeholder:text-muted focus:border-accent disabled:opacity-60"
              />
              <button
                type="button"
                disabled={anyActivating || customValue.trim().length === 0}
                onClick={() => void activate(customValue)}
                className={
                  !anyActivating && customValue.trim().length > 0
                    ? 'flex shrink-0 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/25'
                    : 'flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-border/40 px-3 py-1 text-xs font-medium text-muted'
                }
              >
                {activating === customValue.trim() && <Loader2 size={13} className="animate-spin" />}
                Usar
              </button>
            </div>
          </div>
        )}
      </div>

      {activateError && <p className="mt-2 text-xs text-danger">{activateError}</p>}
      {!activateError && error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {isActiveTab ? (
        activeModel?.options && activeModel.options.length > 0 && (
          <ModelOptionPicker
            key={info.provider + '/' + info.model}
            provider={info.provider}
            model={activeModel}
            selected={info.selectedOptions?.[info.provider] ?? {}}
            onSelect={setModelOption}
          />
        )
      ) : (
        <p className="mt-3 text-[11px] text-muted">El razonamiento se configura sobre el modelo activo.</p>
      )}

      <CliLoginGuide
        provider={viewedProvider}
        status={statuses?.[viewedProvider]}
        loading={statusLoading}
        onRecheck={onRefetchStatus}
      />
    </div>
  )
}
