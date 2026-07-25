import { app, BrowserWindow, safeStorage } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc/handlers'
import { authManager } from './auth/auth-manager'
import { ghCliAuth } from './auth/gh-cli-auth'
import { settingsStore } from './settings/store'
import { createSnapshotCleaner } from './github/snapshot-store'
import { stopOpencodeServer } from './ai/providers/opencode-runtime'
import { secureWebPreferences } from './windows/secure-web-preferences'
import { installExternalLinkGuard } from './windows/external-link-guard'
import { hydratePathFromLoginShell } from './system/shell-path'
import { initUpdater, stop as stopUpdater } from './updater/updater'

const isDev = !app.isPackaged

// Aislamiento para e2e (Playwright): un userData alternativo evita que los
// tests pisen settings/cache/snapshots reales y arranca cada corrida desde
// cero. Debe correr ANTES de `app.whenReady()` (todas las lecturas de
// `app.getPath('userData')` en main son lazy, dentro de funciones).
if (process.env.MINERVA_USER_DATA_DIR) {
  app.setPath('userData', process.env.MINERVA_USER_DATA_DIR)
}

/**
 * Password store de Chromium en Linux: en desktops que Chromium NO reconoce
 * (Hyprland/sway/wlroots en general, p. ej. Omarchy) cae a `basic_text`, con
 * el que `safeStorage.isEncryptionAvailable()` es `false` → el token de
 * GitHub nunca se persiste (`auth/token-store.ts` se niega, a propósito, a
 * guardarlo sin cifrar) y hay que loguearse en CADA arranque — en dev y en
 * producción por igual. Si el desktop es desconocido se fuerza
 * `gnome-libsecret` (el Secret Service de D-Bus: gnome-keyring, KeepassXC,
 * etc.), sobreescribible con MINERVA_PASSWORD_STORE. Debe correr ANTES de
 * `app.whenReady()`.
 */
const CHROMIUM_KNOWN_DESKTOPS = /gnome|kde|xfce|cinnamon|pantheon|deepin|ukui|lxqt|unity/i
if (process.platform === 'linux') {
  const desktop = process.env.XDG_CURRENT_DESKTOP ?? ''
  const override = process.env.MINERVA_PASSWORD_STORE
  if (override) {
    app.commandLine.appendSwitch('password-store', override)
  } else if (!CHROMIUM_KNOWN_DESKTOPS.test(desktop)) {
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    // Piso del layout responsivo (F16): la UI está diseñada y verificada hasta
    // el tier `sm`/`xshort` (ver `renderer/src/lib/layout.ts`); por debajo de
    // esto el shell deja de ser operable, así que el WM no puede llevarla ahí.
    minWidth: 560,
    minHeight: 420,
    show: false,
    backgroundColor: '#1a1d23',
    title: 'Minerva',
    // `webPreferences`/guard de enlaces externos extraídos a `./windows/` en
    // T14 para que la ventana didáctica desacoplada (`./windows/didactic-window.ts`)
    // los reutilice sin poder divergir de la ventana principal.
    webPreferences: secureWebPreferences(),
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  installExternalLinkGuard(mainWindow)

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  // Diagnóstico permanente: si esto dice `basic_text` / `false`, el token de
  // GitHub NO va a persistir y el login se pedirá en cada arranque (la causa
  // del "siempre tengo que volver a loguearme" — ver el bloque de arriba).
  if (process.platform === 'linux') {
    console.log(
      '[auth] safeStorage backend:',
      safeStorage.getSelectedStorageBackend(),
      '— cifrado disponible:',
      safeStorage.isEncryptionAvailable(),
    )
  }

  // Enriquecer el PATH con el del shell de login del usuario ANTES de registrar
  // handlers (el probe de proveedores CLI y `resolve-cli.ts` cachean, así que
  // deben ver el PATH completo desde la primera resolución). Solo importa en el
  // empaquetado lanzado desde el launcher del SO —que hereda un PATH mínimo—;
  // en dev desde terminal el PATH ya viene completo y esto es un no-op barato.
  if (app.isPackaged) {
    hydratePathFromLoginShell()
  }

  // Se espera antes de registrar los handlers para que la primera llamada a
  // `auth:getStatus` del renderer ya refleje un token persistido válido (si
  // lo hay), en vez de reportar `signed_out` un instante y luego "saltar" a
  // `signed_in` sin que nada haya disparado ese cambio.
  await authManager.init()

  // F14: si el modo de acceso a GitHub persistido es `gh-cli`, calienta el
  // probe de `gh` ANTES de registrar los handlers, mismo criterio que
  // `authManager.init()` arriba (para que la primera `auth:getStatus` del
  // renderer no reporte "cargando" un instante). El timeout interno de
  // `ghCliAuth` (3s por spawn) garantiza no bloquear el arranque más de eso.
  if (settingsStore.getGithubAccessMode() === 'gh-cli') {
    await ghCliAuth.getStatus()
  }

  const { stopPrWatcher } = await registerIpcHandlers()

  // Watcher de PRs en background (T51, F10): para el timer antes de que la
  // app termine de cerrarse — sin esto seguiría re-armándose (`setTimeout`)
  // tras destruir todas las ventanas, hasta que el proceso muriera solo.
  app.on('before-quit', () => {
    stopPrWatcher()
  })

  // Auto-updater (T91, F17): decide capacidad (`disabled`/`auto`/`notify`,
  // o el guion de `MINERVA_MOCK_UPDATER`) y agenda el check de arranque +
  // el periódico. Se inicializa DESPUÉS de `registerIpcHandlers()` para que
  // los canales `updater:*` ya estén registrados cuando el primer broadcast
  // de estado pudiera dispararse. `stop()` limpia los timers antes de que la
  // app termine de cerrarse — mismo criterio que `stopPrWatcher` arriba.
  initUpdater()
  app.on('before-quit', () => {
    stopUpdater()
  })

  // Limpieza periódica de snapshots de PRs (T54): barrido inmediato + timer.
  // Se crea DESPUÉS de `whenReady` porque el sweep usa `app.getPath('userData')`.
  const snapshotCleaner = createSnapshotCleaner()
  snapshotCleaner.start()

  app.on('before-quit', () => {
    snapshotCleaner.stop()
    // Fire-and-forget: el SIGTERM al grupo se envía sincrónicamente dentro;
    // la escalada a SIGKILL (1s después) puede no llegar a correr si el
    // proceso principal muere antes, y está bien — opencode termina con
    // SIGTERM (verificado en T55).
    void stopOpencodeServer()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
