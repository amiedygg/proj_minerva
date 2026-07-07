/**
 * Persistencia de settings de usuario (T12), no secreta (a diferencia del
 * token de GitHub en `../auth/token-store.ts`, que va cifrado con
 * `safeStorage`): un `settings.json` plano en `app.getPath('userData')`.
 *
 * Forma en disco cuando existe: `{ "aiModel": "<id de openrouter.ai/models>" }`.
 * Antes del primer `setAiModel()` el archivo simplemente no existe — no se
 * crea con defaults de entrada porque el default "real" es una decisión de
 * precedencia (`../ai/env.ts`, `getEffectiveAiModel`), no de este módulo:
 * `getPersistedAiModel()` devuelve `null` cuando no hay nada persistido (o el
 * archivo está corrupto/con forma inválida), y quien llama decide qué hacer
 * con ese `null` (caer a `MINERVA_AI_MODEL` del entorno, y si tampoco hay, al
 * `DEFAULT_AI_MODEL` curado).
 *
 * Carga perezosa con cache en memoria (un solo `readFileSync` por proceso,
 * salvo que se llame `setAiModel`, que actualiza la cache in-place además de
 * escribir a disco). Escritura atómica simple: se escribe a un archivo
 * temporal y se hace `rename` sobre el definitivo, para no dejar
 * `settings.json` a medio escribir si el proceso muere a mitad de la
 * escritura.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const SETTINGS_FILE_NAME = 'settings.json'

export interface PersistedSettings {
  aiModel: string
}

function isValidPersistedSettings(value: unknown): value is PersistedSettings {
  if (typeof value !== 'object' || value === null) return false
  const aiModel = (value as Record<string, unknown>).aiModel
  return typeof aiModel === 'string' && aiModel.trim().length > 0
}

export class SettingsStore {
  /** `null` mientras no se haya intentado leer todavía; ver `load()`. */
  private loaded = false
  private cache: PersistedSettings | null = null

  private filePath(): string {
    return join(app.getPath('userData'), SETTINGS_FILE_NAME)
  }

  /**
   * Lee `settings.json` la primera vez que hace falta y cachea el resultado
   * en memoria para el resto de la vida del proceso. Si el archivo no existe,
   * no se puede parsear como JSON, o no tiene la forma esperada, cae en
   * `null` sin lanzar (defaults sin crashear) — un log de advertencia solo en
   * el caso "existe pero está corrupto", para no ensuciar el log en el caso
   * normal de "todavía no hay settings guardados".
   */
  private load(): PersistedSettings | null {
    if (this.loaded) return this.cache

    this.loaded = true
    let raw: string
    try {
      raw = readFileSync(this.filePath(), 'utf-8')
    } catch {
      this.cache = null
      return this.cache
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      this.cache = isValidPersistedSettings(parsed) ? parsed : null
      if (this.cache === null) {
        console.warn('[settings] settings.json tiene una forma inválida, se ignora:', raw)
      }
    } catch (error) {
      console.warn('[settings] settings.json no se pudo parsear, se ignora:', error)
      this.cache = null
    }

    return this.cache
  }

  /** Modelo de IA persistido, o `null` si nunca se guardó uno (o el archivo era inválido). */
  getPersistedAiModel(): string | null {
    return this.load()?.aiModel ?? null
  }

  /** Guarda `aiModel` y lo refleja de inmediato en la cache en memoria. */
  setAiModel(aiModel: string): void {
    const next: PersistedSettings = { aiModel }
    this.writeAtomic(next)
    this.cache = next
    this.loaded = true
  }

  private writeAtomic(data: PersistedSettings): void {
    const finalPath = this.filePath()
    const tmpPath = finalPath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    renameSync(tmpPath, finalPath)
  }
}

/** Instancia única del proceso `main`; `../ai/env.ts` y `../ipc/handlers.ts` la comparten. */
export const settingsStore = new SettingsStore()
