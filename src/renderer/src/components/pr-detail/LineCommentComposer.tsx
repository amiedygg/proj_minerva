import { useState } from 'react'

interface LineCommentComposerProps {
  onSubmit: (bodyMarkdown: string) => Promise<void>
  onCancel: () => void
}

/**
 * Composer inline para crear un hilo NUEVO en una línea del diff (sin
 * `threadId`, a diferencia de `ThreadCard`'s reply). Se abre bajo la fila al
 * hacer click en el botón "+" del gutter (`SplitDiff`/`InlineDiff`).
 */
export function LineCommentComposer({
  onSubmit,
  onCancel,
}: LineCommentComposerProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const bodyMarkdown = draft.trim()
    if (!bodyMarkdown || posting) return

    setPosting(true)
    setError(null)
    try {
      await onSubmit(bodyMarkdown)
      // Al tener éxito el llamador cierra el composer (desmonta este
      // componente); no hace falta `setPosting(false)` en ese camino.
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setPosting(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-2 border-y border-border bg-bg px-2 py-2"
    >
      <textarea
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={posting}
        rows={2}
        placeholder="Escribe un comentario en esta línea…"
        className="resize-y rounded-md border border-border bg-panel px-2 py-1.5 text-sm text-text placeholder:text-muted focus:border-accent"
      />
      {error && <p className="text-xs text-danger">No se pudo publicar: {error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={posting}
          className="rounded-md px-2.5 py-1 text-xs text-muted hover:text-text"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={posting || draft.trim().length === 0}
          className="rounded-md border border-border bg-accent/90 px-2.5 py-1 text-xs font-medium text-bg transition-colors duration-150 hover:bg-accent disabled:cursor-not-allowed disabled:bg-border/40 disabled:text-muted"
        >
          {posting ? 'Publicando…' : 'Comentar'}
        </button>
      </div>
    </form>
  )
}
