import { useRef } from 'react'
import { ExternalLink, GraduationCap, X } from 'lucide-react'
import { DIDACTIC_PANEL_DEFAULT_WIDTH, useAppStore } from '../../stores/app-store'
import { IconButton } from '../ui/IconButton'
import { DidacticAnalysisArea } from '../didactic/DidacticAnalysisArea'
import { DidacticPlaceholder } from '../didactic/DidacticPlaceholder'

/**
 * Panel didáctico (F3): resumen + diagramas Mermaid (C4/ER) + snippets
 * copiables de endpoint, generados por `ai:analyzePullRequest`. Detrás de
 * un `AiService` mock por ahora (T9 mock/T10); la implementación real con
 * Anthropic se enchufa detrás de la misma interfaz en T9-final.
 *
 * Sin PR seleccionado: placeholder con el botón "Analizar PR" deshabilitado.
 * Con PR seleccionado: `DidacticAnalysisArea` (keyed por `selectedPr.id`, ver
 * ahí por qué) maneja loading/error/análisis/placeholder habilitado, además
 * del hint del modelo activo y el botón "Re-analizar" (T14, se muestran
 * junto al contenido en cuanto hay un resultado, no en este header estático).
 *
 * "Abrir en ventana" (T14, icono `ExternalLink`) solo aparece con un PR
 * seleccionado: pide `window:openDidactic`, que abre (o reenfoca, si ya hay
 * una) la ventana didáctica desacoplada sobre el MISMO análisis (cacheado o
 * en curso — T22, `useDidacticAnalysis` se engancha al streaming en la
 * ventana nueva si el análisis todavía no terminó). Reportado por Edilson
 * (T22): dejar el panel acoplado abierto además de la ventana desacoplada
 * mostraba el mismo análisis dos veces sin motivo — este botón ahora CIERRA
 * el panel acoplado (`toggleDidacticPanel`, sabemos que está abierto porque
 * este botón solo se renderiza en esa rama) justo después de pedir la
 * ventana, para que quede una sola superficie mostrando el PR desacoplado.
 *
 * Resize (T23): el borde izquierdo es un handle de arrastre (pointer events
 * con `setPointerCapture`: el puntero puede salirse del handle de 6px durante
 * el arrastre y los `pointermove` siguen llegando igual — sin listeners
 * globales que limpiar). El ancho vive en el store (`didacticPanelWidth`,
 * clampeado y persistido en `localStorage` por `setDidacticPanelWidth`);
 * doble click en el handle vuelve al ancho por defecto.
 */
export function DidacticPanel(): React.JSX.Element {
  const didacticPanelOpen = useAppStore((s) => s.didacticPanelOpen)
  const toggleDidacticPanel = useAppStore((s) => s.toggleDidacticPanel)
  const selectedPr = useAppStore((s) => s.selectedPr)
  const panelWidth = useAppStore((s) => s.didacticPanelWidth)
  const setPanelWidth = useAppStore((s) => s.setDidacticPanelWidth)
  const asideRef = useRef<HTMLElement>(null)

  if (!didacticPanelOpen) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l border-border bg-panel py-3">
        <IconButton
          icon={<GraduationCap size={16} />}
          label="Abrir panel didáctico"
          onClick={toggleDidacticPanel}
        />
      </aside>
    )
  }

  return (
    <aside
      ref={asideRef}
      style={{ width: panelWidth }}
      className="relative flex shrink-0 flex-col border-l border-border bg-panel"
    >
      {/* Handle de resize (T23): franja de 6px sobre el borde izquierdo. El
          ancho nuevo es la distancia del puntero al borde DERECHO del aside
          (el panel crece hacia la izquierda); el clamp vive en el store. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar panel didáctico"
        title="Arrastrar para redimensionar; doble click restaura el ancho por defecto"
        className="absolute inset-y-0 -left-[3px] z-10 w-1.5 cursor-col-resize touch-none hover:bg-accent/50 active:bg-accent/70"
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          const right = asideRef.current?.getBoundingClientRect().right ?? window.innerWidth
          setPanelWidth(right - e.clientX)
        }}
        onDoubleClick={() => setPanelWidth(DIDACTIC_PANEL_DEFAULT_WIDTH)}
      />
      <header className="flex flex-col gap-0.5 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <GraduationCap size={16} className="text-accent" />
            Panel didáctico
          </span>
          <div className="flex items-center gap-1">
            {selectedPr && (
              <IconButton
                icon={<ExternalLink size={16} />}
                label="Abrir en ventana"
                onClick={() => {
                  void window.minerva.window.openDidactic({
                    repo: selectedPr.repo,
                    number: selectedPr.number,
                    title: selectedPr.title,
                  })
                  toggleDidacticPanel()
                }}
              />
            )}
            <IconButton
              icon={<X size={16} />}
              label="Cerrar panel didáctico"
              onClick={toggleDidacticPanel}
            />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {selectedPr ? (
          <DidacticAnalysisArea
            key={selectedPr.id}
            repo={selectedPr.repo}
            number={selectedPr.number}
          />
        ) : (
          <DidacticPlaceholder />
        )}
      </div>
    </aside>
  )
}
