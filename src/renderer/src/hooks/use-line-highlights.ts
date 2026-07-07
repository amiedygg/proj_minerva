import { useCallback, useEffect, useState } from 'react'
import { parsePatch } from '../lib/diff-parser'
import { highlightLine, inferLanguage, type HighlightToken } from '../lib/highlighter'

interface UseLineHighlightsResult {
  /** Tokens de color para una línea de contenido dado, si ya se resaltó. */
  getTokens: (content: string) => HighlightToken[] | undefined
}

/**
 * Resalta con Shiki todas las líneas únicas del patch de un archivo, de forma
 * asíncrona y memoizada por `(path, patch)`: cambiar entre split/inline no
 * dispara un nuevo resaltado porque esos toggles no tocan estas dependencias.
 *
 * Se renderiza primero sin colores (`getTokens` devuelve `undefined`, el
 * llamador cae a texto plano) y se aplican los tokens cuando el highlighter
 * termina, sin bloquear el render inicial del diff.
 *
 * Nota: no se resetea `tokensByLine` a mano dentro del efecto (eso dispararía
 * un `setState` síncrono en el cuerpo del efecto, que React desaconseja por
 * el doble render que provoca). En vez de eso, el llamador (`DiffView`) monta
 * este hook con `key={file.path}`, así que un cambio de archivo remonta el
 * hook entero y el estado arranca limpio por diseño de React.
 */
export function useLineHighlights(
  path: string,
  patch: string | undefined,
): UseLineHighlightsResult {
  const [tokensByLine, setTokensByLine] = useState<Map<string, HighlightToken[]>>(new Map())

  useEffect(() => {
    let cancelled = false

    const lang = inferLanguage(path)
    if (!lang || !patch) return

    const uniqueLines = new Set<string>()
    for (const hunk of parsePatch(patch)) {
      for (const line of hunk.lines) uniqueLines.add(line.content)
    }

    void (async () => {
      const entries = await Promise.all(
        [...uniqueLines].map(
          async (content) => [content, await highlightLine(content, lang)] as const,
        ),
      )
      if (!cancelled) setTokensByLine(new Map(entries))
    })()

    return () => {
      cancelled = true
    }
  }, [path, patch])

  const getTokens = useCallback((content: string) => tokensByLine.get(content), [tokensByLine])

  return { getTokens }
}
