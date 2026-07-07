import { useMemo } from 'react'
import { groupByRepo } from '../../lib/pr-filters'
import { usePullRequests } from '../../hooks/use-pull-requests'
import { useAuth } from '../../hooks/use-auth'
import { useAppStore } from '../../stores/app-store'
import { RepoGroup } from '../pr-list/RepoGroup'

/**
 * `RealGithubService` (T6) lanza exactamente este mensaje cuando no hay
 * sesión iniciada (`src/main/github/real-service.ts`); se detecta por texto
 * en vez de agregar un campo nuevo a `AuthStatus`/errores IPC solo para esto.
 * En modo mock (`MINERVA_MOCK=1`) el mock nunca lanza este error, así que
 * este CTA no reemplaza nada ahí aunque `auth` esté en `signed_out`.
 */
const NOT_AUTHENTICATED_MARKER = 'No autenticado'

export function Sidebar(): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.searchQuery)
  const authState = useAppStore((s) => s.authStatus.state)
  const { pullRequests, loading, error } = usePullRequests(searchQuery, authState)
  const { signIn } = useAuth()

  const groups = useMemo(() => groupByRepo(pullRequests), [pullRequests])
  const needsLogin = Boolean(error?.includes(NOT_AUTHENTICATED_MARKER))

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-border bg-panel">
      {needsLogin ? (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <span className="text-3xl" aria-hidden>
            🔒
          </span>
          <p className="text-sm text-muted">Inicia sesión con GitHub para ver tus pull requests.</p>
          <button
            type="button"
            onClick={() => void signIn()}
            className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20"
          >
            Iniciar sesión con GitHub
          </button>
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
            <p>No hay PRs abiertos que te involucren.</p>
            <p className="text-xs">
              Tip: el buscador acepta cualificadores de GitHub, p. ej.{' '}
              <code className="rounded bg-bg px-1">org:mi-org</code> o{' '}
              <code className="rounded bg-bg px-1">repo:owner/nombre</code>.
            </p>
          </div>
        )
      ) : (
        groups.map((group) => <RepoGroup key={group.repo.fullName} group={group} />)
      )}
    </aside>
  )
}
