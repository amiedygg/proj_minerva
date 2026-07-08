import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { OpenRouterKeyStatus } from '../../../../shared/types'

interface OpenRouterKeyFormProps {
  status: OpenRouterKeyStatus | null
  loading: boolean
  error: string | null
  saving: boolean
  onSave: (key: string) => Promise<boolean>
  onClear: () => Promise<boolean>
}

/**
 * Campo para configurar la API key de OpenRouter (T32/T30): la key NUNCA
 * vuelve del backend (`settings:getOpenRouterKeyStatus` solo devuelve
 * `{configured, source}`), así que el input siempre arranca vacío — no hay
 * nada que "recargar" en él, solo se puede sobreescribir o borrar. Se
 * renderiza montado/desmontado por `ProviderPicker` según el proveedor
 * seleccionado (condicional, no `key`), así que el input local se resetea
 * solo con volver a OpenRouter.
 */
export function OpenRouterKeyForm({
  status,
  loading,
  error,
  saving,
  onSave,
  onClear,
}: OpenRouterKeyFormProps): React.JSX.Element {
  const [keyValue, setKeyValue] = useState('')
  const [saved, setSaved] = useState<'saved' | 'cleared' | null>(null)

  const canSave = keyValue.trim().length > 0 && !saving
  const canClear = status?.source === 'safeStorage' && !saving

  async function handleSave(): Promise<void> {
    if (!canSave) return
    setSaved(null)
    const ok = await onSave(keyValue.trim())
    if (ok) {
      setKeyValue('')
      setSaved('saved')
      setTimeout(() => setSaved(null), 1800)
    }
  }

  async function handleClear(): Promise<void> {
    if (!canClear) return
    setSaved(null)
    const ok = await onClear()
    if (ok) {
      setSaved('cleared')
      setTimeout(() => setSaved(null), 1800)
    }
  }

  const statusText = loading
    ? 'Comprobando…'
    : status?.source === 'safeStorage'
      ? 'Configurada (guardada de forma segura en este equipo)'
      : status?.source === 'env'
        ? 'Tomada de tu archivo .env — guardala acá para que quede cifrada'
        : 'No configurada'

  return (
    <div className="mt-2 rounded-md border border-border bg-bg/40 p-2.5">
      <p className="mb-2 text-xs text-muted">
        API key de <span className="font-mono text-text">openrouter.ai/keys</span>:{' '}
        <span className="text-text">{statusText}</span>
      </p>

      <div className="flex items-center gap-2">
        <input
          type="password"
          value={keyValue}
          onChange={(e) => setKeyValue(e.target.value)}
          placeholder="sk-or-v1-…"
          maxLength={200}
          autoComplete="off"
          className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-text placeholder:text-muted focus:border-accent"
        />
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void handleSave()}
          className={
            canSave
              ? 'flex shrink-0 items-center gap-1 rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/25'
              : 'flex shrink-0 items-center gap-1 rounded-md border border-border bg-border/40 px-2.5 py-1 text-xs font-medium text-muted'
          }
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Guardar
        </button>
        <button
          type="button"
          disabled={!canClear}
          onClick={() => void handleClear()}
          className={
            canClear
              ? 'shrink-0 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/20'
              : 'shrink-0 rounded-md border border-border bg-border/40 px-2.5 py-1 text-xs font-medium text-muted'
          }
        >
          Borrar
        </button>
      </div>

      <div className="mt-1.5 min-h-[1rem] text-xs">
        {error && <span className="text-danger">{error}</span>}
        {!error && saved === 'saved' && (
          <span className="flex items-center gap-1 text-success">
            <Check size={12} /> Key guardada
          </span>
        )}
        {!error && saved === 'cleared' && (
          <span className="flex items-center gap-1 text-success">
            <Check size={12} /> Key borrada
          </span>
        )}
      </div>
    </div>
  )
}
