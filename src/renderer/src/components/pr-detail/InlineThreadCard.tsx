import { X } from 'lucide-react'
import type { CommentThread } from '../../../../shared/types'
import { ThreadCard } from './ThreadCard'

interface InlineThreadCardProps {
  thread: CommentThread
  onReply: (threadId: string, bodyMarkdown: string) => Promise<void>
  onClose: () => void
}

/**
 * Hilo de línea expandido inline, debajo de la fila del diff que lo originó
 * (`SplitDiff`/`InlineDiff`). Envuelve `ThreadCard` agregando el `id` que usa
 * `DiffView` para hacer scroll-into-view cuando se llega acá navegando desde
 * un chip de `ConversationTab`, y el botón para cerrar el hilo expandido.
 */
export function InlineThreadCard({
  thread,
  onReply,
  onClose,
}: InlineThreadCardProps): React.JSX.Element {
  return (
    <div id={`thread-${thread.id}`} className="border-y border-border bg-bg px-2 py-2">
      <ThreadCard
        thread={thread}
        onReply={onReply}
        extraHeaderContent={
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar hilo"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:text-text"
          >
            <X size={13} />
          </button>
        }
      />
    </div>
  )
}
