/**
 * Ruteo por hash para la ventana didáctica desacoplable (T14, ver
 * `src/main/windows/didactic-window.ts` y `src/renderer/src/main.tsx`).
 *
 * `main` abre la ventana desacoplada cargando el MISMO renderer que la
 * ventana principal, pero con un hash `didactic/<owner>/<name>/<number>`
 * (más un `title` de query opcional, el título humano del PR, para que el
 * renderer pueda pintar el header al instante sin esperar un round-trip de
 * `github:getPullRequestDetail`). `main.tsx` decide si monta `<App>` o
 * `<DidacticWindowApp>` mirando `location.hash` con este mismo parser, así
 * que quien arma el hash (main) y quien lo lee (renderer) comparten
 * literalmente la misma lógica — vive en `shared` (no en `main` ni en
 * `renderer`) exactamente por eso.
 *
 * A propósito el prefijo NO incluye el `#`: `BrowserWindow.loadFile` recibe
 * el hash vía `{ hash }` (pasado a `url.format()` de Node, que antepone el
 * `#` él solo), mientras que `loadURL` en dev necesita el `#` concatenado a
 * mano. `parseDidacticHash` acepta el valor con o sin `#` inicial (en el
 * renderer, `location.hash` siempre lo trae) para no repetir esa asimetría
 * en cada punto de uso.
 */
import type { RepoRef } from './types'

export const DIDACTIC_ROUTE_PREFIX = 'didactic/'

export interface DidacticRouteTarget {
  repo: RepoRef
  number: number
  /** `null` si el hash no traía `title` en el query (no debería pasar si se armó con `buildDidacticHash`, pero se tolera). */
  title: string | null
}

/** Arma el hash (sin `#` inicial, ver comentario de cabecera) para navegar la ventana didáctica a `repo#number`. */
export function buildDidacticHash(repo: RepoRef, number: number, title: string): string {
  return (
    DIDACTIC_ROUTE_PREFIX +
    encodeURIComponent(repo.owner) +
    '/' +
    encodeURIComponent(repo.name) +
    '/' +
    number +
    '?title=' +
    encodeURIComponent(title)
  )
}

/** `null` si `hash` no es una ruta didáctica válida (prefijo ausente, o owner/name/number malformados). */
export function parseDidacticHash(hash: string): DidacticRouteTarget | null {
  const withoutLeadingHash = hash.startsWith('#') ? hash.slice(1) : hash
  if (!withoutLeadingHash.startsWith(DIDACTIC_ROUTE_PREFIX)) return null

  const rest = withoutLeadingHash.slice(DIDACTIC_ROUTE_PREFIX.length)
  const [pathPart, queryPart] = rest.split('?')
  const segments = pathPart.split('/')
  if (segments.length < 3) return null

  const owner = decodeURIComponent(segments[0])
  const name = decodeURIComponent(segments[1])
  const number = Number(segments[2])
  if (owner.length === 0 || name.length === 0 || !Number.isInteger(number) || number <= 0) {
    return null
  }

  let title: string | null = null
  if (queryPart) {
    const match = /(?:^|&)title=([^&]*)/.exec(queryPart)
    if (match) title = decodeURIComponent(match[1])
  }

  return { repo: { owner, name, fullName: owner + '/' + name }, number, title }
}
