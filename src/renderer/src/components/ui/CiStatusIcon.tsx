import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react'
import type { CiStatus } from '../../../../shared/types'

interface CiStatusIconProps {
  status: CiStatus
  size?: number
}

/** Icono de estado de CI: verde/rojo/ámbar, o nada si aún no hay chequeos. */
export function CiStatusIcon({ status, size = 14 }: CiStatusIconProps): React.JSX.Element | null {
  if (status === 'success') {
    return <CheckCircle2 size={size} className="shrink-0 text-success" aria-label="CI en verde" />
  }
  if (status === 'failure') {
    return <XCircle size={size} className="shrink-0 text-danger" aria-label="CI en rojo" />
  }
  if (status === 'pending') {
    return <CircleDashed size={size} className="shrink-0 text-warning" aria-label="CI pendiente" />
  }
  return null
}
