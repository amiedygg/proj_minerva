/**
 * Parser de unified diff (patches tal como los devuelve GitHub para un
 * `DiffFile.patch`). Puro y sin dependencias: nada de librerías de diff, el
 * formato es lo bastante simple como para controlarlo a mano.
 *
 * Formato esperado por hunk:
 *   @@ -oldStart,oldLines +newStart,newLines @@ texto de contexto opcional
 *    línea de contexto (empieza con un espacio)
 *   -línea eliminada
 *   +línea agregada
 *   \ No newline at end of file   (se ignora con gracia)
 */

export type DiffLineKind = 'context' | 'add' | 'del'

export interface DiffLine {
  kind: DiffLineKind
  /** Número de línea en el archivo viejo; ausente en líneas `add`. */
  oldNumber?: number
  /** Número de línea en el archivo nuevo; ausente en líneas `del`. */
  newNumber?: number
  content: string
}

export interface DiffHunk {
  /** Línea `@@ ... @@` completa, incluyendo el texto de contexto final si lo hay. */
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))?\s\+(\d+)(?:,(\d+))?\s@@(.*)$/

/** Parsea un patch unified diff completo (puede tener varios hunks) en `DiffHunk[]`. */
export function parsePatch(patch: string): DiffHunk[] {
  if (!patch || !patch.trim()) return []

  // Un único trailing `\n` es un artefacto de cómo se guardó el patch, no una
  // línea de contexto en blanco real (esas van prefijadas con un espacio).
  const text = patch.endsWith('\n') ? patch.slice(0, -1) : patch
  const rawLines = text.split('\n')

  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldNumber = 0
  let newNumber = 0

  for (const raw of rawLines) {
    const headerMatch = HUNK_HEADER_RE.exec(raw)
    if (headerMatch) {
      const oldStart = Number(headerMatch[1])
      const oldLines = headerMatch[2] !== undefined ? Number(headerMatch[2]) : 1
      const newStart = Number(headerMatch[3])
      const newLines = headerMatch[4] !== undefined ? Number(headerMatch[4]) : 1
      current = { header: raw, oldStart, oldLines, newStart, newLines, lines: [] }
      hunks.push(current)
      oldNumber = oldStart
      newNumber = newStart
      continue
    }

    if (!current) {
      // Texto antes del primer hunk (p. ej. `diff --git ...`, `---`/`+++`) no
      // debería llegar aquí porque `DiffFile.patch` ya viene sin esos
      // encabezados, pero por robustez lo ignoramos en vez de tirar.
      continue
    }

    if (raw.startsWith('\\')) {
      // "\ No newline at end of file" — se ignora con gracia, no representa contenido.
      continue
    }

    if (raw.startsWith('+')) {
      current.lines.push({ kind: 'add', newNumber, content: raw.slice(1) })
      newNumber++
      continue
    }

    if (raw.startsWith('-')) {
      current.lines.push({ kind: 'del', oldNumber, content: raw.slice(1) })
      oldNumber++
      continue
    }

    // Línea de contexto: normalmente prefijada con un espacio; una línea en
    // blanco real dentro de un hunk también puede llegar como cadena vacía.
    const content = raw.startsWith(' ') ? raw.slice(1) : raw
    current.lines.push({ kind: 'context', oldNumber, newNumber, content })
    oldNumber++
    newNumber++
  }

  return hunks
}

export interface SplitCell {
  number: number
  content: string
  kind: DiffLineKind
}

export interface SplitRow {
  left?: SplitCell
  right?: SplitCell
}

/**
 * Arma las filas de la vista split (dos columnas old/new) a partir de los
 * hunks. Reglas de emparejamiento dentro de cada hunk:
 * - Las líneas de contexto van a ambos lados con el mismo contenido.
 * - Un bloque de deleciones seguido de un bloque de adiciones se empareja
 *   línea a línea (índice a índice); el lado que se queda sin línea
 *   correspondiente queda vacío (`undefined`).
 */
export function buildSplitRows(hunks: DiffHunk[]): SplitRow[] {
  const rows: SplitRow[] = []

  for (const hunk of hunks) {
    const lines = hunk.lines
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      if (line.kind === 'context') {
        rows.push({
          left: { number: line.oldNumber ?? 0, content: line.content, kind: 'context' },
          right: { number: line.newNumber ?? 0, content: line.content, kind: 'context' },
        })
        i++
        continue
      }

      const dels: DiffLine[] = []
      while (i < lines.length && lines[i].kind === 'del') {
        dels.push(lines[i])
        i++
      }
      const adds: DiffLine[] = []
      while (i < lines.length && lines[i].kind === 'add') {
        adds.push(lines[i])
        i++
      }

      const pairs = Math.max(dels.length, adds.length)
      for (let j = 0; j < pairs; j++) {
        const del = dels[j]
        const add = adds[j]
        rows.push({
          left: del ? { number: del.oldNumber ?? 0, content: del.content, kind: 'del' } : undefined,
          right: add
            ? { number: add.newNumber ?? 0, content: add.content, kind: 'add' }
            : undefined,
        })
      }

      // No debería pasar (todo `DiffLine` es context/del/add), pero evita un
      // loop infinito si alguna vez aparece un kind inesperado.
      if (dels.length === 0 && adds.length === 0) i++
    }
  }

  return rows
}

export interface InlineRow {
  kind: DiffLineKind
  oldNumber?: number
  newNumber?: number
  content: string
}

/** Arma las filas de la vista inline: orden natural del patch, una columna. */
export function buildInlineRows(hunks: DiffHunk[]): InlineRow[] {
  const rows: InlineRow[] = []
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      rows.push({
        kind: line.kind,
        oldNumber: line.oldNumber,
        newNumber: line.newNumber,
        content: line.content,
      })
    }
  }
  return rows
}
