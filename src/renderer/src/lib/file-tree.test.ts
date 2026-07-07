import { describe, expect, it } from 'vitest'
import { buildFileTree, type FileTreeFolderNode } from './file-tree'
import type { DiffFile } from '../../../shared/types'

function file(path: string, overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path,
    status: 'modified',
    additions: 1,
    deletions: 1,
    isBinary: false,
    ...overrides,
  }
}

describe('buildFileTree', () => {
  it('keeps flat files at the root when there are no shared folders', () => {
    const tree = buildFileTree([file('a.ts'), file('b.ts')])
    expect(tree).toEqual([
      { type: 'file', path: 'a.ts', file: file('a.ts') },
      { type: 'file', path: 'b.ts', file: file('b.ts') },
    ])
  })

  it('groups nested paths sharing a folder prefix under a single folder node', () => {
    const tree = buildFileTree([
      file('src/routes/carts.ts'),
      file('src/routes/orders.ts'),
      file('src/app.ts'),
    ])

    // Un solo nodo raíz ('src'): todos los paths comparten ese prefijo.
    expect(tree).toHaveLength(1)
    const folder = tree[0] as FileTreeFolderNode
    expect(folder.type).toBe('folder')
    expect(folder.name).toBe('src')
    expect(folder.path).toBe('src')

    // Carpetas antes que archivos: 'routes' antes que 'app.ts'.
    expect(folder.children.map((c) => c.path)).toEqual(['src/routes', 'src/app.ts'])

    const routesFolder = folder.children[0] as FileTreeFolderNode
    expect(routesFolder.children.map((c) => c.path)).toEqual([
      'src/routes/carts.ts',
      'src/routes/orders.ts',
    ])
  })

  it('places a single root file alongside a folder, folders first', () => {
    const tree = buildFileTree([file('z-top-level.ts'), file('a/nested.ts')])
    expect(tree.map((n) => n.type)).toEqual(['folder', 'file'])
    expect(tree[0].path).toBe('a')
    expect(tree[1].path).toBe('z-top-level.ts')
  })

  it('returns an empty tree for an empty file list', () => {
    expect(buildFileTree([])).toEqual([])
  })
})
