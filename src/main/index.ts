import { app, BrowserWindow, safeStorage } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc/handlers'
import { authManager } from './auth/auth-manager'
import { secureWebPreferences } from './windows/secure-web-preferences'
import { installExternalLinkGuard } from './windows/external-link-guard'

const isDev = !app.isPackaged

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

  // Se espera antes de registrar los handlers para que la primera llamada a
  // `auth:getStatus` del renderer ya refleje un token persistido válido (si
  // lo hay), en vez de reportar `signed_out` un instante y luego "saltar" a
  // `signed_in` sin que nada haya disparado ese cambio.
  await authManager.init()

  await registerIpcHandlers()

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
