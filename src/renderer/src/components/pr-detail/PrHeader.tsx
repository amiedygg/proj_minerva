import { GitBranch } from 'lucide-react'
import type { PullRequestDetail } from '../../../../shared/types'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'

interface PrHeaderProps {
  pr: PullRequestDetail
}

export function PrHeader({ pr }: PrHeaderProps): React.JSX.Element {
  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-base font-semibold text-text">
          {pr.title} <span className="font-normal text-muted">#{pr.number}</span>
        </h1>
        {pr.isDraft && <Badge tone="neutral">Draft</Badge>}
      </div>

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

      {pr.labels.length > 0 && (
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
      )}
    </header>
  )
}
