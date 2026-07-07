import { MessageSquare } from 'lucide-react'

interface LineThreadIndicatorProps {
  active: boolean
  count: number
  onClick: () => void
}

/**
 * Icono pequeño en el gutter de una línea del diff que ya tiene un hilo de
 * comentarios. Click expande/colapsa el hilo inline debajo de la fila
 * (`InlineThreadCard`, controlado por `DiffView` vía `expandedThreadId`).
 */
export function LineThreadIndicator({
  active,
  count,
  onClick,
}: LineThreadIndicatorProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? 'Cerrar hilo de comentarios' : `Ver hilo de comentarios (${count})`}
      title={`${count} ${count === 1 ? 'comentario' : 'comentarios'}`}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ${
        active ? 'text-accent' : 'text-muted hover:text-accent'
      }`}
    >
      <MessageSquare size={12} fill={active ? 'currentColor' : 'none'} />
    </button>
  )
}
