import { useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Building2,
  Database,
  Globe,
  Loader2,
  RefreshCw,
  Rocket,
} from 'lucide-react'
import { useDidacticAnalysis } from '../../hooks/use-didactic-analysis'
import { isAnalysisStale } from '../../lib/staleness'
import { DidacticSectionCard } from './DidacticSectionCard'
import { Markdown } from '../ui/Markdown'
import { MermaidDiagram } from './MermaidDiagram'
import { CodeSnippet } from './CodeSnippet'
import { DidacticPlaceholder } from './DidacticPlaceholder'
import { ActiveModelHint } from './ActiveModelHint'
import { ExpandableResource } from './ExpandableResource'
import { ResourceViewer, type ViewerResource } from './ResourceViewer'
import type { DidacticSection, RepoRef } from '../../../../shared/types'
import type { DraftDidacticSection } from '../../../../shared/events'

const SECTION_META: Record<DidacticSection['kind'], { title: string; icon: React.JSX.Element }> = {
  summary: { title: 'Resumen', icon: <BookOpen size={16} /> },
  setup: { title: 'Cómo levantar la app', icon: <Rocket size={16} /> },
  architecture: { title: 'Arquitectura', icon: <Building2 size={16} /> },
  endpoint: { title: 'Endpoint', icon: <Globe size={16} /> },
  schema: { title: 'Esquema', icon: <Database size={16} /> },
}

/** Cursor sutil que marca "esta sección todavía está recibiendo texto" (T13). */
function StreamingCursor(): React.JSX.Element {
  return (
    <span aria-hidden className="inline-block animate-pulse text-sm leading-none text-accent">
      ▍
    </span>
  )
}

function renderSection(
  section: DidacticSection,
  key: number,
  onExpand: (resource: ViewerResource) => void,
): React.JSX.Element {
  const meta = SECTION_META[section.kind]

  return (
    <DidacticSectionCard
      key={key}
      icon={meta.icon}
      title={meta.title}
      onExpandMarkdown={() =>
        onExpand({
          kind: 'markdown',
          title: meta.title + ' — vista amplia',
          markdown: section.markdown,
        })
      }
    >
      <Markdown content={section.markdown} />
      {(section.kind === 'architecture' || section.kind === 'schema') && (
        <ExpandableResource
          label="Expandir diagrama"
          onExpand={() => onExpand({ kind: 'mermaid', title: meta.title, code: section.mermaid })}
        >
          <MermaidDiagram key={section.mermaid} code={section.mermaid} />
        </ExpandableResource>
      )}
      {(section.kind === 'endpoint' || section.kind === 'setup') &&
        section.snippets.map((snippet, i) => (
          <CodeSnippet
            key={i}
            snippet={snippet}
            onExpand={() => onExpand({ kind: 'snippet', title: snippet.label, snippet })}
          />
        ))}
    </DidacticSectionCard>
  )
}

/**
 * Variante de `renderSection` para un snapshot EN VIVO de streaming (T13):
 * `section` es `DraftDidacticSection` (`../../../../shared/events.ts`), no
 * `DidacticSection` — a diferencia del tipo final, el Mermaid de una
 * `architecture`/`schema` es OPCIONAL: solo se pinta si ya cerró
 * (`section.mermaid` presente). Mientras el bloque `@@@MERMAID` sigue
 * abierto, el campo directamente no existe, así que nunca hay riesgo de
 * montar `MermaidDiagram` con un DSL a medio escribir. La sección todavía
 * abierta (`section.streaming`) muestra el cursor parpadeante.
 */
function renderDraftSection(
  section: DraftDidacticSection,
  key: number,
  onExpand: (resource: ViewerResource) => void,
): React.JSX.Element {
  const meta = SECTION_META[section.kind]

  return (
    <DidacticSectionCard
      key={key}
      icon={meta.icon}
      title={meta.title}
      onExpandMarkdown={() =>
        onExpand({
          kind: 'markdown',
          title: meta.title + ' — vista amplia',
          markdown: section.markdown,
        })
      }
    >
      <Markdown content={section.markdown} />
      {section.streaming && <StreamingCursor />}
      {(section.kind === 'architecture' || section.kind === 'schema') && section.mermaid && (
        <ExpandableResource
          label="Expandir diagrama"
          onExpand={() => {
            if (section.mermaid)
              onExpand({ kind: 'mermaid', title: meta.title, code: section.mermaid })
          }}
        >
          <MermaidDiagram key={section.mermaid} code={section.mermaid} />
        </ExpandableResource>
      )}
      {(section.kind === 'endpoint' || section.kind === 'setup') &&
        section.snippets.map((snippet, i) => (
          <CodeSnippet
            key={i}
            snippet={snippet}
            onExpand={() => onExpand({ kind: 'snippet', title: snippet.label, snippet })}
          />
        ))}
    </DidacticSectionCard>
  )
}

interface DidacticAnalysisAreaProps {
  repo: RepoRef
  number: number
  /**
   * SHA ACTUAL del head del PR (T42, Issue 2), para comparar contra el
   * `analysis.headSha` sellado al generar (`isAnalysisStale`, en
   * `../../lib/staleness.ts`) y avisar si el PR recibió commits nuevos.
   * `DidacticPanel` lo pasa directo desde `selectedPr.headSha` (ya lo tiene
   * del summary); la ventana desacoplada no tiene ese summary, así que lo
   * consigue con el hook `use-pr-head-sha` (fetch único al montar). `undefined`
   * mientras no se sepa aún — la barra simplemente no aparece hasta entonces.
   */
  currentHeadSha?: string
}

/**
 * Cuerpo del panel didáctico para un PR concreto. `DidacticPanel` monta esto
 * con `key={selectedPr.id}`: cambiar de PR remonta el componente entero, lo
 * que resetea `useDidacticAnalysis` a su estado inicial de forma natural (el
 * patrón que React recomienda para "resetear todo el estado de una entidad",
 * en vez de un efecto o un ref comparando el PR anterior).
 *
 * T13 (streaming): el orden de precedencia entre estados es, de mayor a
 * menor prioridad: `error` (incluso con contenido parcial viejo de un intento
 * fallido) > `analysis` (resultado final) > `streamingSections` (snapshot en
 * vivo, ya con al menos un chunk) > `checkingCache`/`loading` (skeleton, SOLO
 * hasta que llega el primer chunk — una vez `streamingSections` deja de ser
 * `null`, esa rama gana aunque `loading` siga en `true`) > placeholder inicial.
 *
 * T14: el toolbar (hint del modelo activo + botón "Re-analizar") se muestra
 * junto al contenido en cuanto hay un resultado que mostrar (`analysis` o
 * `streamingSections`) — no en el header estático del panel (`DidacticPanel`),
 * porque ninguno de los dos tiene sentido antes de que exista un análisis
 * para ESTE PR. El visor de recursos (`ResourceViewer`) es estado LOCAL de
 * este componente (`viewerResource`): cada ventana que lo monta (panel
 * principal, ventana desacoplada) tiene el suyo propio, sin compartir nada.
 *
 * T22: `useDidacticAnalysis` ya no necesita que esta superficie le diga si
 * debe mirar el cache al montar — el hook siempre hace "auto-attach" (ver su
 * comentario de cabecera), así que este componente se comporta igual en el
 * panel acoplado y en la ventana desacoplada sin ninguna prop extra.
 */
export function DidacticAnalysisArea({
  repo,
  number,
  currentHeadSha,
}: DidacticAnalysisAreaProps): React.JSX.Element {
  const { analysis, streamingSections, checkingCache, loading, error, analyze, reanalyze } =
    useDidacticAnalysis({ repo, number })
  const [viewerResource, setViewerResource] = useState<ViewerResource | null>(null)

  const hasResult = analysis !== null || streamingSections !== null
  // Derivado en render (no estado): reacciona solo cuando `analysis` o
  // `currentHeadSha` cambian, sin efectos que "resetear" (T42, ver
  // comentario de la prop `currentHeadSha` arriba).
  const isStale = isAnalysisStale(analysis, currentHeadSha)

  let body: React.JSX.Element
  if (error) {
    body = (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
        <p className="mb-2 text-danger">No se pudo analizar el PR: {error}</p>
        <button
          type="button"
          onClick={analyze}
          className="rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/15"
        >
          Reintentar
        </button>
      </div>
    )
  } else if (analysis) {
    body = (
      <>{analysis.sections.map((section, i) => renderSection(section, i, setViewerResource))}</>
    )
  } else if (streamingSections) {
    body = (
      <>
        {streamingSections.map((section, i) => renderDraftSection(section, i, setViewerResource))}
      </>
    )
  } else if (checkingCache || loading) {
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin text-accent" />
          {checkingCache ? 'Buscando un análisis ya hecho…' : 'Analizando PR con IA…'}
        </div>
        <div className="h-20 animate-pulse rounded-md border border-border bg-border/20" />
        <div className="h-32 animate-pulse rounded-md border border-border bg-border/20" />
      </div>
    )
  } else {
    body = <DidacticPlaceholder onAnalyze={analyze} />
  }

  return (
    <>
      {hasResult && !error && (
        <div className="flex items-center justify-between gap-2">
          <ActiveModelHint generatedWith={analysis?.generatedWith} />
          <button
            type="button"
            onClick={reanalyze}
            disabled={loading}
            title="Descarta el análisis cacheado y vuelve a pedirlo (útil tras cambiar de modelo en Settings)"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-border/60 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} />
            Re-analizar
          </button>
        </div>
      )}
      {isStale && analysis && currentHeadSha && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
          <span className="flex items-center gap-2 text-warning">
            <AlertTriangle size={14} className="shrink-0" />
            Este PR recibió commits nuevos desde que se generó este resumen (
            {analysis.headSha.slice(0, 7)} → {currentHeadSha.slice(0, 7)}).
          </span>
          <button
            type="button"
            onClick={reanalyze}
            disabled={loading}
            className="shrink-0 rounded-md border border-warning/40 px-2 py-1 font-medium text-warning transition-colors hover:bg-warning/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Actualizar
          </button>
        </div>
      )}
      {body}
      {viewerResource && (
        <ResourceViewer resource={viewerResource} onClose={() => setViewerResource(null)} />
      )}
    </>
  )
}
