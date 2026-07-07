import type { ReactNode } from 'react'

type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-border/60 text-muted',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
}

interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  icon?: ReactNode
}

export function Badge({ children, tone = 'neutral', icon }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses[tone]}`}
    >
      {icon}
      {children}
    </span>
  )
}
