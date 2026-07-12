/**
 * Persistencia de settings de usuario (T12, reestructurado en T26), no
 * secreta (a diferencia del token de GitHub en `../auth/token-store.ts`, que
 * va cifrado con `safeStorage`): un `settings.json` plano en
 * `app.getPath('userData')`.
 *
 * Forma en disco desde T26 (multi-proveedor): `{ "aiProvider": "opencode",
 * "models": { "opencode": "<id>", "claude-code": "<id>", "codex": "<id>" } }`
 * — `aiProvider` es el proveedor ACTIVO; `models` guarda, por proveedor, el
 * último modelo elegido (puede tener entradas para proveedores que no están
 * activos, para no perder la selección al cambiar de proveedor y volver).
 *
 * Migración desde la forma pre-T26 (`{ "aiModel": "<id de openrouter.ai/models>" }`,
 * la única que existía cuando solo había OpenRouter): al leerla se traduce a
 * la forma nueva sin perder la selección previa del usuario — ver
 * `migrateRaw()` más abajo, que desde T59 hace un segundo salto (ver próximo
 * párrafo) para que el resultado final NUNCA tenga `openrouter` como
 * proveedor, sea cual sea la forma original en disco.
 *
 * Migración OpenRouter -> OpenCode (T59): decisión de Edilson — Minerva deja
 * de hablar con OpenRouter directamente, así que `'openrouter'` deja de ser
 * un `AiProviderId` válido (`../../shared/ai-providers.ts`). Un
 * `settings.json` que todavía tenga `aiProvider: 'openrouter'` (o una entrada
 * `models.openrouter`/`modelOptions.openrouter`, activo o no) migra así:
 * - `aiProvider: 'openrouter'` -> `'opencode'`.
 * - `models.openrouter: '<id>'` -> `models.opencode: 'openrouter/<id>'` (SOLO
 *   si no hay ya un modelo de OpenCode guardado — una elección real de
 *   OpenCode gana sobre la migración) — `openrouter/<id>` es el slug con el
 *   que OpenCode nombra un modelo servido por su upstream `openrouter` (tras
 *   `opencode auth login`), no un id inventado.
 * - `modelOptions.openrouter` se DESCARTA (no se migra): el catálogo curado
 *   de OpenCode no declara el mismo descriptor `effort` para sus modelos
 *   fallback, y el modelo dinámico real puede tener una escala de effort
 *   distinta a la que tenía en OpenRouter — arrastrar el valor arriesgaría
 *   aplicar un effort que ya no significa lo mismo.
 * Esta migración corre sobre el JSON CRUDO, ANTES de los guards de forma
 * (`isValidPersistedSettings`): si corriera después, la clave `openrouter`
 * de `models`/`modelOptions` ya habría hecho fallar `isAiProviderId('openrouter')`
 * (`false` desde T59) y el archivo ENTERO se habría descartado como
 * inválido, perdiendo también la selección de cualquier otro proveedor que
 * conviviera en el mismo `settings.json`. El resultado migrado se PERSISTE
 * de inmediato (reescribe `settings.json`), a diferencia de la migración
 * pre-T26 (que hasta T59 quedaba solo en memoria hasta el próximo `set*`):
 * así un arranque siguiente no vuelve a pagar el costo de la migración ni
 * arriesga reinterpretar mal un archivo ya migrado.
 *
 * Además, T59 borra (best-effort) el archivo de key cifrada huérfano que
 * escribía el ya eliminado `../ai/openrouter-key-store.ts`
 * (`openrouter-key.bin` en `userData`) — ver `cleanupOrphanedOpenRouterKeyFile`
 * más abajo.
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
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_AI_PROVIDER, isAiProviderId, type AiProviderId } from '../../shared/ai-providers'
import type { GithubAccessMode } from '../../shared/types'

/** Default cuando no hay `githubAccessMode` persistido (F14): comportamiento previo a F14. */
const DEFAULT_GITHUB_ACCESS_MODE: GithubAccessMode = 'oauth'

function isGithubAccessMode(value: unknown): value is GithubAccessMode {
  return value === 'oauth' || value === 'gh-cli'
}

const SETTINGS_FILE_NAME = 'settings.json'

/**
 * Nombre del archivo cifrado huérfano que escribía `../ai/openrouter-key-store.ts`
 * (borrado en T59) — ver `cleanupOrphanedOpenRouterKeyFile` más abajo. Mismo
 * nombre literal que tenía ese módulo (`API_KEY_FILE_NAME`), repetido acá
 * porque el módulo que lo definía ya no existe.
 */
const ORPHANED_OPENROUTER_KEY_FILE_NAME = 'openrouter-key.bin'

/**
 * Forma persistida desde T26: proveedor activo + modelo elegido por
 * proveedor. `modelOptions` (T34, F8): valores elegidos por el usuario para
 * los option descriptors del modelo de cada proveedor (p. ej.
 * `{ codex: { effort: 'high' } }`) — ADITIVO sobre la forma de T26, ver
 * `isNewPersistedSettings`/`normalize` más abajo: un `settings.json` sin esta
 * clave (cualquier instalación pre-T34) se lee igual, tratando la ausencia
 * como "sin opciones guardadas" (`{}`), nunca como settings inválidos.
 */
/**
 * `githubAccessMode` (F14, v0.5.0): OPCIONAL, mismo patrón aditivo que
 * `modelOptions` (T34) — ausente = `'oauth'` (comportamiento previo a F14),
 * ver `DEFAULT_GITHUB_ACCESS_MODE`/`getGithubAccessMode()`. Vive en el MISMO
 * `settings.json` que la selección de IA (no es un archivo aparte) porque es
 * una preferencia de usuario más, no un secreto — el token de `gh` nunca
 * toca este store, solo el MODO elegido.
 */
export interface PersistedSettings {
  aiProvider: AiProviderId
  models: Partial<Record<AiProviderId, string>>
  modelOptions?: Partial<Record<AiProviderId, Record<string, string>>>
  githubAccessMode?: GithubAccessMode
}

/** Forma pre-T26 (T12): la única que existía cuando solo había OpenRouter. Puede seguir en disco en instalaciones viejas. */
interface LegacyPersistedSettings {
  aiModel: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isModelsMap(value: unknown): value is Partial<Record<AiProviderId, string>> {
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(
    ([provider, modelId]) => isAiProviderId(provider) && isNonEmptyTrimmedString(modelId),
  )
}

/** Mapa `optionId -> value` de un solo proveedor dentro de `modelOptions` (T34). */
function isOptionValuesMap(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(
    ([optionId, optionValue]) => optionId.length > 0 && isNonEmptyTrimmedString(optionValue),
  )
}

/** `modelOptions` completo (T34): por proveedor conocido, su mapa `optionId -> value`. */
function isModelOptionsMap(
  value: unknown,
): value is Partial<Record<AiProviderId, Record<string, string>>> {
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(
    ([provider, options]) => isAiProviderId(provider) && isOptionValuesMap(options),
  )
}

function isNewPersistedSettings(value: unknown): value is PersistedSettings {
  if (!isPlainObject(value)) return false
  if (!isAiProviderId(value.aiProvider) || !isModelsMap(value.models)) return false
  // `modelOptions` es ADITIVO (T34): ausente = settings pre-T34, sigue siendo válido.
  if (value.modelOptions !== undefined && !isModelOptionsMap(value.modelOptions)) return false
  // `githubAccessMode` es ADITIVO (F14): ausente = settings pre-F14, sigue siendo válido;
  // presente pero con un valor fuera de `GithubAccessMode` se rechaza (settings.json
  // corrupto/editado a mano no debe colar un modo inventado).
  return value.githubAccessMode === undefined || isGithubAccessMode(value.githubAccessMode)
}

function isLegacyPersistedSettings(value: unknown): value is LegacyPersistedSettings {
  if (!isPlainObject(value)) return false
  return isNonEmptyTrimmedString(value.aiModel)
}

/**
 * Migración OpenRouter -> OpenCode (T59, ver el comentario de cabecera del
 * módulo): opera sobre un objeto plano ya sabido `Record<string, unknown>`
 * (JSON crudo parseado, TODAVÍA sin validar contra `isNewPersistedSettings`)
 * y devuelve una copia con cualquier rastro de `'openrouter'` reescrito a
 * `'opencode'`. Idempotente: si no hay nada que migrar, devuelve `value` tal
 * cual (mismas referencias, sin clonar de más).
 */
function migrateRawOpenRouterToOpenCode(value: Record<string, unknown>): Record<string, unknown> {
  const hasOpenRouterProvider = value.aiProvider === 'openrouter'
  const models = isPlainObject(value.models) ? value.models : null
  const hasOpenRouterModel = models !== null && 'openrouter' in models
  const modelOptions = isPlainObject(value.modelOptions) ? value.modelOptions : null
  const hasOpenRouterOptions = modelOptions !== null && 'openrouter' in modelOptions

  if (!hasOpenRouterProvider && !hasOpenRouterModel && !hasOpenRouterOptions) {
    return value
  }

  const migrated: Record<string, unknown> = { ...value }

  if (hasOpenRouterProvider) {
    migrated.aiProvider = 'opencode'
  }

  if (models !== null) {
    const nextModels = { ...models }
    const openRouterModelId = nextModels.openrouter
    delete nextModels.openrouter
    if (
      typeof openRouterModelId === 'string' &&
      openRouterModelId.trim().length > 0 &&
      nextModels.opencode === undefined
    ) {
      nextModels.opencode = 'openrouter/' + openRouterModelId.trim()
    }
    migrated.models = nextModels
  }

  if (modelOptions !== null) {
    const nextModelOptions = { ...modelOptions }
    delete nextModelOptions.openrouter
    migrated.modelOptions = nextModelOptions
  }

  return migrated
}

interface MigrationResult {
  settings: PersistedSettings
  /** `true` si el resultado difiere de lo que había en disco: `load()` lo usa para decidir si reescribir `settings.json`. */
  changedFromDisk: boolean
}

/**
 * Punto único de migración de un `settings.json` crudo ya parseado (T26 +
 * T59): interpreta la forma pre-T26 (`{ aiModel }`) como "OpenRouter, con ese
 * modelo elegido" (única lectura posible: OpenRouter era el único proveedor
 * que existía antes de T26) y de ahí en más comparte el mismo paso de
 * migración OpenRouter -> OpenCode que la forma T26 (`migrateRawOpenRouterToOpenCode`)
 * — así el resultado final NUNCA tiene `'openrouter'` como proveedor, sin
 * importar cuán vieja sea la forma original en disco. Devuelve `null` si
 * `parsed` no matchea ninguna forma conocida (ni siquiera tras migrar).
 */
function migrateRaw(parsed: unknown): MigrationResult | null {
  if (isLegacyPersistedSettings(parsed)) {
    const synthesized: Record<string, unknown> = {
      aiProvider: 'openrouter',
      models: { openrouter: parsed.aiModel },
    }
    const migrated = migrateRawOpenRouterToOpenCode(synthesized)
    if (!isNewPersistedSettings(migrated)) return null
    return { settings: migrated, changedFromDisk: true }
  }

  if (!isPlainObject(parsed)) return null

  const migrated = migrateRawOpenRouterToOpenCode(parsed)
  if (!isNewPersistedSettings(migrated)) return null
  return { settings: migrated, changedFromDisk: migrated !== parsed }
}

/**
 * Best-effort: borra el archivo de key cifrada de OpenRouter que quedó
 * huérfano tras T59 (`../ai/openrouter-key-store.ts`, ya eliminado). Se llama
 * una sola vez, en el primer `load()` del proceso — cualquier fallo
 * (permisos, ya borrado por otra instancia, etc.) se ignora en silencio: esto
 * es limpieza de cortesía, nunca debe tumbar el arranque de la app ni la
 * lectura de settings.
 */
function cleanupOrphanedOpenRouterKeyFile(): void {
  try {
    const path = join(app.getPath('userData'), ORPHANED_OPENROUTER_KEY_FILE_NAME)
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // Best-effort a propósito, ver el comentario de arriba.
  }
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
   * (ya migrado/normalizado, ver `migrateRaw()`) en memoria para el resto de
   * la vida del proceso. Si el archivo no existe, no se puede parsear como
   * JSON, o no tiene ninguna forma válida (ni siquiera tras migrar), cae en
   * `null` sin lanzar (defaults sin crashear) — un log de advertencia solo en
   * el caso "existe pero está corrupto/con forma inválida", para no ensuciar
   * el log en el caso normal de "todavía no hay settings guardados". Si la
   * migración cambió algo respecto a lo que había en disco, el resultado se
   * persiste de inmediato (T59: ya no queda "solo en memoria" como antes).
   */
  private load(): PersistedSettings | null {
    if (this.loaded) return this.cache

    this.loaded = true
    cleanupOrphanedOpenRouterKeyFile()

    let raw: string
    try {
      raw = readFileSync(this.filePath(), 'utf-8')
    } catch {
      this.cache = null
      return this.cache
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.warn('[settings] settings.json no se pudo parsear, se ignora:', error)
      this.cache = null
      return this.cache
    }

    const result = migrateRaw(parsed)
    if (result === null) {
      this.cache = null
      console.warn('[settings] settings.json tiene una forma inválida, se ignora:', raw)
      return this.cache
    }

    this.cache = result.settings
    if (result.changedFromDisk) {
      this.writeAtomic(result.settings)
    }
    return this.cache
  }

  /** Settings completos ya normalizados (forma vieja migrada), o `null` si nunca se guardó nada válido. */
  getPersistedSettings(): PersistedSettings | null {
    return this.load()
  }

  /** Modelo persistido para un proveedor concreto, o `null` si no hay nada guardado para ESE proveedor. */
  getPersistedModel(provider: AiProviderId): string | null {
    return this.load()?.models[provider] ?? null
  }

  /** Opciones persistidas (T34, p. ej. `{ effort: 'high' }`) para `provider`, o `{}` si no hay ninguna guardada todavía. */
  getPersistedModelOptions(provider: AiProviderId): Record<string, string> {
    return this.load()?.modelOptions?.[provider] ?? {}
  }

  /** Modo de acceso a GitHub persistido (F14), o el default `'oauth'` si nunca se guardó nada (patrón de `modelOptions`). */
  getGithubAccessMode(): GithubAccessMode {
    return this.load()?.githubAccessMode ?? DEFAULT_GITHUB_ACCESS_MODE
  }

  /** Persiste el modo de acceso a GitHub elegido (F14), sin tocar la selección de IA. */
  setGithubAccessMode(mode: GithubAccessMode): void {
    const current = this.load()
    this.persist({
      aiProvider: current?.aiProvider ?? DEFAULT_AI_PROVIDER,
      models: current?.models ?? {},
      modelOptions: current?.modelOptions,
      githubAccessMode: mode,
    })
  }

  /** Cambia el proveedor ACTIVO, sin tocar los modelos ni las opciones ya elegidas por cada proveedor. */
  setAiProvider(provider: AiProviderId): void {
    const current = this.load()
    this.persist({
      aiProvider: provider,
      models: current?.models ?? {},
      modelOptions: current?.modelOptions,
      // GOTCHA (F14): este objeto se construye A MANO — si no se arrastra
      // `githubAccessMode` del estado previo, un cambio de proveedor/modelo
      // BORRARÍA en silencio el modo de acceso a GitHub que el usuario eligió.
      githubAccessMode: current?.githubAccessMode,
    })
  }

  /** Guarda el modelo elegido para `provider` (no cambia el proveedor activo si `provider` no lo es, ver `setAiProvider`). */
  setProviderModel(provider: AiProviderId, modelId: string): void {
    const current = this.load()
    this.persist({
      aiProvider: current?.aiProvider ?? DEFAULT_AI_PROVIDER,
      models: { ...current?.models, [provider]: modelId },
      modelOptions: current?.modelOptions,
      // Ver el gotcha de `setAiProvider` de arriba: mismo riesgo, mismo fix.
      githubAccessMode: current?.githubAccessMode,
    })
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
      // Ver el gotcha de `setAiProvider` (arriba): mismo riesgo, mismo fix.
      githubAccessMode: current?.githubAccessMode,
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
