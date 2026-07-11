/**
 * Contrato de eventos PUSH `main` -> `renderer` (T13). Distinto de `ipc.ts`:
 * aquellos canales son invoke/response uno-a-uno pedidos por el renderer;
 * estos son notificaciones que `main` empuja por su cuenta mientras un
 * análisis de IA está en curso (streaming del panel didáctico).
 *
 * Igual que `ipc.ts`, un solo objeto de contrato (`EventContract`) es la
 * fuente de verdad de forma/canal. A diferencia de `ipc.ts`, el preload NO
 * deriva un `on(channel, cb)` genérico de esto: expone un método concreto por
 * evento (`window.minerva.events.onAnalysisProgress`, ver `src/preload/index.ts`)
 * con el nombre de canal hardcodeado, para no reabrir la puerta a que el
 * renderer se suscriba a un canal arbitrario si en algún momento tuviera
 * acceso a `ipcRenderer` por una vía no prevista.
 */
import type { DidacticSnippet, RepoRef } from './types'

interface DraftSectionCommon {
  markdown: string
  /**
   * `true` únicamente en la última sección de un snapshot mientras esa
   * sección sigue acumulando texto (no llegó el próximo `@@@SECTION` ni el
   * cierre del stream). Todas las secciones anteriores de un mismo snapshot
   * ya cerraron, así que no necesitan el flag.
   */
  streaming?: boolean
}

/**
 * Variante "en construcción" de `DidacticSection` (`./types.ts`) que viaja en
 * los snapshots de progreso del streaming (`src/main/ai/stream-parser.ts`).
 *
 * Diferencia clave con `DidacticSection`: en `architecture`/`schema`, el
 * campo `mermaid` es OPCIONAL. Mientras el bloque `@@@MERMAID` de esa sección
 * no cerró con `@@@END_MERMAID`, el campo simplemente está ausente — nunca
 * llega un DSL de Mermaid a medio escribir. Así el renderer solo necesita
 * comprobar `'mermaid' in section` (o `section.mermaid`) para saber si ya
 * puede montar el diagrama; nunca puede confundir uno parcial con uno final,
 * porque uno parcial no existe como valor observable desde afuera del parser.
 * Mismo criterio para los `snippets` de una sección `endpoint`: solo aparecen
 * en el array una vez que su `@@@END_SNIPPET` cerró.
 */
export type DraftDidacticSection =
  | ({ kind: 'summary' } & DraftSectionCommon)
  | ({ kind: 'setup'; snippets: DidacticSnippet[] } & DraftSectionCommon)
  | ({ kind: 'architecture'; mermaid?: string } & DraftSectionCommon)
  | ({ kind: 'endpoint'; snippets: DidacticSnippet[] } & DraftSectionCommon)
  | ({ kind: 'schema'; mermaid?: string } & DraftSectionCommon)

export interface AnalysisProgressEvent {
  repo: RepoRef
  number: number
  sections: DraftDidacticSection[]
  /** `true` en el último snapshot emitido (el análisis ya terminó, con éxito o no). */
  done: boolean
  /**
   * Solo presente en el evento TERMINAL (`done: true`) de un análisis que
   * falló (T22): el mensaje de error del intento, el mismo texto que
   * rechazaría `ai:analyzePullRequest` si el solicitante lo hubiera esperado
   * directamente. Ausente en todo evento intermedio y en el terminal de un
   * análisis exitoso — su sola presencia es la señal de "falló" para quien
   * escucha el streaming sin haber disparado el análisis (p. ej. una ventana
   * desacoplada que se enganchó a un análisis ya en curso, ver
   * `ai:getAnalysisState` en `src/shared/ipc.ts`): sin este campo esa ventana
   * se quedaría mostrando "streaming" para siempre ante un error, porque
   * `OpenRouterAiService`/`MockAiService` nunca llaman a `onProgress` en el
   * camino de error — el evento terminal con `error` lo arma el handler
   * (`src/main/ipc/handlers.ts`), no el `AiService`.
   */
  error?: string
}

/**
 * Un cambio individual detectado por el watcher de PRs (T50/T51, F10,
 * `main/github/pr-watcher.ts`) entre dos snapshots de
 * `listPullRequests({ state: 'all' })`: `new_pr` (id nuevo), `pr_closed` /
 * `pr_merged` (transición desde `open`), `new_comments` (`commentCount`
 * subió) o `updated` (cualquier otro cambio de `updatedAt`). `title`/`repo`
 * viajan para que la UI pueda mostrar un cambio sin otro roundtrip.
 */
export interface PrChange {
  type: 'new_pr' | 'pr_closed' | 'pr_merged' | 'new_comments' | 'updated'
  prId: string
  number: number
  title: string
  repo: RepoRef
}

/**
 * Payload de `minerva:event:prListChanged` (T50/T51, F10): se emite SOLO
 * cuando el watcher detecta al menos un cambio frente al snapshot anterior
 * (el primer tick establece el baseline en silencio, sin emitir evento) —
 * `changes` nunca viaja vacío.
 */
export interface PrListChangedEvent {
  changes: PrChange[]
}

export interface EventContract {
  'minerva:event:analysisProgress': AnalysisProgressEvent
  'minerva:event:prListChanged': PrListChangedEvent
}

export type EventChannel = keyof EventContract
export type EventPayload<C extends EventChannel> = EventContract[C]

/**
 * Nombres de canal como constantes, para no repetir el string mágico entre
 * `main` (quien emite, `src/main/ipc/handlers.ts`) y `preload` (quien se
 * suscribe con el canal hardcodeado, `src/preload/index.ts`).
 */
export const MINERVA_EVENTS = {
  analysisProgress: 'minerva:event:analysisProgress',
  prListChanged: 'minerva:event:prListChanged',
} satisfies Record<string, EventChannel>
