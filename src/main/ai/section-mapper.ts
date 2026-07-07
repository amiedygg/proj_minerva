/**
 * Valida y mapea la forma cruda de una sección (ya trozeada, ya sea desde el
 * parser incremental de streaming — `./stream-parser.ts`, T13 — o desde
 * cualquier otra fuente) a `DidacticSection` (`src/shared/types.ts`).
 *
 * Hasta T13 este módulo también validaba la respuesta COMPLETA como un único
 * JSON (`mapSections`, `{ sections: [...] }`); ese pipeline quedó obsoleto al
 * cambiar el protocolo del modelo de JSON a texto tagged por líneas (ver
 * `./prompts/analyze-pr.ts` y `./stream-parser.ts`), así que se eliminó junto
 * con `./json-extract.ts` (que solo servía para extraer ese JSON de la
 * respuesta). `mapRawSection`/`mapSnippet` sí se conservan y se reutilizan
 * desde `StreamSectionParser.finalize()` — son la fuente única de verdad de
 * "qué es una sección/snippet válido", sin importar de dónde venga la forma
 * cruda a validar.
 *
 * El modelo es una fuente no confiable de *estructura*, no solo de contenido:
 * puede omitir campos, mandar un `kind` que no existe, o un tipo de dato
 * distinto al esperado. Cada sección se valida de forma independiente; una
 * sección malformada se descarta en vez de tirar abajo todo el análisis.
 */
import type { DidacticSection, DidacticSnippet } from '../../shared/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Exportado: `StreamSectionParser` lo reutiliza para validar cada snippet al cerrar su `@@@END_SNIPPET`. */
export function mapSnippet(raw: unknown): DidacticSnippet | null {
  if (!isRecord(raw)) return null
  if (!isNonEmptyString(raw.label)) return null
  if (
    raw.language !== 'curl' &&
    raw.language !== 'http' &&
    raw.language !== 'bash' &&
    raw.language !== 'env'
  )
    return null
  if (!isNonEmptyString(raw.code)) return null
  return { label: raw.label, language: raw.language, code: raw.code }
}

/** Mapea una sección cruda; `null` si no matchea ninguna forma válida de `DidacticSection`. */
export function mapRawSection(raw: unknown): DidacticSection | null {
  if (!isRecord(raw)) return null
  if (!isNonEmptyString(raw.markdown)) return null

  switch (raw.kind) {
    case 'summary':
      return { kind: 'summary', markdown: raw.markdown }

    case 'architecture':
      if (!isNonEmptyString(raw.mermaid)) return null
      return { kind: 'architecture', markdown: raw.markdown, mermaid: raw.mermaid }

    case 'schema':
      if (!isNonEmptyString(raw.mermaid)) return null
      return { kind: 'schema', markdown: raw.markdown, mermaid: raw.mermaid }

    case 'endpoint': {
      if (!Array.isArray(raw.snippets)) return null
      const snippets = raw.snippets
        .map(mapSnippet)
        .filter((s): s is DidacticSnippet => s !== null)
      return { kind: 'endpoint', markdown: raw.markdown, snippets }
    }

    case 'setup': {
      if (!Array.isArray(raw.snippets)) return null
      const snippets = raw.snippets
        .map(mapSnippet)
        .filter((s): s is DidacticSnippet => s !== null)
      return { kind: 'setup', markdown: raw.markdown, snippets }
    }

    default:
      return null
  }
}

