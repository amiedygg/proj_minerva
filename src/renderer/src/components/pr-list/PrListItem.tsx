import { GitPullRequest, GitPullRequestDraft } from 'lucide-react'
import type { PullRequestSummary, ReviewDecision } from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'
import { Avatar } from '../ui/Avatar'
import { CiStatusIcon } from '../ui/CiStatusIcon'

interface PrListItemProps {
  pr: PullRequestSummary
}

function reviewDecisionTone(decision: ReviewDecision): string {
  switch (decision) {
    case 'approved':
      return 'bg-success'
    case 'changes_requested':
      return 'bg-danger'
    case 'review_required':
      return 'bg-warning'
    default:
      return ''
  }
}

function reviewDecisionLabel(decision: ReviewDecision): string {
  switch (decision) {
    case 'approved':
      return 'Aprobado'
    case 'changes_requested':
      return 'Cambios solicitados'
    case 'review_required':
      return 'Revisión pendiente'
    default:
      return ''
  }
}

export function PrListItem({ pr }: PrListItemProps): React.JSX.Element {
  const selectedPrId = useAppStore((s) => s.selectedPr?.id ?? null)
  const selectPr = useAppStore((s) => s.selectPr)
  const isSelected = selectedPrId === pr.id

  return (
    <button
      type="button"
      onClick={() => selectPr(pr)}
      aria-pressed={isSelected}
      className={`flex w-full flex-col gap-1.5 border-l-2 px-3 py-2 text-left transition-colors duration-150 ${
        isSelected ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg/60'
      }`}
    >
      <div className="flex items-start gap-1.5">
        {pr.isDraft ? (
          <GitPullRequestDraft
            size={14}
            className="mt-0.5 shrink-0 text-muted"
            aria-label="Draft"
          />
        ) : (
          <GitPullRequest size={14} className="mt-0.5 shrink-0 text-accent" aria-label="Abierto" />
        )}
        <span className="line-clamp-2 text-sm leading-snug text-text">{pr.title}</span>
      </div>
      <div className="flex items-center gap-2 pl-[20px] text-xs text-muted">
        <Avatar user={pr.author} size={16} />
        <span>#{pr.number}</span>
        <CiStatusIcon status={pr.ciStatus} size={12} />
        {pr.reviewDecision && (
          <span
            className={`h-1.5 w-1.5 rounded-full ${reviewDecisionTone(pr.reviewDecision)}`}
            title={reviewDecisionLabel(pr.reviewDecision)}
          />
        )}
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px]">
          <span className="text-success">+{pr.additions}</span>
          <span className="text-danger">-{pr.deletions}</span>
        </span>
      </div>
    </button>
  )
}
