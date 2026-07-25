import { useSyncExternalStore } from 'react'
import { heightTier, widthTier, type HeightTier, type WidthTier } from '../lib/layout'

export interface LayoutTier {
  width: number
  height: number
  w: WidthTier
  h: HeightTier
}

/**
 * Tier de layout de la VENTANA (F16): decide lo estructural — qué paneles
 * existen y en qué forma (acoplado / rail / drawer). Lo intra-panel (árbol de
 * archivos, split↔inline, toolbar) NO usa esto sino `use-element-width.ts`: el
 * panel didáctico es redimensionable a mano, así que dos ventanas del mismo
 * ancho pueden dejar el diff con anchos distintos.
 *
 * `useSyncExternalStore` en vez de `useState` + efecto: el lint react-hooks de
 * este repo prohíbe `setState` en efecto, y esta es la forma canónica de leer
 * una fuente externa (el tamaño de la ventana) sin efectos. El snapshot está
 * CACHEADO a nivel de módulo y solo se reemplaza cuando algún valor cambió de
 * verdad — `getSnapshot` no puede devolver un objeto nuevo por llamada (React
 * entraría en un loop de renders).
 */
function read(): LayoutTier {
  const width = window.innerWidth
  const height = window.innerHeight
  return { width, height, w: widthTier(width), h: heightTier(height) }
}

let snapshot: LayoutTier = read()
const listeners = new Set<() => void>()

function onResize(): void {
  const next = read()
  if (next.width === snapshot.width && next.height === snapshot.height) return
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('resize', onResize)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('resize', onResize)
  }
}

function getSnapshot(): LayoutTier {
  return snapshot
}

export function useLayoutTier(): LayoutTier {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
