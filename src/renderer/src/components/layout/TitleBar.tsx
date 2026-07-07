import { GraduationCap, Search, Settings } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useConnectionStatus } from '../../hooks/use-connection-status'
import { useAuth } from '../../hooks/use-auth'
import { IconButton } from '../ui/IconButton'

const CONNECTION_LABEL: Record<ReturnType<typeof useConnectionStatus>, string> = {
  connected: 'Conectado',
  error: 'Sin conexión',
  checking: 'Comprobando…',
}

/**
 * Controles de login/logout de GitHub, tres formas según `AuthStatus.state`:
 * - `signed_out`: botón para arrancar el device flow.
 * - `device_pending`: chip con el código (click = copiar al portapapeles) +
 *   enlace a github.com/login/device (`target="_blank"`: main ya filtra que
 *   `setWindowOpenHandler` solo abra http(s) en el navegador del sistema) +
 *   spinner mientras `main` hace polling en segundo plano.
 * - `signed_in`: login del usuario + botón de cerrar sesión.
 */
function AuthControls(): React.JSX.Element {
  const { status, signIn, signOut } = useAuth()

  if (status.state === 'signed_in') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-text">{status.user?.login}</span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-md border border-border px-2 py-1 text-muted transition-colors duration-150 hover:border-danger/60 hover:text-danger"
        >
          Cerrar sesión
        </button>
      </div>
    )
  }

  if (status.state === 'device_pending' && status.deviceCode) {
    const { userCode, verificationUri } = status.deviceCode
    return (
      <div className="flex items-center gap-2 text-xs">
        <span
          className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
          aria-hidden
        />
        <button
          type="button"
          title="Copiar código"
          onClick={() => void navigator.clipboard?.writeText(userCode).catch(() => {})}
          className="rounded-md border border-accent/50 bg-accent/10 px-2 py-1 font-mono text-sm font-semibold tracking-widest text-accent transition-colors duration-150 hover:bg-accent/20"
        >
          {userCode}
        </button>
        <a
          href={verificationUri}
          target="_blank"
          rel="noreferrer"
          className="text-muted underline decoration-dotted transition-colors duration-150 hover:text-text"
        >
          ingresa el código en github.com/login/device
        </a>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void signIn()}
      className="rounded-md border border-border px-2.5 py-1 text-xs text-text transition-colors duration-150 hover:border-accent"
    >
      Iniciar sesión con GitHub
    </button>
  )
}

export function TitleBar(): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const didacticPanelOpen = useAppStore((s) => s.didacticPanelOpen)
  const toggleDidacticPanel = useAppStore((s) => s.toggleDidacticPanel)
  const openSettings = useAppStore((s) => s.openSettings)
  const connectionStatus = useConnectionStatus()

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-panel px-3">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-text">
        <span aria-hidden>🦉</span>
        Minerva
      </span>

      <div className="relative ml-2 max-w-md flex-1">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar PRs por título o repo…"
          className="w-full rounded-md border border-border bg-bg py-1.5 pl-8 pr-3 text-sm text-text placeholder:text-muted transition-colors duration-150 focus:border-accent"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <IconButton icon={<Settings size={16} />} label="Configuración" onClick={openSettings} />

        <AuthControls />

        <span
          className="flex items-center gap-1.5 text-xs text-muted"
          title={`Estado de la conexión IPC con el proceso principal: ${CONNECTION_LABEL[connectionStatus]}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connectionStatus === 'connected'
                ? 'bg-success'
                : connectionStatus === 'error'
                  ? 'bg-danger'
                  : 'bg-warning'
            }`}
          />
          {CONNECTION_LABEL[connectionStatus]}
        </span>

        <IconButton
          icon={<GraduationCap size={16} />}
          label="Panel didáctico"
          active={didacticPanelOpen}
          onClick={toggleDidacticPanel}
        />
      </div>
    </header>
  )
}
