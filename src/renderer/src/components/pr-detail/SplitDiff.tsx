import { Fragment, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { CommentThread } from '../../../../shared/types'
import { buildSplitRows, type DiffHunk, type DiffLineKind, type SplitRow } from '../../lib/diff-parser'
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

/**
 * Vista split (dos columnas old/new) de todos los hunks de un archivo en un
 * único grid CSS: así las columnas de gutter comparten su ancho entre hunks
 * y no se desalinean (ver T18).
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

  return (
    <div
      className="grid font-mono text-xs leading-5"
      style={{
        gridTemplateColumns: wordWrap
          ? 'max-content minmax(0, 1fr) max-content minmax(0, 1fr)'
          : 'max-content minmax(max-content, 1fr) max-content minmax(max-content, 1fr)',
      }}
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
            const rowKey = `${h}:${i}`
            const leftBg = row.left ? (KIND_BG[row.left.kind] ?? '') : ''
            const rightBg = row.right ? (KIND_BG[row.right.kind] ?? '') : ''
            const contentClass = wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'

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
            const canAddLeft = Boolean(leftPosition) && !leftThread
            const canAddRight = Boolean(rightPosition) && !rightThread

            const expandedThread =
              leftThread?.id === expandedThreadId
                ? leftThread
                : rightThread?.id === expandedThreadId
                  ? rightThread
                  : undefined
            const composerHere = openComposer?.key === rowKey ? openComposer : null

            return (
              <Fragment key={rowKey}>
                {/* `contents` saca el wrapper del layout de grid (sus hijos pasan a ser
                    los items de grid directamente) pero conserva el ancestro en el DOM,
                    que es lo único que necesita `group-hover` para funcionar entre el
                    gutter y el contenido de la fila (son celdas hermanas, no anidadas). */}
                <div className="group/row contents">
                  <span
                    className={`flex items-center justify-end gap-1 px-2 text-muted/70 ${leftBg}`}
                  >
                    {leftThread ? (
                      <LineThreadIndicator
                        active={leftThread.id === expandedThreadId}
                        count={leftThread.comments.length}
                        onClick={() => onToggleExpand(leftThread.id)}
                      />
                    ) : canAddLeft && leftPosition ? (
                      <button
                        type="button"
                        onClick={() => setOpenComposer({ key: rowKey, ...leftPosition })}
                        aria-label="Agregar comentario en esta línea"
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-accent group-hover/row:opacity-100"
                      >
                        <Plus size={12} />
                      </button>
                    ) : (
                      <span className="inline-block h-4 w-4 shrink-0" />
                    )}
                    <span className="select-none">{row.left?.number ?? ''}</span>
                  </span>
                  <span className={`px-2 ${contentClass} ${leftBg} text-text`}>
                    {row.left && (
                      <DiffLineContent
                        content={row.left.content}
                        tokens={getTokens(row.left.content)}
                      />
                    )}
                  </span>
                  <span
                    className={`flex items-center justify-end gap-1 px-2 text-muted/70 ${rightBg}`}
                  >
                    {rightThread ? (
                      <LineThreadIndicator
                        active={rightThread.id === expandedThreadId}
                        count={rightThread.comments.length}
                        onClick={() => onToggleExpand(rightThread.id)}
                      />
                    ) : canAddRight && rightPosition ? (
                      <button
                        type="button"
                        onClick={() => setOpenComposer({ key: rowKey, ...rightPosition })}
                        aria-label="Agregar comentario en esta línea"
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-accent group-hover/row:opacity-100"
                      >
                        <Plus size={12} />
                      </button>
                    ) : (
                      <span className="inline-block h-4 w-4 shrink-0" />
                    )}
                    <span className="select-none">{row.right?.number ?? ''}</span>
                  </span>
                  <span className={`px-2 ${contentClass} ${rightBg} text-text`}>
                    {row.right && (
                      <DiffLineContent
                        content={row.right.content}
                        tokens={getTokens(row.right.content)}
                      />
                    )}
                  </span>
                </div>

                {expandedThread && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <InlineThreadCard
                      thread={expandedThread}
                      onReply={onReply}
                      onClose={() => onToggleExpand(expandedThread.id)}
                    />
                  </div>
                )}
                {composerHere && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <LineCommentComposer
                      onCancel={() => setOpenComposer(null)}
                      onSubmit={async (bodyMarkdown) => {
                        await onCreateThread(composerHere.line, composerHere.side, bodyMarkdown)
                        setOpenComposer(null)
                      }}
                    />
                  </div>
                )}
              </Fragment>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}
