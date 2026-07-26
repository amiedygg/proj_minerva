import { useEffect, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import type { PrStateFilter, PullRequestSummary } from '../../../../shared/types'
import { groupByRepo } from '../../lib/pr-filters'
import { usePullRequests } from '../../hooks/use-pull-requests'
import { useAuth } from '../../hooks/use-auth'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { SIDEBAR_WIDTH, sidebarIsDrawer } from '../../lib/layout'
import { useAppStore } from '../../stores/app-store'
import { RepoGroup } from '../pr-list/RepoGroup'
import { IconButton } from '../ui/IconButton'

/**
 * `RealGithubService` (T6) lanza exactamente este mensaje cuando no hay
 * sesión iniciada (`src/main/github/real-service.ts`); se detecta por texto
 * en vez de agregar un campo nuevo a `AuthStatus`/errores IPC solo para esto.
 * En modo mock (`MINERVA_MOCK=1`) el mock nunca lanza este error, así que
 * este CTA no reemplaza nada ahí aunque `auth` esté en `signed_out`.
 */
const NOT_AUTHENTICATED_MARKER = 'No autenticado'

const STATE_FILTER_OPTIONS: { value: PrStateFilter; label: string }[] = [
  { value: 'open', label: 'Abiertos' },
  { value: 'closed', label: 'Cerrados' },
  { value: 'all', label: 'Todos' },
]

/** Mensaje de lista vacía (T52, F10) según el filtro de estado vigente. */
function emptyStateMessage(filter: PrStateFilter): string {
  switch (filter) {
    case 'open':
      return 'No hay PRs abiertos.'
    case 'closed':
      return 'No hay PRs cerrados.'
    case 'all':
      return 'No hay PRs.'
  }
}

/** Segmented control de 3 opciones (T52, F10) para `prStateFilter`. */
function StateFilterControl({
  value,
  onChange,
}: {
  value: PrStateFilter
  onChange: (filter: PrStateFilter) => void
}): React.JSX.Element {
  return (
    <div className="flex rounded-md border border-border bg-bg p-0.5 text-xs">
      {STATE_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded px-2 py-1 font-medium transition-colors duration-150 ${
            value === option.value
              ? 'bg-accent/15 text-accent'
              : 'text-muted hover:text-text'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Lista de PRs. Dos formas según el tier de layout (F16/T82):
 *
 * - `xl`/`lg`: columna acoplada de 280/240px, como siempre.
 * - `md`/`sm` (ventana tileada a media pantalla o menos): **drawer overlay**
 *   sobre el centro, cerrado por defecto y abierto desde el botón del TitleBar.
 *   Motivo medido (PLAN.md § F16): con la columna fija, a 960px de ancho la
 *   sidebar + el árbol de archivos + el panel didáctico dejaban el diff en
 *   40px. Elegir un PR cierra el drawer (`selectPr` en el store).
 *
 * Los hooks de datos corren SIEMPRE, también con el drawer cerrado: la lista
 * (y su watcher) no debe depender de si el overlay está visible.
 */
export function Sidebar(): React.JSX.Element | null {
  const searchQuery = useAppStore((s) => s.searchQuery)
  const authStatus = useAppStore((s) => s.authStatus)
  const openSettings = useAppStore((s) => s.openSettings)
  const prStateFilter = useAppStore((s) => s.prStateFilter)
  const setPrStateFilter = useAppStore((s) => s.setPrStateFilter)
  const selectPr = useAppStore((s) => s.selectPr)
  // Clave compuesta (F14/T71) en vez del `state` solo: cambiar de modo desde
  // Settings (oauth ⇄ gh-cli) debe refetchear la lista igual que cambiar de
  // `state` — `usePullRequests` trata este parámetro como un string opaco.
  const { pullRequests, loading, error, refetch, markSeen } = usePullRequests(
    searchQuery,
    authStatus.mode + ':' + authStatus.state,
    prStateFilter,
  )
  const { signIn } = useAuth()
  const tier = useLayoutTier()
  const isDrawer = sidebarIsDrawer(tier.w)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const closeSidebar = useAppStore((s) => s.closeSidebar)

  // Esc cierra el drawer (solo cuando está abierto y no hay un modal encima:
  // `SettingsModal` monta su propio listener y también cierra con Esc).
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  useEffect(() => {
    if (!isDrawer || !sidebarOpen || settingsOpen) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeSidebar()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isDrawer, sidebarOpen, settingsOpen, closeSidebar])

  const groups = useMemo(() => groupByRepo(pullRequests), [pullRequests])
  const needsLogin = Boolean(error?.includes(NOT_AUTHENTICATED_MARKER))
  const isGhCliMode = authStatus.mode === 'gh-cli'

  const handleSelectPr = (pr: PullRequestSummary): void => {
    selectPr(pr)
    markSeen(pr)
  }

  if (isDrawer && !sidebarOpen) return null

  const asideClass = isDrawer
    ? 'absolute inset-y-0 left-0 z-40 flex w-[300px] max-w-[85%] flex-col overflow-y-auto border-r border-border bg-panel shadow-2xl'
    : 'flex shrink-0 flex-col overflow-y-auto border-r border-border bg-panel'

  return (
    <>
      {isDrawer && (
        <div
          className="absolute inset-0 z-30 bg-black/50"
          onClick={closeSidebar}
          aria-hidden
        />
      )}
      <aside
        aria-label="Lista de pull requests"
        style={isDrawer ? undefined : { width: SIDEBAR_WIDTH[tier.w] }}
        className={asideClass}
      >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
        <StateFilterControl value={prStateFilter} onChange={setPrStateFilter} />
        <IconButton
          icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
          label="Actualizar"
          onClick={refetch}
          disabled={loading}
          className="ml-auto"
        />
      </div>
      {needsLogin ? (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <span className="text-3xl" aria-hidden>
            🔒
          </span>
          {isGhCliMode ? (
            // Modo gh-cli (F14/T71): `signIn()` arrancaría un device flow que
            // `main` ignora en este modo (no-op) — el CTA guía a la terminal
            // en vez de llamarlo. F18: si hay una cuenta elegida a mano, se la
            // nombra — "corré gh auth login" a secas sería un consejo
            // equivocado cuando el CLI está bien y lo que falla es la
            // elección (mismo criterio que `GithubAccessSection`).
            <>
              {authStatus.ghAccount !== undefined ? (
                <p className="text-sm text-muted">
                  La cuenta <span className="font-mono text-text">{authStatus.ghAccount}</span> no
                  tiene sesión válida en gh. Elegí otra en configuración, o renovala con{' '}
                  <span className="font-mono text-text">gh auth login</span>.
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Autentícate con GitHub CLI: ejecuta{' '}
                  <span className="font-mono text-text">gh auth login</span> en una terminal.
                </p>
              )}
              <button
                type="button"
                onClick={openSettings}
                className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20"
              >
                Abrir configuración
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Inicia sesión con GitHub para ver tus pull requests.</p>
              <button
                type="button"
                onClick={() => void signIn()}
                className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20"
              >
                Iniciar sesión con GitHub
              </button>
            </>
          )}
        </div>
      ) : error ? (
        <p className="p-4 text-sm text-danger">No se pudo cargar la lista de PRs: {error}</p>
      ) : loading && pullRequests.length === 0 ? (
        <p className="p-4 text-sm text-muted">Cargando PRs…</p>
      ) : groups.length === 0 ? (
        searchQuery.trim() ? (
          <p className="p-4 text-sm text-muted">No hay PRs que coincidan con "{searchQuery}".</p>
        ) : (
          <div className="flex flex-col gap-2 p-4 text-sm text-muted">
            <p>{emptyStateMessage(prStateFilter)}</p>
            <p className="text-xs">
              Tip: el buscador acepta cualificadores de GitHub, p. ej.{' '}
              <code className="rounded bg-bg px-1">org:mi-org</code> o{' '}
              <code className="rounded bg-bg px-1">repo:owner/nombre</code>.
            </p>
          </div>
        )
      ) : (
        groups.map((group) => (
          <RepoGroup key={group.repo.fullName} group={group} onSelectPr={handleSelectPr} />
        ))
      )}
      </aside>
    </>
  )
}
