import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useSettings } from '../../hooks/use-settings'
import { IconButton } from '../ui/IconButton'
import { ModelPicker } from './ModelPicker'

/**
 * Modal de settings (T12): hoy solo tiene la sección "Modelo de IA", pensado
 * para crecer con más secciones más adelante.
 *
 * `App.tsx` solo monta este componente mientras `settingsOpen` es `true`
 * (`{settingsOpen && <SettingsModal />}`): al cerrar, se desmonta por
 * completo, lo que resetea cualquier estado local (de este componente o de
 * `ModelPicker`) de forma automática la próxima vez que se abra — el mismo
 * patrón de "resetear vía remount" que usa `DidacticPanel` con
 * `useDidacticAnalysis`, en vez de un efecto que sincronice estado en cada
 * apertura (ver también el comentario de cabecera de `ModelPicker`).
 *
 * Cierra con Esc o con un clic fuera de la card (el overlay tiene el
 * `onClick`; la card detiene la propagación). El borrador de selección vive
 * en `ModelPicker` como estado local: cerrar sin pulsar "Guardar" no aplica
 * ningún cambio.
 *
 * Foco inicial: la primera radio-card de `ModelPicker` tiene `autoFocus`
 * (nativo de React, se aplica en el commit inicial). La card en sí es
 * `tabIndex={-1}` como respaldo focoable mientras `info` todavía carga (sin
 * radios que enfocar todavía) — no se fuerza `.focus()` desde un efecto para
 * no competir con ese `autoFocus`.
 */
export function SettingsModal(): React.JSX.Element {
  const closeSettings = useAppStore((s) => s.closeSettings)
  const { info, error, save } = useSettings()
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeSettings()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeSettings])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={closeSettings}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl outline-none"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="settings-modal-title" className="text-sm font-semibold text-text">
            Configuración
          </h2>
          <IconButton icon={<X size={16} />} label="Cerrar configuración" onClick={closeSettings} />
        </header>

        {info === null ? (
          <p className="p-4 text-xs text-muted">Cargando…</p>
        ) : (
          <ModelPicker info={info} error={error} onSave={save} />
        )}
      </div>
    </div>
  )
}
