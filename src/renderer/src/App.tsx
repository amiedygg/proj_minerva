import { TitleBar } from './components/layout/TitleBar'
import { Sidebar } from './components/layout/Sidebar'
import { CenterPane } from './components/layout/CenterPane'
import { DidacticPanel } from './components/layout/DidacticPanel'
import { SettingsModal } from './components/settings/SettingsModal'
import { useAppStore } from './stores/app-store'

/**
 * Shell de 3 paneles (T3): sidebar de PRs | centro (conversación/archivos) |
 * panel didáctico colapsable. Todo detrás de datos mock del renderer; el IPC
 * de datos reales llega en T4.
 */
function App(): React.JSX.Element {
  // Montaje condicional (no un `display:none`/`open` prop interno): así
  // `SettingsModal` se desmonta por completo al cerrar y su estado local (y
  // el de `ModelPicker`) arranca de cero la próxima vez que se abra, sin
  // necesitar un efecto de reseteo (ver el comentario de `SettingsModal`).
  const settingsOpen = useAppStore((s) => s.settingsOpen)

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      {/* `relative`: en los tiers angostos (F16/T82) la `Sidebar` se pinta como
          drawer `absolute` DENTRO de esta fila — no sobre el TitleBar, que
          conserva el botón para abrirla y cerrarla. */}
      <div className="relative flex flex-1 overflow-hidden">
        <Sidebar />
        <CenterPane />
        <DidacticPanel />
      </div>
      {settingsOpen && <SettingsModal />}
    </div>
  )
}

export default App
