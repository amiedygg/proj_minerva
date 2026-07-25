import { GitBranch } from 'lucide-react'
import type { PullRequestDetail } from '../../../../shared/types'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'

interface PrHeaderProps {
  pr: PullRequestDetail
}

/**
 * Cabecera del PR. Con la ventana baja (`short`/`xshort`, p. ej. una mitad
 * horizontal de 1920x540) pasa a UNA línea y manda autor/rama/commits/labels a
 * un `<details>` "Detalles" (F16/T84): en el layout completo esta cabecera come
 * ~110px de los ~490px útiles, y lo que el usuario vino a leer está debajo.
 * El `<details>` nativo evita sumar estado y cierra con Esc por sí solo.
 */
export function PrHeader({ pr }: PrHeaderProps): React.JSX.Element {
  const tier = useLayoutTier()

  const meta = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <Avatar user={pr.author} size={18} />
        {pr.author.login}
      </span>
      <span className="flex items-center gap-1 font-mono">
        <GitBranch size={12} />
        {pr.headRef} → {pr.baseRef}
      </span>
      <span>
        {pr.commits} {pr.commits === 1 ? 'commit' : 'commits'}
      </span>
    </div>
  )

  const labels = pr.labels.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {pr.labels.map((label) => (
        <span
          key={label.name}
          className="rounded-full px-2 py-0.5 text-[11px] font-medium text-bg"
          style={{ backgroundColor: `#${label.color}` }}
        >
          {label.name}
        </span>
      ))}
    </div>
  )

  if (tier.h !== 'tall') {
    return (
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
        <h1 className="min-w-0 truncate text-sm font-semibold text-text">
          {pr.title} <span className="font-normal text-muted">#{pr.number}</span>
        </h1>
        {pr.isDraft && <Badge tone="neutral">Draft</Badge>}
        <details className="relative ml-auto shrink-0">
          <summary className="cursor-pointer list-none rounded border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-accent hover:text-text">
            Detalles
          </summary>
          <div className="absolute right-0 z-20 mt-1 flex w-72 flex-col gap-2 rounded-md border border-border bg-panel p-3 shadow-xl">
            {meta}
            {labels}
          </div>
        </details>
      </header>
    )
  }

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-base font-semibold text-text">
          {pr.title} <span className="font-normal text-muted">#{pr.number}</span>
        </h1>
        {pr.isDraft && <Badge tone="neutral">Draft</Badge>}
      </div>

      {meta}
      {labels}
    </header>
  )
}
