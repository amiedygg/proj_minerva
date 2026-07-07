import { AlignJustify, Columns2, WrapText } from 'lucide-react'
import type { DiffFile } from '../../../../shared/types'
import type { DiffViewMode } from '../../stores/app-store'
import { IconButton } from '../ui/IconButton'

interface DiffToolbarProps {
  file: DiffFile
  mode: DiffViewMode
  onModeChange: (mode: DiffViewMode) => void
  wordWrap: boolean
  onToggleWordWrap: () => void
}

/** Barra superior del panel de diff: path del archivo, toggles de vista y conteo +/-. */
export function DiffToolbar({
  file,
  mode,
  onModeChange,
  wordWrap,
  onToggleWordWrap,
}: DiffToolbarProps): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-text">
        {file.status === 'renamed' && file.previousPath ? (
          <>
            <span className="text-muted line-through">{file.previousPath}</span>
            <span className="text-muted"> → </span>
            {file.path}
          </>
        ) : (
          file.path
        )}
      </span>

      <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs">
        <span className="text-success">+{file.additions}</span>
        <span className="text-danger">-{file.deletions}</span>
      </span>

      <div className="flex shrink-0 gap-0.5 border-l border-border pl-2">
        <IconButton
          icon={<Columns2 size={15} />}
          label="Vista split"
          active={mode === 'split'}
          onClick={() => onModeChange('split')}
        />
        <IconButton
          icon={<AlignJustify size={15} />}
          label="Vista inline"
          active={mode === 'inline'}
          onClick={() => onModeChange('inline')}
        />
        <IconButton
          icon={<WrapText size={15} />}
          label="Word wrap"
          active={wordWrap}
          onClick={onToggleWordWrap}
        />
      </div>
    </div>
  )
}
