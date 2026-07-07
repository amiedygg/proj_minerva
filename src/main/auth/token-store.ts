/**
 * Persistencia cifrada del token de GitHub en disco, vía `safeStorage` de
 * Electron. El token NUNCA se guarda en claro:
 *
 * - Si `safeStorage.isEncryptionAvailable()` es `false` (p. ej. no hay
 *   keyring/keychain del SO disponible), NO se persiste nada — el token vive
 *   solo en memoria del proceso `main` durante esa sesión y hay que volver a
 *   hacer login la próxima vez que arranque la app. Se deja constancia con
 *   `console.warn` (log de main).
 * - El archivo (`github-token.bin` en `userData`) solo contiene bytes
 *   cifrados con la clave del SO; sin esa clave (u otra máquina) es basura.
 */
import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TOKEN_FILE_NAME = 'github-token.bin'

function tokenFilePath(): string {
  return join(app.getPath('userData'), TOKEN_FILE_NAME)
}

export function isPersistenceAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function saveToken(token: string): void {
  if (!isPersistenceAvailable()) {
    console.warn(
      '[auth] safeStorage no disponible en este sistema: el token de GitHub no se persiste, ' +
        'solo vive en memoria del proceso main mientras dure esta sesión.',
    )
    return
  }
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(tokenFilePath(), encrypted)
}

export function loadToken(): string | null {
  if (!isPersistenceAvailable()) return null
  const path = tokenFilePath()
  if (!existsSync(path)) return null
  try {
    const encrypted = readFileSync(path)
    return safeStorage.decryptString(encrypted)
  } catch (error) {
    console.warn('[auth] no se pudo descifrar el token persistido, se descarta:', error)
    return null
  }
}

export function clearToken(): void {
  const path = tokenFilePath()
  if (!existsSync(path)) return
  try {
    unlinkSync(path)
  } catch (error) {
    console.warn('[auth] no se pudo borrar el archivo de token persistido:', error)
  }
}
