/**
 * Barrido final de servers `opencode serve` huérfanos (~300 MB cada uno).
 *
 * `closeMinerva` (`./fixtures.ts`) ya barre después de cada test, así que acá
 * solo puede quedar lo de un test que ni llegó a su teardown (timeout, SIGKILL
 * al worker). Criterio y motivación: ver `./opencode-sweep.ts`.
 */
import { reportSwept, sweepOrphanedOpencodeServers, SWEEP_SUPPORTED } from './opencode-sweep'

export default function globalTeardown(): void {
  if (!SWEEP_SUPPORTED) {
    console.log('[teardown] barrido de opencode omitido: requiere /proc (solo Linux).')
    return
  }
  reportSwept('teardown', sweepOrphanedOpencodeServers())
}
