import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { AiModelOption, AiProviderId } from '../../../../shared/ai-providers'
import type { AiModelSource, AiSettingsInfo } from '../../../../shared/types'
import { useProviderModels } from '../../hooks/use-provider-models'
import { ModelOptionPicker } from './ModelOptionPicker'

const SOURCE_HINT: Record<AiModelSource, string | null> = {
  settings: null,
  env: 'Definido por MINERVA_AI_MODEL en tu .env. Al guardar, este valor de Settings lo pisa.',
  default: 'Todavía no hay nada configurado para este proveedor: se está usando su default.',
}

interface ModelPickerProps {
  info: AiSettingsInfo
  error: string | null
  onSave: (model: string) => Promise<boolean>
  onSetModelOption: (provider: AiProviderId, optionId: string, value: string) => Promise<boolean>
}

/**
 * Formulario de selección de MODELO dentro del proveedor activo
 * (`info.provider`, radio-cards). Los modelos vienen de
 * `useProviderModels` (T35/T37, canal async `ai:getProviderModels`):
 * DINÁMICOS de la cuenta real para Codex (los 4 modelos reales, con su
 * `options.effort` propio de cada uno), estáticos (`info.catalog`, T26) para
 * el resto — con el catálogo estático como fallback inicial/ante error para
 * que el picker nunca quede vacío mientras carga. "Otro (avanzado)" se
 * mantiene SOLO para OpenRouter: los CLIs (`claude-code`/`codex`) solo
 * aceptan los ids curados que el SDK/RPC de cada uno resuelve, un id libre no
 * significa nada para ellos.
 *
 * Debajo de la lista de modelos se monta `ModelOptionPicker` con las
 * opciones (hoy `effort`) del modelo actualmente SELECCIONADO en el
 * formulario (`selectedId`, borrador — no hace falta que ya esté guardado
 * con "Guardar": persiste inmediato, igual que el proveedor).
 *
 * `SettingsModal` monta este componente con `key={info.provider}`: cambiar
 * de proveedor fuerza un remount completo en vez de sincronizar el estado
 * local con un efecto, así que puede seguir inicializando su selección/
 * borrador con un lazy initializer de `useState` a partir de `info` sin caer
 * en el antipatrón `set-state-in-effect` (mismo criterio que
 * `useDidacticAnalysis`/`DidacticPanel`, ver sus comentarios). Internamente,
 * el formulario se remonta una vez más (`key={modelsLoading}`) cuando el
 * fetch dinámico pasa de "cargando" a "resuelto/falló": así, si el modelo
 * activo persistido solo existe en la lista dinámica (p. ej. un modelo de
 * Codex que no está en el catálogo curado), el borrador se recalcula contra
 * la lista final en vez de quedarse pegado al primer ítem del catálogo
 * estático que se usó mientras cargaba.
 */
export function ModelPicker({ info, error, onSave, onSetModelOption }: ModelPickerProps): React.JSX.Element {
  const fallbackModels = info.catalog[info.provider].models
  const { models, loading: modelsLoading, error: modelsError } = useProviderModels(
    info.provider,
    fallbackModels,
  )

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Modelo de IA</h3>
        {modelsLoading && <Loader2 size={12} className="animate-spin text-muted" />}
      </div>
      <p className="mb-3 text-xs text-muted">
        Modelo usado por el panel didáctico para analizar Pull Requests con{' '}
        {info.catalog[info.provider].label}.
      </p>

      {modelsError && (
        <p className="mb-2 text-xs text-muted">
          No se pudo actualizar la lista de modelos ({modelsError}); mostrando el catálogo curado.
        </p>
      )}

      <ModelPickerForm
        key={String(modelsLoading)}
        info={info}
        models={models}
        error={error}
        onSave={onSave}
        onSetModelOption={onSetModelOption}
      />
    </div>
  )
}

interface ModelPickerFormProps {
  info: AiSettingsInfo
  models: readonly AiModelOption[]
  error: string | null
  onSave: (model: string) => Promise<boolean>
  onSetModelOption: (provider: AiProviderId, optionId: string, value: string) => Promise<boolean>
}

/**
 * Cuerpo del formulario (radios de modelo + "Otro (avanzado)" + Guardar +
 * `ModelOptionPicker`), separado de `ModelPicker` para poder remontarlo
 * (`key={modelsLoading}`, ver arriba) sin perder el spinner/hint del header.
 */
function ModelPickerForm({
  info,
  models,
  error,
  onSave,
  onSetModelOption,
}: ModelPickerFormProps): React.JSX.Element {
  const allowCustom = info.provider === 'openrouter'
  const curated = models.find((m) => m.id === info.model)

  const [selectedId, setSelectedId] = useState(curated?.id ?? models[0]?.id ?? '')
  const [isCustom, setIsCustom] = useState(allowCustom && !curated)
  const [customValue, setCustomValue] = useState(allowCustom && !curated ? info.model : '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const draft = isCustom ? customValue.trim() : selectedId
  const canSave = draft.length > 0 && draft.length <= 100
  const hint = SOURCE_HINT[info.modelSource]
  const selectedModel = isCustom ? undefined : models.find((m) => m.id === selectedId)

  async function handleSave(): Promise<void> {
    if (!canSave) return
    setSaving(true)
    setSaved(false)
    const ok = await onSave(draft)
    setSaving(false)
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    }
    // Si falla, `error` (de `useSettings`, propagado por `SettingsModal`) ya
    // refleja el mensaje en el próximo render — no hace falta duplicarlo.
  }

  return (
    <div>
      <div>
        {hint && (
          <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
            {hint}
          </p>
        )}

        <div className="space-y-2">
          {models.map((model, i) => {
            const checked = !isCustom && selectedId === model.id
            return (
              <label
                key={model.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors duration-150 ${
                  checked ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-accent/30'
                }`}
              >
                <input
                  autoFocus={i === 0}
                  type="radio"
                  name="ai-model"
                  className="mt-0.5 accent-accent"
                  checked={checked}
                  onChange={() => {
                    setIsCustom(false)
                    setSelectedId(model.id)
                  }}
                />
                <span className="flex flex-col">
                  <span className="text-sm text-text">
                    {model.label} <span className="text-muted">· {model.vendor}</span>
                  </span>
                  <span className="font-mono text-[11px] text-muted">{model.id}</span>
                </span>
              </label>
            )
          })}

          {allowCustom && (
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors duration-150 ${
                isCustom ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-accent/30'
              }`}
            >
              <input
                type="radio"
                name="ai-model"
                className="mt-0.5 accent-accent"
                checked={isCustom}
                onChange={() => setIsCustom(true)}
              />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="text-sm text-text">Otro (avanzado)</span>
                <input
                  type="text"
                  value={customValue}
                  onFocus={() => setIsCustom(true)}
                  onChange={(e) => {
                    setIsCustom(true)
                    setCustomValue(e.target.value)
                  }}
                  placeholder="id de openrouter.ai/models, p. ej. mistralai/mistral-large-2411"
                  maxLength={100}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-text placeholder:text-muted focus:border-accent"
                />
              </span>
            </label>
          )}
        </div>

        {selectedModel && (
          <ModelOptionPicker
            key={info.provider + '/' + selectedModel.id}
            provider={info.provider}
            model={selectedModel}
            selected={info.selectedOptions?.[info.provider] ?? {}}
            onSelect={onSetModelOption}
          />
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="min-h-[1.25rem] text-xs">
          {error && <span className="text-danger">{error}</span>}
          {!error && saved && (
            <span className="flex items-center gap-1 text-success">
              <Check size={14} /> Guardado
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={!canSave || saving}
          onClick={() => void handleSave()}
          className={
            canSave && !saving
              ? 'flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25'
              : 'flex items-center gap-1.5 rounded-md border border-border bg-border/40 px-3 py-1.5 text-xs font-medium text-muted'
          }
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Guardar
        </button>
      </div>
    </div>
  )
}
