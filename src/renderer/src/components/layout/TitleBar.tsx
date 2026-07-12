import { GraduationCap, Search, Settings } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useConnectionStatus } from '../../hooks/use-connection-status'
import { useAuth } from '../../hooks/use-auth'
import { useSettings } from '../../hooks/use-settings'
import { getModelOption } from '../../../../shared/ai-providers'
import { resolveModelHintLabels } from '../../lib/model-labels'
import { IconButton } from '../ui/IconButton'
import { Badge } from '../ui/Badge'

/**
 * Chip resumen "Proveedor · Modelo" en el engrane de Settings (T63, F12):
 * reemplaza el botón cuadrado de solo-icono para que la config vigente sea
 * visible SIN abrir el modal (pedido de Edilson, ver `PLAN.md` § F12).
 * SIEMPRE mantiene el icono `Settings` de `lucide-react` DENTRO del botón —
 * `smoke-settings.mjs` localiza el engrane por `svg.lucide-settings`, no
 * puede sacarse de acá — y agrega el texto recién cuando `useSettings().info`
 * ya cargó (antes de eso solo el icono, igual que el `IconButton` viejo).
 *
 * Los labels salen de `resolveModelHintLabels` (extraída a
 * `lib/model-labels.ts` en T62 para que este chip, `ActiveConfigSummary` del
 * modal y `ActiveModelHint` del panel didáctico nunca diverjan) y de
 * `getModelOption` para el label humano del modelo (`info.model` crudo si no
 * está en el catálogo, p. ej. un slug "avanzado" de OpenCode).
 *
 * `useSettings()` ya cachea la selección en el store zustand compartido con
 * `SettingsModal` — abrir/cerrar el modal no dispara un fetch nuevo, y un
 * cambio hecho ahí se refleja acá al instante (mismo estado).
 */
function SettingsChip(): React.JSX.Element {
  const openSettings = useAppStore((s) => s.openSettings)
  const { info } = useSettings()

  if (!info) {
    return <IconButton icon={<Settings size={16} />} label="Configuración" onClick={openSettings} />
  }

  const modelLabel = getModelOption(info.catalog, info.provider, info.model)?.label ?? info.model
  const effortValue = info.selectedOptions?.[info.provider]?.effort
  const { providerLabel, effortLabel } = resolveModelHintLabels(info.catalog, info.provider, info.model, effortValue)

  const title =
    'Configuración — ' +
    providerLabel +
    ' · ' +
    info.model +
    (effortLabel ? ' · Razonamiento: ' + effortLabel : '') +
    ' · origen ' +
    info.modelSource

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={openSettings}
      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-muted transition-colors duration-150 hover:border-accent hover:text-text"
    >
      <Settings size={16} />
      <span className="text-xs">
        {providerLabel} · {modelLabel}
      </span>
    </button>
  )
}

const CONNECTION_LABEL: Record<ReturnType<typeof useConnectionStatus>, string> = {
  connected: 'Conectado',
  error: 'Sin conexión',
  checking: 'Comprobando…',
}

/**
 * Controles de login/logout de GitHub, según `AuthStatus.state`/`.mode`:
 * - `signed_out` (oauth): botón para arrancar el device flow.
 * - `device_pending` (oauth): chip con el código (click = copiar al
 *   portapapeles) + enlace a github.com/login/device (`target="_blank"`:
 *   main ya filtra que `setWindowOpenHandler` solo abra http(s) en el
 *   navegador del sistema) + spinner mientras `main` hace polling en segundo
 *   plano.
 * - `signed_in` (oauth): login del usuario + botón de cerrar sesión.
 * - `signed_in` (gh-cli, F14/T71): login del usuario + badge discreto "vía
 *   GitHub CLI"; SIN botón de cerrar sesión (`signOut()` es no-op en este
 *   modo, ver `auth-manager.ts` — salir es cambiar a OAuth desde Settings) y
 *   en su lugar un botón sutil que abre el modal de Settings.
 * - `cli_unavailable` (gh-cli, F14/T71): el binario `gh` no está en PATH —
 *   texto compacto + botón a Settings.
 * - `cli_unauthenticated` (gh-cli, F14/T71): chip copiable con el comando
 *   `gh auth login` (mismo patrón visual que el chip del userCode del device
 *   flow) + spinner sutil — el polling declarativo de `use-auth.ts` sigue
 *   corriendo en este estado y descubre solo cuando el usuario complete el
 *   login en una terminal.
 */
function AuthControls(): React.JSX.Element {
  const { status, signIn, signOut } = useAuth()
  const openSettings = useAppStore((s) => s.openSettings)

  if (status.state === 'signed_in' && status.mode === 'gh-cli') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-text">{status.user?.login}</span>
        <Badge tone="neutral">vía GitHub CLI</Badge>
        <IconButton
          icon={<Settings size={13} />}
          label="El acceso se gestiona con GitHub CLI; cámbialo en Configuración"
          onClick={openSettings}
        />
      </div>
    )
  }

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

  if (status.state === 'cli_unavailable') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">GitHub CLI no encontrado</span>
        <button
          type="button"
          onClick={openSettings}
          className="rounded-md border border-border px-2 py-1 text-muted transition-colors duration-150 hover:border-accent hover:text-text"
        >
          Abrir configuración
        </button>
      </div>
    )
  }

  if (status.state === 'cli_unauthenticated') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span
          className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
          aria-hidden
        />
        <button
          type="button"
          title="Copiar comando"
          onClick={() => void navigator.clipboard?.writeText('gh auth login').catch(() => {})}
          className="rounded-md border border-accent/50 bg-accent/10 px-2 py-1 font-mono text-sm font-semibold text-accent transition-colors duration-150 hover:bg-accent/20"
        >
          gh auth login
        </button>
        <span className="text-muted">Esperando sesión…</span>
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
        <SettingsChip />

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
