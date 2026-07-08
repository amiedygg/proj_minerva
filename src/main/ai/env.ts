/**
 * Carga en runtime (nunca en build) la configuración de OpenRouter:
 * `OPENROUTER_API_KEY` y el modelo de IA efectivo.
 *
 * `OPENROUTER_API_KEY`: primero `process.env` (lo que tenga el proceso ya
 * seteado — p. ej. si algún día se lanza la app con esa variable exportada en
 * el shell), y si falta, se parsea el `.env` de la raíz del proyecto.
 *
 * El `.env` solo existe en checkout de desarrollo (está en `.gitignore`, ver
 * `.env.example`). En una build empaquetada (electron-builder) ese archivo no
 * se incluye, así que `readProjectDotEnv()` falla silenciosamente (ENOENT) y
 * queda solo `process.env`.
 *
 * Desde T32, `OPENROUTER_API_KEY` tiene una fuente adicional que GANA a
 * todo lo anterior: la key guardada por el usuario desde la UI de Settings,
 * cifrada con `safeStorage` (`./openrouter-key-store.ts`, mismo patrón que el
 * token de GitHub en `../auth/token-store.ts`). Precedencia final: safeStorage
 * > `process.env.OPENROUTER_API_KEY` > `.env` de raíz (dev). Si no hay key
 * guardada, el flujo cae exactamente al de antes (env/.env) — sin regresión
 * para desarrollo.
 *
 * La key NUNCA se loguea ni cruza IPC: este módulo es el único punto de
 * lectura, y quien lo consume (`openrouter-service.ts`) solo la usa para
 * construir el header `Authorization` de la llamada saliente a OpenRouter.
 * Los canales `settings:setOpenRouterKey`/`settings:getOpenRouterKeyStatus`
 * (`../ipc/handlers.ts`) solo exponen `configured`/`source`
 * (`getOpenRouterKeyStatus` más abajo), nunca la key en claro.
 *
 * El modelo de IA (T12) tiene una fuente adicional que gana a todo lo
 * anterior: `settings.json` guardado desde la UI (ver `getEffectiveAiModel`
 * más abajo y `../settings/store.ts`).
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_AI_MODEL } from '../../shared/ai-models'
import {
  AI_PROVIDER_CATALOG,
  DEFAULT_AI_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  isAiProviderId,
  type AiProviderId,
} from '../../shared/ai-providers'
import type { AiSettingsInfo, EffectiveAiModelInfo, OpenRouterKeyStatus } from '../../shared/types'
import { settingsStore } from '../settings/store'
import { loadApiKey } from './openrouter-key-store'

export interface AiEnv {
  openRouterApiKey: string | null
  aiModel: string
}

/**
 * Parser mínimo de `.env`: una variable por línea (`KEY=VALUE`), ignora
 * líneas vacías y comentarios (`#` al inicio, tras recortar espacios). Sin
 * soporte de multilínea ni interpolación — alcanza para este archivo. Quita
 * comillas simples/dobles que envuelvan el valor completo, si las hay.
 */
export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) continue

    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if (key === '') continue

    const isQuoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    if (isQuoted) {
      value = value.slice(1, -1)
    }

    result[key] = value
  }

  return result
}

/**
 * Raíz del proyecto vista desde este módulo. Tras el bundle de electron-vite,
 * todo `main/**` termina en un único `out/main/index.js`, así que
 * `import.meta.dirname` apunta a `out/main` tanto en dev como en build —
 * mismo patrón que usa `src/main/index.ts` para resolver `../preload` y
 * `../renderer`. Dos niveles arriba de `out/main` es la raíz del proyecto.
 */
function projectRoot(): string {
  return resolve(import.meta.dirname, '../..')
}

let cachedDotEnv: Record<string, string> | null = null

function getDotEnv(): Record<string, string> {
  if (cachedDotEnv) return cachedDotEnv

  try {
    const content = readFileSync(join(projectRoot(), '.env'), 'utf-8')
    cachedDotEnv = parseDotEnv(content)
  } catch {
    // Sin `.env` (build empaquetada, o dev sin el archivo todavía): no es un
    // error, simplemente no hay nada que aportar por esta vía.
    cachedDotEnv = {}
  }

  return cachedDotEnv
}

/**
 * Modelo de IA efectivo (pre-T26, OpenRouter-only), con precedencia (de mayor
 * a menor prioridad):
 * 1. `settings.json` (guardado desde la UI de Settings, `../settings/store.ts`).
 * 2. `MINERVA_AI_MODEL` de `process.env` o del `.env` de raíz en dev.
 * 3. `DEFAULT_AI_MODEL` (`z-ai/glm-5.2`, `../../shared/ai-models.ts`).
 *
 * Shim de compatibilidad desde T26 (multi-proveedor, ver
 * `getEffectiveAiSelection` más abajo): sigue asumiendo OpenRouter como único
 * proveedor, que es exactamente lo que necesita `getAiEnv` (la key que lee es
 * la de OpenRouter). Se recalcula en cada llamada (nunca se cachea el
 * resultado combinado): si el usuario cambia el modelo desde Settings
 * mientras la app corre, la siguiente llamada a `ai:analyzePullRequest` ya
 * debe usar el nuevo valor. `OpenRouterAiService.analyzePullRequest` llama a
 * esto (vía `getAiEnv`) dentro del método, no en su constructor, precisamente
 * por esto.
 */
export function getEffectiveAiModel(): EffectiveAiModelInfo {
  const persisted = settingsStore.getPersistedAiModel()
  if (persisted) {
    return { aiModel: persisted, aiModelSource: 'settings' }
  }

  const dotEnv = getDotEnv()
  const envModel = (process.env.MINERVA_AI_MODEL ?? dotEnv.MINERVA_AI_MODEL ?? '').trim()
  if (envModel.length > 0) {
    return { aiModel: envModel, aiModelSource: 'env' }
  }

  return { aiModel: DEFAULT_AI_MODEL, aiModelSource: 'default' }
}

export interface EffectiveAiSelection {
  provider: AiProviderId
  model: string
}

/**
 * Selección efectiva de proveedor+modelo (T26): igual espíritu que
 * `getEffectiveAiModel`, pero generalizado a los tres proveedores
 * (`../../shared/ai-providers.ts`). Precedencia evaluada de forma
 * INDEPENDIENTE para el proveedor y para el modelo, de mayor a menor
 * prioridad:
 * 1. `settings.json` (`settingsStore.getPersistedSettings()`): `aiProvider`
 *    para el proveedor, `models[provider]` para el modelo de ESE proveedor.
 * 2. Entorno: `MINERVA_AI_PROVIDER` para el proveedor, `MINERVA_AI_MODEL`
 *    para el modelo — el modelo de entorno aplica al proveedor YA resuelto
 *    (persistido o de entorno), no queda forzado a OpenRouter.
 * 3. Default del catálogo: `DEFAULT_AI_PROVIDER` y
 *    `DEFAULT_MODEL_BY_PROVIDER[provider]`.
 *
 * Igual que `getEffectiveAiModel`, se recalcula en cada llamada (sin cache
 * del resultado combinado).
 */
export function getEffectiveAiSelection(): EffectiveAiSelection {
  const persisted = settingsStore.getPersistedSettings()
  const dotEnv = getDotEnv()

  const envProviderRaw = (
    process.env.MINERVA_AI_PROVIDER ??
    dotEnv.MINERVA_AI_PROVIDER ??
    ''
  ).trim()
  const envProvider = isAiProviderId(envProviderRaw) ? envProviderRaw : null

  const provider: AiProviderId = persisted?.aiProvider ?? envProvider ?? DEFAULT_AI_PROVIDER

  const persistedModel = persisted?.models[provider]
  if (persistedModel) {
    return { provider, model: persistedModel }
  }

  const envModel = (process.env.MINERVA_AI_MODEL ?? dotEnv.MINERVA_AI_MODEL ?? '').trim()
  if (envModel.length > 0) {
    return { provider, model: envModel }
  }

  return { provider, model: DEFAULT_MODEL_BY_PROVIDER[provider] }
}

/**
 * Agregado que consume el canal IPC `settings:get` (y las respuestas de
 * `settings:setAiProvider`/`settings:setProviderModel`/`settings:setAiModel`,
 * T26): la selección efectiva (`getEffectiveAiSelection`) más `modelSource`
 * (de dónde vino el modelo resuelto, mismo significado que en
 * `getEffectiveAiModel` pero para el proveedor activo, no solo OpenRouter),
 * el mapa persistido completo (`perProviderModel`, para que la UI recuerde la
 * última elección de cada proveedor aunque no esté activo) y el catálogo
 * completo (para pintar la UI sin un roundtrip adicional).
 */
export function getAiSettingsInfo(): AiSettingsInfo {
  const persisted = settingsStore.getPersistedSettings()
  const { provider, model } = getEffectiveAiSelection()

  let modelSource: EffectiveAiModelInfo['aiModelSource']
  if (persisted?.models[provider]) {
    modelSource = 'settings'
  } else {
    const dotEnv = getDotEnv()
    const envModel = (process.env.MINERVA_AI_MODEL ?? dotEnv.MINERVA_AI_MODEL ?? '').trim()
    modelSource = envModel.length > 0 ? 'env' : 'default'
  }

  return {
    provider,
    model,
    modelSource,
    perProviderModel: persisted?.models ?? {},
    catalog: AI_PROVIDER_CATALOG,
  }
}

/**
 * Resuelve la key de OpenRouter con su precedencia completa (T32): la key
 * guardada por el usuario vía `safeStorage` (`./openrouter-key-store.ts`)
 * gana siempre que exista y no esté vacía; si no, cae a `process.env` y luego
 * al `.env` de raíz (dev), igual que antes de T32.
 */
function resolveOpenRouterApiKey(): { key: string | null; source: OpenRouterKeyStatus['source'] } {
  const stored = loadApiKey()
  if (stored && stored.trim().length > 0) {
    return { key: stored.trim(), source: 'safeStorage' }
  }

  const dotEnv = getDotEnv()
  const rawKey = process.env.OPENROUTER_API_KEY ?? dotEnv.OPENROUTER_API_KEY ?? ''
  if (rawKey.trim().length > 0) {
    return { key: rawKey.trim(), source: 'env' }
  }

  return { key: null, source: 'none' }
}

/**
 * Estado de configuración de la key de OpenRouter (T32, canal
 * `settings:getOpenRouterKeyStatus`): NUNCA devuelve la key, solo si hay una
 * configurada y de dónde viene (`safeStorage` = guardada por el usuario desde
 * la UI; `env` = `process.env`/`.env` de dev; `none` = no hay ninguna).
 */
export function getOpenRouterKeyStatus(): OpenRouterKeyStatus {
  const { key, source } = resolveOpenRouterApiKey()
  return { configured: key !== null, source }
}

/** Punto único de lectura de la config de IA. Cachea el `.env` parseado (no `process.env`, que puede cambiar). */
export function getAiEnv(): AiEnv {
  const { key } = resolveOpenRouterApiKey()
  return { openRouterApiKey: key, aiModel: getEffectiveAiModel().aiModel }
}
