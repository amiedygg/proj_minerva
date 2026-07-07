/**
 * `webPreferences` seguras comunes a TODAS las ventanas de la app: mismo
 * preload, mismo aislamiento. Antes vivía inline en `main/index.ts`; T14
 * (ventana didáctica desacoplada, `./didactic-window.ts`) la extrae a un
 * único punto para que ninguna ventana nueva pueda divergir por accidente de
 * la frontera de seguridad (`contextIsolation`/`sandbox` on, `nodeIntegration`
 * off, ver `CLAUDE.md`).
 *
 * Se usa el equivalente nativo de ESM (`import.meta.dirname`) en vez del
 * global clásico de CommonJS (`__dirname`) a propósito: ese global dispara en
 * electron-vite un plugin de interop que busca por texto plano dónde termina
 * el último `import` del bundle para insertar ahí un shim — y esa búsqueda no
 * distingue código real de texto dentro de un string literal. Con datos mock
 * que incluyen diffs de código de ejemplo (`src/main/github/fixtures.ts`),
 * ese shim puede terminar insertado en medio de una de esas cadenas y
 * corromper el bundle de producción. Evitar ese global de CommonJS aquí evita
 * que el plugin de interop se active del todo (mismo gotcha documentado en
 * T4/T9-final, ver `.agents/TASKS.md`).
 */
import { join } from 'node:path'
import type { WebPreferences } from 'electron'

export function secureWebPreferences(): WebPreferences {
  return {
    preload: join(import.meta.dirname, '../preload/index.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  }
}
