/**
 * Implementación mock de `AiService`. No llama a ningún LLM: sirve fixtures
 * fijas (`./fixtures.ts`), pero SÍ simula streaming real (T13) en vez de
 * resolver todo de una vez, para poder verificar el panel didáctico en vivo
 * (texto fluyendo, diagramas apareciendo al cerrar su bloque) sin necesitar
 * ningún proveedor de IA configurado ni pagar una llamada real.
 *
 * Cómo simula el streaming: serializa el `DidacticSection[]` final de la
 * fixture de vuelta al protocolo de texto tagueado que produciría el modelo
 * (`stringifySections`, inverso de `../stream-parser.ts`), lo trocea en
 * `STREAM_CHUNKS` pedazos y los va empujando a un `StreamSectionParser` real
 * (el MISMO que usan los servicios reales — `providers/opencode-service.ts`,
 * `providers/claude-code-service.ts`, `providers/codex-service.ts`) con
 * `STREAM_CHUNK_DELAY_MS` entre cada uno, llamando a `onProgress` con cada
 * snapshot. Esto no es solo un atajo: ejercita el parser incremental de
 * punta a punta con datos reales, así que un mock funcionando es evidencia
 * de que el parser funciona.
 *
 * Reutiliza `prFixtures` de `../github/fixtures` (mismo universo mock
 * "shopwave") para poder armar un resumen genérico con datos reales del PR
 * (título, contadores, labels) cuando no hay sección enriquecida para él.
 */
import type { IpcRequest } from '../../shared/ipc'
import type { DidacticSection, GeneratedAnalysis, RepoRef } from '../../shared/types'
import { prFixtures } from '../github/fixtures'
import { genericSummarySection, richDidacticSections } from './fixtures'
import type { AiService, AnalyzePullRequestOptions } from './service'
import { StreamSectionParser, stringifySections } from './stream-parser'

/** Cantidad de trozos en los que se divide el texto serializado de una fixture. */
const STREAM_CHUNKS = 6
/** Delay entre trozos: alcanza para que el streaming sea visible sin sentirse lento. */
const STREAM_CHUNK_DELAY_MS = 150

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function prKey(repo: RepoRef, number: number): string {
  return `${repo.owner}/${repo.name}#${number}`
}

/** Trocea `text` en `~chunks` pedazos de tamaño parejo, cortando en cualquier punto (a propósito: ejercita la tolerancia del parser a marcadores partidos). */
function chunkText(text: string, chunks: number): string[] {
  if (text.length === 0) return ['']
  const size = Math.max(1, Math.ceil(text.length / chunks))
  const parts: string[] = []
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size))
  }
  return parts
}

/**
 * Simula streaming real sobre una fixture ya armada: la serializa, la
 * trocea y la vuelve a parsear con delays, publicando snapshots por
 * `onProgress`. El resultado final sale de `StreamSectionParser.finalize()`
 * (no de la fixture original directamente) para que el mock ejercite
 * exactamente el mismo camino de validación que el pipeline real.
 */
async function streamFixture(
  sections: DidacticSection[],
  onProgress?: AnalyzePullRequestOptions['onProgress'],
): Promise<DidacticSection[]> {
  const parser = new StreamSectionParser()
  const text = stringifySections(sections)

  if (!onProgress) {
    parser.push(text)
    return parser.finalize()
  }

  for (const chunk of chunkText(text, STREAM_CHUNKS)) {
    parser.push(chunk)
    onProgress(parser.snapshot(), { done: false })
    await delay(STREAM_CHUNK_DELAY_MS)
  }

  const final = parser.finalize()
  onProgress(final, { done: true })
  return final
}

export class MockAiService implements AiService {
  async analyzePullRequest(
    req: IpcRequest<'ai:analyzePullRequest'>,
    options?: AnalyzePullRequestOptions,
  ): Promise<GeneratedAnalysis> {
    const prId = prKey(req.repo, req.number)
    const rich = richDidacticSections[prId]

    if (rich) {
      const sections = await streamFixture(rich, options?.onProgress)
      return { prId, sections, generatedAt: new Date().toISOString() }
    }

    const fixture = prFixtures.find((f) => f.detail.id === prId)
    if (!fixture) {
      // Mensaje honesto: el PR existe perfectamente, es ESTE mock el que no
      // lo conoce. Decir "Pull request no encontrado" culpaba al PR cuando el
      // problema era la configuración de IA (ver `./index.ts`).
      throw new Error(
        'La IA en modo demo solo tiene análisis para los PRs de ejemplo; no conoce ' +
          req.repo.fullName +
          '#' +
          req.number +
          '. Configurá un proveedor de IA en Settings (engrane de la barra de título).',
      )
    }

    const sections = await streamFixture([genericSummarySection(fixture.detail)], options?.onProgress)
    return { prId, sections, generatedAt: new Date().toISOString() }
  }
}
