import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { AI_MODELS } from '../../../../shared/ai-models'
import type { AiModelSource, EffectiveAiModelInfo } from '../../../../shared/types'

const SOURCE_HINT: Record<AiModelSource, string | null> = {
  settings: null,
  env: 'Definido por MINERVA_AI_MODEL en tu .env. Al guardar, este valor de Settings lo pisa.',
  default: 'Todavía no hay nada configurado: se está usando el default (GLM 5.2).',
}

interface ModelPickerProps {
  info: EffectiveAiModelInfo
  error: string | null
  onSave: (aiModel: string) => Promise<boolean>
}

/**
 * Formulario de selección de modelo de IA (radio-cards curadas + "Otro
 * (avanzado)"). Vive en un componente separado de `SettingsModal` a
 * propósito: `SettingsModal` solo lo monta una vez que `info` (el modelo
 * efectivo actual) ya está disponible, así que este componente puede
 * inicializar su estado local (selección, input de "avanzado") con un lazy
 * initializer de `useState` a partir de `info`, sin necesitar un efecto de
 * sincronización — evita el antipatrón `set-state-in-effect` que el linter
 * de hooks de este proyecto rechaza (mismo criterio que
 * `useDidacticAnalysis`/`DidacticPanel` aplican vía remount con `key`, ver
 * sus comentarios).
 */
export function ModelPicker({ info, error, onSave }: ModelPickerProps): React.JSX.Element {
  const curated = AI_MODELS.find((m) => m.id === info.aiModel)

  const [selectedId, setSelectedId] = useState(curated?.id ?? AI_MODELS[0].id)
  const [isCustom, setIsCustom] = useState(!curated)
  const [customValue, setCustomValue] = useState(curated ? '' : info.aiModel)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const draft = isCustom ? customValue.trim() : selectedId
  const canSave = draft.length > 0 && draft.length <= 100
  const hint = SOURCE_HINT[info.aiModelSource]

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
    <>
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          Modelo de IA
        </h3>
        <p className="mb-3 text-xs text-muted">
          Modelo usado por el panel didáctico para analizar Pull Requests vía OpenRouter.
        </p>

        {hint && (
          <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
            {hint}
          </p>
        )}

        <div className="space-y-2">
          {AI_MODELS.map((model, i) => {
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
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
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
      </footer>
    </>
  )
}
