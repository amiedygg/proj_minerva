/**
 * Guard de enlaces externos (T11, extraído de `main/index.ts` en T14 para que
 * la ventana didáctica desacoplada, `./didactic-window.ts`, no lo reimplemente
 * ni pueda divergir de la ventana principal): el Markdown del panel didáctico
 * viene de una IA que analiza contenido de PRs no confiable, así que solo se
 * abren esquemas http(s) en el navegador del sistema; cualquier otro (file:,
 * protocolos custom, etc.) se deniega sin abrir nada.
 */
import { shell, type BrowserWindow } from 'electron'

export function installExternalLinkGuard(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        void shell.openExternal(details.url)
      }
    } catch {
      // URL no parseable: denegar sin abrir nada.
    }
    return { action: 'deny' }
  })
}
