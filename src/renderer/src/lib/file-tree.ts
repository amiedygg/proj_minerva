/**
 * Construye un árbol de carpetas/archivos a partir de los `path` planos de los
 * `DiffFile` de un PR, para el modo "tree" del árbol de archivos (T7).
 * Puro: no conoce de React ni de estado de colapsado (eso vive en el componente).
 */
import type { DiffFile } from '../../../shared/types'

export interface FileTreeFileNode {
  type: 'file'
  /** Path completo del archivo (clave estable para selección/keys de React). */
  path: string
  file: DiffFile
}

export interface FileTreeFolderNode {
  type: 'folder'
  name: string
  /** Path completo de la carpeta (join de sus segmentos), único dentro del árbol. */
  path: string
  children: FileTreeNode[]
}

export type FileTreeNode = FileTreeFolderNode | FileTreeFileNode

/** Agrupa `files` en un árbol; carpetas ordenadas antes que archivos, ambos alfabéticamente. */
export function buildFileTree(files: DiffFile[]): FileTreeNode[] {
  const root: FileTreeFolderNode = { type: 'folder', name: '', path: '', children: [] }

  for (const file of files) {
    const segments = file.path.split('/')
    let cursor = root

    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      const path = segments.slice(0, i + 1).join('/')
      let next = cursor.children.find(
        (child): child is FileTreeFolderNode => child.type === 'folder' && child.name === segment,
      )
      if (!next) {
        next = { type: 'folder', name: segment, path, children: [] }
        cursor.children.push(next)
      }
      cursor = next
    }

    cursor.children.push({ type: 'file', path: file.path, file })
  }

  sortTree(root.children)
  return root.children
}

function sortTree(nodes: FileTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    const nameA = a.type === 'folder' ? a.name : a.path
    const nameB = b.type === 'folder' ? b.name : b.path
    return nameA.localeCompare(nameB)
  })
  for (const node of nodes) {
    if (node.type === 'folder') sortTree(node.children)
  }
}
