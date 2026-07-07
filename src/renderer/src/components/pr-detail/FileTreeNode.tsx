import { ChevronDown, ChevronRight } from 'lucide-react'
import type { FileTreeNode as FileTreeNodeModel } from '../../lib/file-tree'
import { FileStatusIcon } from './FileStatusIcon'

interface FileTreeNodeProps {
  node: FileTreeNodeModel
  depth: number
  selectedPath: string | null
  collapsedFolders: ReadonlySet<string>
  onSelectFile: (path: string) => void
  onToggleFolder: (path: string) => void
}

/** Un nodo (carpeta o archivo) del árbol de archivos, renderizado recursivamente. */
export function FileTreeNode({
  node,
  depth,
  selectedPath,
  collapsedFolders,
  onSelectFile,
  onToggleFolder,
}: FileTreeNodeProps): React.JSX.Element {
  const paddingLeft = 8 + depth * 14

  if (node.type === 'folder') {
    const collapsed = collapsedFolders.has(node.path)
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          aria-expanded={!collapsed}
          style={{ paddingLeft }}
          className="flex w-full items-center gap-1 py-1 pr-2 text-left text-sm text-muted hover:text-text"
        >
          {collapsed ? (
            <ChevronRight size={13} className="shrink-0" />
          ) : (
            <ChevronDown size={13} className="shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {!collapsed && (
          <ul>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                collapsedFolders={collapsedFolders}
                onSelectFile={onSelectFile}
                onToggleFolder={onToggleFolder}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const active = node.path === selectedPath
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectFile(node.path)}
        aria-current={active}
        style={{ paddingLeft }}
        className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors duration-100 ${
          active ? 'bg-accent/15 text-text' : 'text-muted hover:bg-border/40 hover:text-text'
        }`}
      >
        <FileStatusIcon status={node.file.status} />
        <span className="truncate font-mono text-xs">{node.file.path.split('/').pop()}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px]">
          <span className="text-success">+{node.file.additions}</span>
          <span className="text-danger">-{node.file.deletions}</span>
        </span>
      </button>
    </li>
  )
}
