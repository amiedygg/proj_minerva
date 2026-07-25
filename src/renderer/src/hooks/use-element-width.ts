import { useCallback, useState } from 'react'

/**
 * Ancho REAL (en px) de un elemento, vía ResizeObserver (F16). Se usa para las
 * decisiones INTRA-panel — árbol de archivos como columna o drawer, split↔inline
 * del diff, compactación de la toolbar — porque esas dependen del ancho del
 * panel, no del de la ventana: el didáctico se arrastra a mano, así que la
 * misma ventana puede dejar el diff en 700px o en 300px.
 *
 * Es un **callback ref**, no `useRef` + `useEffect`, a propósito: los
 * componentes que lo usan tienen `return` tempranos (`loading`, `error`, "sin
 * archivos"), así que en el primer render el nodo medido NO existe todavía. Un
 * efecto con deps `[]` correría una sola vez contra `ref.current === null` y no
 * mediría NUNCA (bug real de la primera versión de F16/T85: el árbol se quedaba
 * como columna a 580px porque `width` nunca dejaba de ser `null`). El callback
 * ref, en cambio, corre cada vez que el nodo entra o sale del DOM; la limpieza
 * va en la función que devuelve (soportado por React 19).
 *
 * El `setState` vive en el callback del observer y solo dispara si el ancho
 * redondeado cambió — sin eso, un resize continuo re-renderiza en cada píxel.
 *
 * `width` arranca en `null` = "todavía no medido": los llamadores deben tratar
 * ese caso como "asumir el layout ancho" para no parpadear a la versión
 * compacta durante el primer frame.
 */
export function useElementWidth<T extends HTMLElement>(): {
  ref: (node: T | null) => void
  width: number | null
} {
  const [width, setWidth] = useState<number | null>(null)

  const ref = useCallback((node: T | null) => {
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width)
      setWidth((prev) => (prev === next ? prev : next))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}
