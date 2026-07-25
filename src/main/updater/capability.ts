import { dirname } from 'node:path'

/**
 * Capacidad de auto-actualización de ESTA instalación (T91, F17): función
 * **pura y testeable** — recibe todo por parámetro, nunca importa `electron`
 * ni toca `fs`/`app` directamente (eso lo hace el caller real, `./updater.ts`,
 * con `fs.accessSync`, e inyecta acá como `canWrite`). Tabla completa y
 * justificación de cada rama en `PLAN.md` § F17.
 *
 * Precedencia EXACTA (el orden importa):
 * 1. `env.MINERVA_MOCK_UPDATER` presente ⇒ **no es asunto de esta función**:
 *    el mock (`./mock-updater.ts`) se elige ANTES, en `./updater.ts`, que ni
 *    siquiera llega a llamar a `resolveUpdaterCapability` en ese caso.
 * 2. `env.MINERVA_UPDATER === 'off'` ⇒ `disabled` (kill switch explícito,
 *    le gana a todo lo demás).
 * 3. `!isPackaged` ⇒ `disabled` (dev y TODA la suite e2e; nunca toca la red).
 * 4. `platform === 'darwin'` ⇒ `notify` con reason `'mac-unsigned'` (sin
 *    Developer ID todavía — decisión de producto 1 de F17).
 * 5. `platform === 'linux'`:
 *    - sin `env.APPIMAGE` ⇒ `notify` reason `'not-appimage'`
 *      (`linux-unpacked` o un paquete de la distro, no la AppImage oficial).
 *    - con `APPIMAGE` pero el archivo o su directorio padre NO son
 *      escribibles (AppImageLauncher, instalado bajo `/opt`, corriendo como
 *      root) ⇒ `notify` reason `'not-writable'`.
 *    - si no ⇒ `auto`.
 * 6. `platform === 'win32'` ⇒ `auto` (sin firmar — decisión 2: el
 *    auto-update funciona igual, solo se pierde quitar el aviso de
 *    SmartScreen).
 * 7. Cualquier otra plataforma (BSD, etc.) ⇒ `notify` reason
 *    `'not-appimage'`: el contrato de `UpdaterStatus` no tiene un reason más
 *    específico para "plataforma no contemplada", y el texto que la UI arma
 *    para `'not-appimage'` ("esta instalación no puede actualizarse sola")
 *    sigue siendo honesto acá — es una elección documentada, no un olvido.
 */
export type UpdaterCapability =
  | { mode: 'disabled' }
  | { mode: 'auto' }
  | { mode: 'notify'; reason: 'mac-unsigned' | 'not-appimage' | 'not-writable' }

export interface UpdaterCapabilityInput {
  platform: NodeJS.Platform
  isPackaged: boolean
  env: NodeJS.ProcessEnv
  /**
   * `true` si el proceso puede escribir en `path`. El caller real
   * (`./updater.ts`) usa `fs.accessSync(path, fs.constants.W_OK)` envuelto en
   * try/catch; se inyecta acá para poder testear la matriz completa sin
   * tocar disco de verdad.
   */
  canWrite: (path: string) => boolean
}

export function resolveUpdaterCapability(input: UpdaterCapabilityInput): UpdaterCapability {
  const { platform, isPackaged, env, canWrite } = input

  if (env.MINERVA_UPDATER === 'off') {
    return { mode: 'disabled' }
  }
  if (!isPackaged) {
    return { mode: 'disabled' }
  }
  if (platform === 'darwin') {
    return { mode: 'notify', reason: 'mac-unsigned' }
  }
  if (platform === 'linux') {
    const appImagePath = env.APPIMAGE
    if (!appImagePath) {
      return { mode: 'notify', reason: 'not-appimage' }
    }
    if (!canWrite(appImagePath) || !canWrite(dirname(appImagePath))) {
      return { mode: 'notify', reason: 'not-writable' }
    }
    return { mode: 'auto' }
  }
  if (platform === 'win32') {
    return { mode: 'auto' }
  }
  return { mode: 'notify', reason: 'not-appimage' }
}
