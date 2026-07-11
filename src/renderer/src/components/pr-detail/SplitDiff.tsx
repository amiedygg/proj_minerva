import { Fragment, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { CommentThread } from '../../../../shared/types'
import {
  buildSplitRows,
  type DiffHunk,
  type DiffLineKind,
  type SplitCell,
  type SplitRow,
} from '../../lib/diff-parser'
import type { HighlightToken } from '../../lib/highlighter'
import { lineThreadKey, resolveNewThreadPosition, type LineSide } from '../../lib/line-threads'
import { DiffLineContent } from './DiffLineContent'
import { LineThreadIndicator } from './LineThreadIndicator'
import { InlineThreadCard } from './InlineThreadCard'
import { LineCommentComposer } from './LineCommentComposer'

interface SplitDiffProps {
  hunks: DiffHunk[]
  wordWrap: boolean
  getTokens: (content: string) => HighlightToken[] | undefined
  threadsByPosition: Map<string, CommentThread>
  expandedThreadId: string | null
  onToggleExpand: (threadId: string) => void
  onReply: (threadId: string, bodyMarkdown: string) => Promise<void>
  onCreateThread: (line: number, side: LineSide, bodyMarkdown: string) => Promise<void>
}

const KIND_BG: Partial<Record<DiffLineKind, string>> = {
  add: 'bg-[#1d3a28]',
  del: 'bg-[#3f1d24]',
}

interface OpenComposer {
  key: string
  side: LineSide
  line: number
}

/** Todo lo derivado de una fila que necesitan ambos layouts (wrap y no-wrap). */
interface RowMeta {
  rowKey: string
  row: SplitRow
  leftBg: string
  rightBg: string
  leftThread?: CommentThread
  rightThread?: CommentThread
  canAddLeft: boolean
  canAddRight: boolean
  /** Abre el composer de comentario en la posición del lado correspondiente. */
  onAddLeft?: () => void
  onAddRight?: () => void
  expandedThread?: CommentThread
}

interface SideCellsProps {
  cell?: SplitCell
  bg: string
  contentClass: string
  thread?: CommentThread
  expandedThreadId: string | null
  canAdd: boolean
  onAdd?: () => void
  onToggleExpand: (threadId: string) => void
  getTokens: (content: string) => HighlightToken[] | undefined
}

/**
 * Par gutter+contenido de un lado (old o new) de una fila split. Devuelve un
 * fragment: sus dos hijos pasan a ser celdas hermanas del grid que lo contiene.
 */
function SideCells({
  cell,
  bg,
  contentClass,
  thread,
  expandedThreadId,
  canAdd,
  onAdd,
  onToggleExpand,
  getTokens,
}: SideCellsProps): React.JSX.Element {
  return (
    <>
      <span className={`flex items-center justify-end gap-1 px-2 text-muted/70 ${bg}`}>
        {thread ? (
          <LineThreadIndicator
            active={thread.id === expandedThreadId}
            count={thread.comments.length}
            onClick={() => onToggleExpand(thread.id)}
          />
        ) : canAdd && onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            aria-label="Agregar comentario en esta línea"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-accent group-hover/row:opacity-100"
          >
            <Plus size={12} />
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}
        <span className="select-none">{cell?.number ?? ''}</span>
      </span>
      <span className={`px-2 ${contentClass} ${bg} text-text`}>
        {cell && <DiffLineContent content={cell.content} tokens={getTokens(cell.content)} />}
      </span>
    </>
  )
}

/**
 * Vista split (dos columnas old/new) de todos los hunks de un archivo.
 *
 * Con word wrap: un único grid CSS de 4 columnas — así las columnas de gutter
 * comparten su ancho entre hunks y no se desalinean (ver T18), y el grid nunca
 * excede el contenedor (`minmax(0, 1fr)`).
 *
 * Sin word wrap: dos paneles 50/50, cada uno con scroll horizontal PROPIO
 * (estilo VS Code). Con el grid único, `minmax(max-content, 1fr)` hacía que
 * cada columna de contenido creciera hasta su línea más larga: el grid entero
 * desbordaba el contenedor y el lado nuevo quedaba empujado fuera de la vista
 * (gutter verde visible con contenido "vacío" hasta scrollear, ver T49).
 * La alineación vertical entre paneles sale gratis: sin wrap toda fila mide
 * exactamente una línea (`leading-5`) y ambos paneles renderizan las mismas
 * filas. El ancho del gutter se fija por conteo de dígitos para que no varíe
 * entre paneles ni entre segmentos.
 */
export function SplitDiff({
  hunks,
  wordWrap,
  getTokens,
  threadsByPosition,
  expandedThreadId,
  onToggleExpand,
  onReply,
  onCreateThread,
}: SplitDiffProps): React.JSX.Element {
  const [openComposer, setOpenComposer] = useState<OpenComposer | null>(null)

  const rowsByHunk = useMemo(() => hunks.map((hunk) => buildSplitRows([hunk])), [hunks])

  const gutterDigits = useMemo(() => {
    let max = 1
    for (const rows of rowsByHunk) {
      for (const row of rows) {
        if (row.left) max = Math.max(max, String(row.left.number).length)
        if (row.right) max = Math.max(max, String(row.right.number).length)
      }
    }
    return max
  }, [rowsByHunk])

  function computeRowMeta(h: number, i: number, row: SplitRow): RowMeta {
    const rowKey = `${h}:${i}`
    const leftThread = row.left
      ? threadsByPosition.get(lineThreadKey(row.left.number, 'LEFT'))
      : undefined
    const rightThread = row.right
      ? threadsByPosition.get(lineThreadKey(row.right.number, 'RIGHT'))
      : undefined
    // Comentar sobre una deleción usa la línea vieja (lado LEFT); sobre
    // contexto o adición usa la línea nueva (lado RIGHT) — nunca ambas a
    // la vez para la misma fila. Una celda `left` de una fila de contexto
    // no ofrece "+" (ya lo ofrece la celda `right`, misma línea lógica).
    const leftPosition =
      row.left?.kind === 'del'
        ? resolveNewThreadPosition(true, row.left.number, undefined)
        : undefined
    const rightPosition = row.right
      ? resolveNewThreadPosition(false, undefined, row.right.number)
      : undefined
    const expandedThread =
      leftThread?.id === expandedThreadId
        ? leftThread
        : rightThread?.id === expandedThreadId
          ? rightThread
          : undefined
    return {
      rowKey,
      row,
      leftBg: row.left ? (KIND_BG[row.left.kind] ?? '') : '',
      rightBg: row.right ? (KIND_BG[row.right.kind] ?? '') : '',
      leftThread,
      rightThread,
      canAddLeft: Boolean(leftPosition) && !leftThread,
      canAddRight: Boolean(rightPosition) && !rightThread,
      onAddLeft: leftPosition
        ? () => setOpenComposer({ key: rowKey, ...leftPosition })
        : undefined,
      onAddRight: rightPosition
        ? () => setOpenComposer({ key: rowKey, ...rightPosition })
        : undefined,
      expandedThread,
    }
  }

  /** Card de hilo expandido y/o composer que van a ancho completo tras una fila. */
  function fullWidthBlocks(meta: RowMeta): React.ReactNode[] {
    const blocks: React.ReactNode[] = []
    if (meta.expandedThread) {
      const thread = meta.expandedThread
      blocks.push(
        <InlineThreadCard
          key={`thread-${meta.rowKey}`}
          thread={thread}
          onReply={onReply}
          onClose={() => onToggleExpand(thread.id)}
        />,
      )
    }
    const composerHere = openComposer?.key === meta.rowKey ? openComposer : null
    if (composerHere) {
      blocks.push(
        <LineCommentComposer
          key={`composer-${meta.rowKey}`}
          onCancel={() => setOpenComposer(null)}
          onSubmit={async (bodyMarkdown) => {
            await onCreateThread(composerHere.line, composerHere.side, bodyMarkdown)
            setOpenComposer(null)
          }}
        />,
      )
    }
    return blocks
  }

  if (wordWrap) {
    return (
      <div
        className="grid font-mono text-xs leading-5"
        style={{ gridTemplateColumns: 'max-content minmax(0, 1fr) max-content minmax(0, 1fr)' }}
      >
        {hunks.map((hunk, h) => (
          <Fragment key={h}>
            <div
              style={{ gridColumn: '1 / -1' }}
              className="border-y border-border bg-panel px-3 py-1 font-mono text-[11px] text-muted"
            >
              {hunk.header}
            </div>
            {rowsByHunk[h].map((row: SplitRow, i) => {
              const meta = computeRowMeta(h, i, row)
              const blocks = fullWidthBlocks(meta)
              return (
                <Fragment key={meta.rowKey}>
                  {/* `contents` saca el wrapper del layout de grid (sus hijos pasan a ser
                      los items de grid directamente) pero conserva el ancestro en el DOM,
                      que es lo único que necesita `group-hover` para funcionar entre el
                      gutter y el contenido de la fila (son celdas hermanas, no anidadas). */}
                  <div className="group/row contents">
                    <SideCells
                      cell={row.left}
                      bg={meta.leftBg}
                      contentClass="whitespace-pre-wrap break-words"
                      thread={meta.leftThread}
                      expandedThreadId={expandedThreadId}
                      canAdd={meta.canAddLeft}
                      onAdd={meta.onAddLeft}
                      onToggleExpand={onToggleExpand}
                      getTokens={getTokens}
                    />
                    <SideCells
                      cell={row.right}
                      bg={meta.rightBg}
                      contentClass="whitespace-pre-wrap break-words"
                      thread={meta.rightThread}
                      expandedThreadId={expandedThreadId}
                      canAdd={meta.canAddRight}
                      onAdd={meta.onAddRight}
                      onToggleExpand={onToggleExpand}
                      getTokens={getTokens}
                    />
                  </div>
                  {blocks.map((block, b) => (
                    <div key={b} style={{ gridColumn: '1 / -1' }}>
                      {block}
                    </div>
                  ))}
                </Fragment>
              )
            })}
          </Fragment>
        ))}
      </div>
    )
  }

  // Sin wrap: por cada hunk, segmentos de filas en dos paneles 50/50 con
  // scroll horizontal independiente; las cards/composers (ancho completo)
  // cortan el segmento y se intercalan entre paneles.
  const gutterWidth = `calc(${gutterDigits}ch + 2.25rem)`

  return (
    <div className="font-mono text-xs leading-5">
      {hunks.map((hunk, h) => {
        const segments: Array<{ rows: RowMeta[] } | { block: React.ReactNode }> = []
        let current: RowMeta[] = []
        rowsByHunk[h].forEach((row, i) => {
          const meta = computeRowMeta(h, i, row)
          current.push(meta)
          const blocks = fullWidthBlocks(meta)
          if (blocks.length > 0) {
            segments.push({ rows: current })
            current = []
            for (const block of blocks) segments.push({ block })
          }
        })
        if (current.length > 0) segments.push({ rows: current })

        return (
          <Fragment key={h}>
            <div className="border-y border-border bg-panel px-3 py-1 text-[11px] text-muted">
              {hunk.header}
            </div>
            {segments.map((segment, s) => {
              if ('block' in segment) return <Fragment key={s}>{segment.block}</Fragment>
              return (
                <div key={s} className="grid grid-cols-2">
                  {(['left', 'right'] as const).map((side) => (
                    <div
                      key={side}
                      className={`overflow-x-auto ${side === 'right' ? 'border-l border-border' : ''}`}
                    >
                      <div
                        className="grid w-max min-w-full"
                        style={{
                          gridTemplateColumns: `${gutterWidth} minmax(max-content, 1fr)`,
                        }}
                      >
                        {segment.rows.map((meta) => (
                          <div key={meta.rowKey} className="group/row contents">
                            <SideCells
                              cell={side === 'left' ? meta.row.left : meta.row.right}
                              bg={side === 'left' ? meta.leftBg : meta.rightBg}
                              contentClass="whitespace-pre"
                              thread={side === 'left' ? meta.leftThread : meta.rightThread}
                              expandedThreadId={expandedThreadId}
                              canAdd={side === 'left' ? meta.canAddLeft : meta.canAddRight}
                              onAdd={side === 'left' ? meta.onAddLeft : meta.onAddRight}
                              onToggleExpand={onToggleExpand}
                              getTokens={getTokens}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </Fragment>
        )
      })}
    </div>
  )
}
