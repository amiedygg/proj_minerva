/**
 * Persistencia de settings de usuario (T12, reestructurado en T26), no
 * secreta (a diferencia del token de GitHub en `../auth/token-store.ts`, que
 * va cifrado con `safeStorage`): un `settings.json` plano en
 * `app.getPath('userData')`.
 *
 * Forma en disco desde T26 (multi-proveedor): `{ "aiProvider": "openrouter",
 * "models": { "openrouter": "<id>", "claude-code": "<id>", "codex": "<id>" } }`
 * — `aiProvider` es el proveedor ACTIVO; `models` guarda, por proveedor, el
 * último modelo elegido (puede tener entradas para proveedores que no están
 * activos, para no perder la selección al cambiar de proveedor y volver).
 *
 * Migración desde la forma pre-T26 (`{ "aiModel": "<id de openrouter.ai/models>" }`,
 * la única que existía cuando solo había OpenRouter): al leerla se traduce a
 * `{ aiProvider: 'openrouter', models: { openrouter: aiModel } }` — no se
 * pierde la selección previa del usuario. `isValidPersistedSettings` acepta
 * ambas formas en el JSON crudo; `normalize()` es lo único que sabe traducir
 * la vieja a la nueva, así el resto de la clase (y de `main`) nunca ve la
 * forma vieja.
 *
 * Antes del primer `setAiProvider()`/`setProviderModel()` el archivo
 * simplemente no existe — no se crea con defaults de entrada porque el
 * default "real" es una decisión de precedencia (`../ai/env.ts`,
 * `getEffectiveAiSelection`), no de este módulo: los getters devuelven `null`
 * cuando no hay nada persistido (o el archivo está corrupto/con forma
 * inválida), y quien llama decide qué hacer con ese `null` (caer al entorno,
 * y si tampoco hay, al default curado del catálogo).
 *
 * Carga perezosa con cache en memoria (un solo `readFileSync` por proceso,
 * salvo que se llame a un setter, que actualiza la cache in-place además de
 * escribir a disco). Escritura atómica simple: se escribe a un archivo
 * temporal y se hace `rename` sobre el definitivo, para no dejar
 * `settings.json` a medio escribir si el proceso muere a mitad de la
 * escritura.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_AI_PROVIDER, isAiProviderId, type AiProviderId } from '../../shared/ai-providers'

const SETTINGS_FILE_NAME = 'settings.json'

/**
 * Forma persistida desde T26: proveedor activo + modelo elegido por
 * proveedor. `modelOptions` (T34, F8): valores elegidos por el usuario para
 * los option descriptors del modelo de cada proveedor (p. ej.
 * `{ codex: { effort: 'high' } }`) — ADITIVO sobre la forma de T26, ver
 * `isNewPersistedSettings`/`normalize` más abajo: un `settings.json` sin esta
 * clave (cualquier instalación pre-T34) se lee igual, tratando la ausencia
 * como "sin opciones guardadas" (`{}`), nunca como settings inválidos.
 */
export interface PersistedSettings {
  aiProvider: AiProviderId
  models: Partial<Record<AiProviderId, string>>
  modelOptions?: Partial<Record<AiProviderId, Record<string, string>>>
}

/** Forma pre-T26 (T12): la única que existía cuando solo había OpenRouter. Puede seguir en disco en instalaciones viejas. */
interface LegacyPersistedSettings {
  aiModel: string
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isModelsMap(value: unknown): value is Partial<Record<AiProviderId, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value as Record<string, unknown>).every(
    ([provider, modelId]) => isAiProviderId(provider) && isNonEmptyTrimmedString(modelId),
  )
}

/** Mapa `optionId -> value` de un solo proveedor dentro de `modelOptions` (T34). */
function isOptionValuesMap(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value as Record<string, unknown>).every(
    ([optionId, optionValue]) => optionId.length > 0 && isNonEmptyTrimmedString(optionValue),
  )
}

/** `modelOptions` completo (T34): por proveedor conocido, su mapa `optionId -> value`. */
function isModelOptionsMap(
  value: unknown,
): value is Partial<Record<AiProviderId, Record<string, string>>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value as Record<string, unknown>).every(
    ([provider, options]) => isAiProviderId(provider) && isOptionValuesMap(options),
  )
}

function isNewPersistedSettings(value: unknown): value is PersistedSettings {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!isAiProviderId(v.aiProvider) || !isModelsMap(v.models)) return false
  // `modelOptions` es ADITIVO (T34): ausente = settings pre-T34, sigue siendo válido.
  return v.modelOptions === undefined || isModelOptionsMap(v.modelOptions)
}

function isLegacyPersistedSettings(value: unknown): value is LegacyPersistedSettings {
  if (typeof value !== 'object' || value === null) return false
  return isNonEmptyTrimmedString((value as Record<string, unknown>).aiModel)
}

/**
 * Acepta la forma nueva (T26) O la vieja (`{ aiModel }`, pre-T26): quien
 * llama debe pasar el resultado por `normalize()` antes de usarlo, para no
 * tener que distinguir entre las dos formas en el resto del módulo.
 */
function isValidPersistedSettings(
  value: unknown,
): value is PersistedSettings | LegacyPersistedSettings {
  return isNewPersistedSettings(value) || isLegacyPersistedSettings(value)
}

/**
 * Migración (T26): un `settings.json` con la forma vieja `{ aiModel }` se
 * interpreta como "OpenRouter, con ese modelo elegido" — OpenRouter era el
 * único proveedor que existía antes de esta tarea, así que no hay ambigüedad
 * de a qué proveedor pertenecía ese modelo.
 */
function normalize(value: PersistedSettings | LegacyPersistedSettings): PersistedSettings {
  if ('aiProvider' in value) return value
  return { aiProvider: DEFAULT_AI_PROVIDER, models: { openrouter: value.aiModel } }
}

export class SettingsStore {
  /** `false` mientras no se haya intentado leer todavía; ver `load()`. */
  private loaded = false
  private cache: PersistedSettings | null = null

  private filePath(): string {
    return join(app.getPath('userData'), SETTINGS_FILE_NAME)
  }

  /**
   * Lee `settings.json` la primera vez que hace falta y cachea el resultado
   * (ya normalizado, ver `normalize()`) en memoria para el resto de la vida
   * del proceso. Si el archivo no existe, no se puede parsear como JSON, o no
   * tiene ninguna de las dos formas válidas, cae en `null` sin lanzar
   * (defaults sin crashear) — un log de advertencia solo en el caso "existe
   * pero está corrupto/con forma inválida", para no ensuciar el log en el
   * caso normal de "todavía no hay settings guardados".
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
      if (isValidPersistedSettings(parsed)) {
        this.cache = normalize(parsed)
      } else {
        this.cache = null
        console.warn('[settings] settings.json tiene una forma inválida, se ignora:', raw)
      }
    } catch (error) {
      console.warn('[settings] settings.json no se pudo parsear, se ignora:', error)
      this.cache = null
    }

    return this.cache
  }

  /** Settings completos ya normalizados (forma vieja migrada in-memory), o `null` si nunca se guardó nada válido. */
  getPersistedSettings(): PersistedSettings | null {
    return this.load()
  }

  /** Modelo persistido para un proveedor concreto, o `null` si no hay nada guardado para ESE proveedor. */
  getPersistedModel(provider: AiProviderId): string | null {
    return this.load()?.models[provider] ?? null
  }

  /** Shim de compatibilidad (pre-T26): equivalente a `getPersistedModel('openrouter')`. */
  getPersistedAiModel(): string | null {
    return this.getPersistedModel('openrouter')
  }

  /** Opciones persistidas (T34, p. ej. `{ effort: 'high' }`) para `provider`, o `{}` si no hay ninguna guardada todavía. */
  getPersistedModelOptions(provider: AiProviderId): Record<string, string> {
    return this.load()?.modelOptions?.[provider] ?? {}
  }

  /** Cambia el proveedor ACTIVO, sin tocar los modelos ni las opciones ya elegidas por cada proveedor. */
  setAiProvider(provider: AiProviderId): void {
    const current = this.load()
    this.persist({
      aiProvider: provider,
      models: current?.models ?? {},
      modelOptions: current?.modelOptions,
    })
  }

  /** Guarda el modelo elegido para `provider` (no cambia el proveedor activo si `provider` no lo es, ver `setAiProvider`). */
  setProviderModel(provider: AiProviderId, modelId: string): void {
    const current = this.load()
    this.persist({
      aiProvider: current?.aiProvider ?? DEFAULT_AI_PROVIDER,
      models: { ...current?.models, [provider]: modelId },
      modelOptions: current?.modelOptions,
    })
  }

  /** Shim de compatibilidad (pre-T26): equivalente a `setProviderModel('openrouter', aiModel)`. */
  setAiModel(aiModel: string): void {
    this.setProviderModel('openrouter', aiModel)
  }

  /**
   * Guarda el valor elegido para una opción de `provider` (T34, p. ej.
   * `setModelOption('codex', 'effort', 'high')`) sin tocar el proveedor
   * activo, los modelos elegidos, ni las opciones de otros proveedores/otras
   * opciones del mismo proveedor (crea el sub-objeto de `provider` si hace
   * falta). No valida el `value` contra las choices del modelo activo — esa
   * validación "robusta" es responsabilidad de la LECTURA
   * (`getEffectiveAiSelection`, `../ai/env.ts`, vía `resolveOptionValue`),
   * para que cambiar de modelo después de guardar no deje un valor "huérfano"
   * bloqueado: simplemente se ignora si ya no aplica, sin perder el dato por
   * si el usuario vuelve a ese modelo.
   */
  setModelOption(provider: AiProviderId, optionId: string, value: string): void {
    const current = this.load()
    const currentModelOptions = current?.modelOptions ?? {}
    const currentProviderOptions = currentModelOptions[provider] ?? {}
    this.persist({
      aiProvider: current?.aiProvider ?? DEFAULT_AI_PROVIDER,
      models: current?.models ?? {},
      modelOptions: {
        ...currentModelOptions,
        [provider]: { ...currentProviderOptions, [optionId]: value },
      },
    })
  }

  /** Escribe atómico y refleja `next` de inmediato en la cache en memoria. */
  private persist(next: PersistedSettings): void {
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
