import { useEffect } from 'react'
import { usePullRequestFiles } from '../../hooks/use-pull-request-files'
import { useAppStore } from '../../stores/app-store'
import type { CommentThread, RepoRef } from '../../../../shared/types'
import { FileTree } from './FileTree'
import { DiffView } from './DiffView'

interface FilesTabProps {
  repo: RepoRef
  number: number
  /** Hilos de comentarios del PR (T8), pedidos una sola vez en `CenterPane` y compartidos con `ConversationTab`. */
  threads: CommentThread[]
  reloadThreads: () => Promise<CommentThread[]>
}

/**
 * Tab "Archivos": árbol de archivos a la izquierda + diff estilo GitKraken
 * (split/inline, syntax highlighting) a la derecha para el archivo
 * seleccionado. El estado de selección/vista vive en `app-store` (T7).
 */
export function FilesTab({
  repo,
  number,
  threads,
  reloadThreads,
}: FilesTabProps): React.JSX.Element {
  const { files, loading, error } = usePullRequestFiles(repo, number)

  const selectedFilePath = useAppStore((s) => s.selectedFilePath)
  const setSelectedFilePath = useAppStore((s) => s.setSelectedFilePath)
  const fileTreeMode = useAppStore((s) => s.fileTreeMode)
  const setFileTreeMode = useAppStore((s) => s.setFileTreeMode)
  const diffViewMode = useAppStore((s) => s.diffViewMode)
  const setDiffViewMode = useAppStore((s) => s.setDiffViewMode)
  const wordWrap = useAppStore((s) => s.wordWrap)
  const toggleWordWrap = useAppStore((s) => s.toggleWordWrap)

  // Selecciona el primer archivo automáticamente cuando cargan los archivos
  // del PR (o si el seleccionado ya no existe en la lista actual).
  useEffect(() => {
    if (files.length === 0) return
    const stillExists = selectedFilePath && files.some((f) => f.path === selectedFilePath)
    if (!stillExists) setSelectedFilePath(files[0].path)
  }, [files, selectedFilePath, setSelectedFilePath])

  if (error) {
    return <p className="p-4 text-sm text-danger">No se pudieron cargar los archivos: {error}</p>
  }

  if (loading) {
    return <p className="p-4 text-sm text-muted">Cargando archivos…</p>
  }

  if (files.length === 0) {
    return <p className="p-4 text-sm text-muted">Este PR no tiene archivos cambiados.</p>
  }

  const selectedFile = files.find((f) => f.path === selectedFilePath) ?? files[0]

  return (
    <div className="flex h-full min-h-0">
      <FileTree
        files={files}
        mode={fileTreeMode}
        onModeChange={setFileTreeMode}
        selectedPath={selectedFile.path}
        onSelectFile={setSelectedFilePath}
      />
      <DiffView
        key={selectedFile.path}
        file={selectedFile}
        mode={diffViewMode}
        onModeChange={setDiffViewMode}
        wordWrap={wordWrap}
        onToggleWordWrap={toggleWordWrap}
        repo={repo}
        number={number}
        threads={threads}
        reloadThreads={reloadThreads}
      />
    </div>
  )
}
