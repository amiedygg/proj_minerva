/**
 * Persistencia cifrada de `OPENROUTER_API_KEY` en disco, vía `safeStorage` de
 * Electron. Mismo patrón EXACTO que `../auth/token-store.ts` (token de
 * GitHub), aplicado a la key de OpenRouter guardada desde la UI de Settings
 * (T32). La key NUNCA se guarda en claro:
 *
 * - Si `safeStorage.isEncryptionAvailable()` es `false` (p. ej. no hay
 *   keyring/keychain del SO disponible), NO se persiste nada — la key vive
 *   solo en memoria del proceso `main` durante esa sesión y hay que volver a
 *   pegarla la próxima vez que arranque la app. Se deja constancia con
 *   `console.warn` (log de main).
 * - El archivo (`openrouter-key.bin` en `userData`) solo contiene bytes
 *   cifrados con la clave del SO; sin esa clave (u otra máquina) es basura.
 *
 * `getAiEnv` (`./env.ts`) es el único punto que llama a `loadApiKey()`; la key
 * en claro nunca cruza IPC (los canales `settings:setOpenRouterKey`/
 * `settings:getOpenRouterKeyStatus` solo exponen `configured`/`source`).
 */
import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API_KEY_FILE_NAME = 'openrouter-key.bin'

function apiKeyFilePath(): string {
  return join(app.getPath('userData'), API_KEY_FILE_NAME)
}

export function isPersistenceAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function saveApiKey(key: string): void {
  if (!isPersistenceAvailable()) {
    console.warn(
      '[ai] safeStorage no disponible en este sistema: la key de OpenRouter no se persiste, ' +
        'solo vive en memoria del proceso main mientras dure esta sesión.',
    )
    return
  }
  const encrypted = safeStorage.encryptString(key)
  writeFileSync(apiKeyFilePath(), encrypted)
}

export function loadApiKey(): string | null {
  if (!isPersistenceAvailable()) return null
  const path = apiKeyFilePath()
  if (!existsSync(path)) return null
  try {
    const encrypted = readFileSync(path)
    return safeStorage.decryptString(encrypted)
  } catch (error) {
    console.warn('[ai] no se pudo descifrar la key de OpenRouter persistida, se descarta:', error)
    return null
  }
}

export function clearApiKey(): void {
  const path = apiKeyFilePath()
  if (!existsSync(path)) return
  try {
    unlinkSync(path)
  } catch (error) {
    console.warn('[ai] no se pudo borrar el archivo de key de OpenRouter persistido:', error)
  }
}

/**
 * Existencia del archivo cifrado SIN descifrarlo (para reportar `configured`
 * en `getOpenRouterKeyStatus` sin pagar el costo/riesgo de un descifrado que
 * no hace falta para ese caso, aunque hoy `loadApiKey` ya sería igual de
 * seguro de llamar — se deja como atajo explícito).
 */
export function hasStoredApiKey(): boolean {
  return existsSync(apiKeyFilePath())
}
