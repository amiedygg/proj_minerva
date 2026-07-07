import type { ReactNode } from 'react'
import { Maximize2 } from 'lucide-react'

interface ExpandableResourceProps {
  label: string
  onExpand: () => void
  children: ReactNode
}

/**
 * Envoltorio hover-a-la-vista para un diagrama Mermaid (ver
 * `DidacticAnalysisArea.tsx`; los snippets NO lo usan — su botón expandir
 * vive dentro del header de `CodeSnippet`, porque este overlay flotante
 * caería encima del botón "Copiar"): al pasar el mouse por encima
 * aparece un botoncito "expandir" en la esquina que abre el `ResourceViewer`
 * (`./ResourceViewer.tsx`) con ese recurso. `group`/`group-hover` es Tailwind
 * estándar; `focus-visible` mantiene el botón visible también por teclado.
 */
export function ExpandableResource({
  label,
  onExpand,
  children,
}: ExpandableResourceProps): React.JSX.Element {
  return (
    <div className="group relative">
      {children}
      <button
        type="button"
        onClick={onExpand}
        title={label}
        aria-label={label}
        className="absolute top-2 right-2 rounded-md border border-border bg-panel/90 p-1 text-muted opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  )
}
