import { ArrowRightLeft, FileDiff, FileMinus2, FilePlus2 } from 'lucide-react'
import type { DiffFileStatus } from '../../../../shared/types'

interface FileStatusIconProps {
  status: DiffFileStatus
  size?: number
}

/** Icono de status por archivo: A verde, M amarillo, D rojo, R azul. */
export function FileStatusIcon({ status, size = 14 }: FileStatusIconProps): React.JSX.Element {
  switch (status) {
    case 'added':
      return <FilePlus2 size={size} className="shrink-0 text-success" aria-label="Añadido" />
    case 'removed':
      return <FileMinus2 size={size} className="shrink-0 text-danger" aria-label="Eliminado" />
    case 'renamed':
      return (
        <ArrowRightLeft size={size} className="shrink-0 text-blue-400" aria-label="Renombrado" />
      )
    default:
      return <FileDiff size={size} className="shrink-0 text-warning" aria-label="Modificado" />
  }
}
