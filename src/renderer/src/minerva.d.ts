export {}

/**
 * Shape of the `window.minerva` bridge exposed by `src/preload/index.ts`.
 *
 * `MinervaApi` se define en `src/shared/ipc.ts` (derivado de `IpcContract`) y se
 * importa aquí en vez de desde `src/preload`: el preload vive en el proyecto TS
 * "node" (`tsconfig.node.json`) y el renderer en el proyecto "web"
 * (`tsconfig.web.json`); importar entre esos dos programas de `tsc` dispara
 * TS6307 ("file not listed within file list of project"). `src/shared` está
 * incluido en ambos tsconfig, así que es el punto neutral de donde importar.
 */
import type { MinervaApi } from '../../shared/ipc'

declare global {
  interface Window {
    minerva: MinervaApi
  }
}
