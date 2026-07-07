import { Fragment, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { CommentThread } from '../../../../shared/types'
import { buildInlineRows, type DiffHunk, type DiffLineKind, type InlineRow } from '../../lib/diff-parser'
import type { HighlightToken } from '../../lib/highlighter'
import { lineThreadKey, resolveNewThreadPosition, type LineSide } from '../../lib/line-threads'
import { DiffLineContent } from './DiffLineContent'
import { LineThreadIndicator } from './LineThreadIndicator'
import { InlineThreadCard } from './InlineThreadCard'
import { LineCommentComposer } from './LineCommentComposer'

interface InlineDiffProps {
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

const KIND_MARKER: Record<DiffLineKind, string> = {
  context: ' ',
  add: '+',
  del: '-',
}

interface OpenComposer {
  key: string
  side: LineSide
  line: number
}

/**
 * Vista inline (una columna, dos gutters old/new) de todos los hunks de un
 * archivo en un único grid CSS: así las columnas de gutter comparten su
 * ancho entre hunks y no se desalinean (ver T18).
 */
export function InlineDiff({
  hunks,
  wordWrap,
  getTokens,
  threadsByPosition,
  expandedThreadId,
  onToggleExpand,
  onReply,
  onCreateThread,
}: InlineDiffProps): React.JSX.Element {
  const [openComposer, setOpenComposer] = useState<OpenComposer | null>(null)

  const rowsByHunk = useMemo(() => hunks.map((hunk) => buildInlineRows([hunk])), [hunks])

  return (
    <div
      className="grid font-mono text-xs leading-5"
      style={{
        gridTemplateColumns: wordWrap
          ? 'max-content max-content max-content minmax(0, 1fr)'
          : 'max-content max-content max-content minmax(max-content, 1fr)',
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
          {rowsByHunk[h].map((row: InlineRow, i) => {
            const rowKey = `${h}:${i}`
            const bg = KIND_BG[row.kind] ?? ''
            const contentClass = wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'

            // Comentar sobre una deleción usa la línea vieja (lado LEFT); sobre
            // contexto o adición usa la línea nueva (lado RIGHT).
            const position = resolveNewThreadPosition(
              row.kind === 'del',
              row.oldNumber,
              row.newNumber,
            )
            const thread = position
              ? threadsByPosition.get(lineThreadKey(position.line, position.side))
              : undefined
            const canAdd = Boolean(position) && !thread

            const expandedHere = thread?.id === expandedThreadId ? thread : undefined
            const composerHere = openComposer?.key === rowKey ? openComposer : null

            return (
              <Fragment key={rowKey}>
                <div className="group/row contents">
                  <span className={`select-none px-2 text-right text-muted/70 ${bg}`}>
                    {row.oldNumber ?? ''}
                  </span>
                  <span className={`flex items-center gap-1 px-2 text-muted/70 ${bg}`}>
                    {thread ? (
                      <LineThreadIndicator
                        active={thread.id === expandedThreadId}
                        count={thread.comments.length}
                        onClick={() => onToggleExpand(thread.id)}
                      />
                    ) : canAdd && position ? (
                      <button
                        type="button"
                        onClick={() => setOpenComposer({ key: rowKey, ...position })}
                        aria-label="Agregar comentario en esta línea"
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-accent group-hover/row:opacity-100"
                      >
                        <Plus size={12} />
                      </button>
                    ) : (
                      <span className="inline-block h-4 w-4 shrink-0" />
                    )}
                    <span className="select-none">{row.newNumber ?? ''}</span>
                  </span>
                  <span
                    className={`select-none px-1.5 text-center ${bg} ${
                      row.kind === 'add'
                        ? 'text-success'
                        : row.kind === 'del'
                          ? 'text-danger'
                          : 'text-muted'
                    }`}
                  >
                    {KIND_MARKER[row.kind]}
                  </span>
                  <span className={`px-2 ${contentClass} ${bg} text-text`}>
                    <DiffLineContent content={row.content} tokens={getTokens(row.content)} />
                  </span>
                </div>

                {expandedHere && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <InlineThreadCard
                      thread={expandedHere}
                      onReply={onReply}
                      onClose={() => onToggleExpand(expandedHere.id)}
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
