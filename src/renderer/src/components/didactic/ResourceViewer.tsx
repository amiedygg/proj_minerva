import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { DidacticSnippet } from '../../../../shared/types'
import { IconButton } from '../ui/IconButton'
import { Markdown } from '../ui/Markdown'
import { CodeSnippet } from './CodeSnippet'
import { MermaidZoomPan } from './MermaidZoomPan'

/**
 * Recurso que puede abrirse en el lightbox (T14). `markdown` cubre tanto el
 * caso "ver esta sección en grande" (tablas incluidas, ver el comentario de
 * `DidacticSectionCard`) como cualquier otro texto largo.
 */
export type ViewerResource =
  | { kind: 'mermaid'; title: string; code: string }
  | { kind: 'markdown'; title: string; markdown: string }
  | { kind: 'snippet'; title: string; snippet: DidacticSnippet }

interface ResourceViewerProps {
  resource: ViewerResource
  onClose: () => void
}

/**
 * Overlay a pantalla completa (dentro de la ventana que lo abre — panel
 * principal o ventana didáctica desacoplada, ambas reutilizan este mismo
 * componente) para inspeccionar un recurso del panel didáctico en grande:
 * diagramas Mermaid con zoom/pan (`MermaidZoomPan`), o tablas/snippets en una
 * vista ancha centrada con scroll. Cierra con el botón X o con Escape.
 */
export function ResourceViewer({ resource, onClose }: ResourceViewerProps): React.JSX.Element {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      {/*
        Altura del diálogo: para mermaid debe ser FIJA (h-[90vh]) y no
        max-h-[90vh] — el diagrama dentro de MermaidZoomPan está posicionado
        `absolute` (fuera de flujo, no aporta altura), así que con altura
        basada en contenido el diálogo colapsaba a header+toolbar y el visor
        se veía vacío (bug reportado con captura; los checks geométricos por
        CDP no lo veían porque getBoundingClientRect ignora el clipping).
        Para markdown/snippet (contenido en flujo con scroll) se mantiene
        max-h para que recursos cortos no abran un diálogo gigante vacío.
      */}
      <div
        className={
          'flex w-[92vw] max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl ' +
          (resource.kind === 'mermaid' ? 'h-[90vh]' : 'max-h-[90vh]')
        }
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <span className="truncate text-sm font-semibold text-text">{resource.title}</span>
          <IconButton icon={<X size={16} />} label="Cerrar" onClick={onClose} />
        </header>

        <div className="min-h-0 flex-1">
          {resource.kind === 'mermaid' && <MermaidZoomPan code={resource.code} />}

          {resource.kind === 'markdown' && (
            <div className="h-full overflow-y-auto p-4">
              <div className="mx-auto max-w-4xl">
                <Markdown content={resource.markdown} />
              </div>
            </div>
          )}

          {resource.kind === 'snippet' && (
            <div className="h-full overflow-y-auto p-4">
              <div className="mx-auto max-w-4xl">
                <CodeSnippet snippet={resource.snippet} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
