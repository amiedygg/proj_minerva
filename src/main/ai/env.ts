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
 * queda solo `process.env`. Persistencia segura de la key vía `safeStorage`
 * (igual que el token de GitHub) sigue siendo tarea futura — hoy la única vía
 * soportada para la key es el `.env` de desarrollo o una variable de entorno
 * real del proceso.
 *
 * La key NUNCA se loguea ni cruza IPC: este módulo es el único punto de
 * lectura, y quien lo consume (`openrouter-service.ts`) solo la usa para
 * construir el header `Authorization` de la llamada saliente a OpenRouter.
 *
 * El modelo de IA (T12) tiene una fuente adicional que gana a todo lo
 * anterior: `settings.json` guardado desde la UI (ver `getEffectiveAiModel`
 * más abajo y `../settings/store.ts`).
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_AI_MODEL } from '../../shared/ai-models'
import type { EffectiveAiModelInfo } from '../../shared/types'
import { settingsStore } from '../settings/store'

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
 * Modelo de IA efectivo, con precedencia (de mayor a menor prioridad):
 * 1. `settings.json` (guardado desde la UI de Settings, `../settings/store.ts`).
 * 2. `MINERVA_AI_MODEL` de `process.env` o del `.env` de raíz en dev.
 * 3. `DEFAULT_AI_MODEL` (`z-ai/glm-5.2`, `../../shared/ai-models.ts`).
 *
 * Se recalcula en cada llamada (nunca se cachea el resultado combinado): si
 * el usuario cambia el modelo desde Settings mientras la app corre, la
 * siguiente llamada a `ai:analyzePullRequest` ya debe usar el nuevo valor.
 * `OpenRouterAiService.analyzePullRequest` llama a esto (vía `getAiEnv`)
 * dentro del método, no en su constructor, precisamente por esto.
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

/** Punto único de lectura de la config de IA. Cachea el `.env` parseado (no `process.env`, que puede cambiar). */
export function getAiEnv(): AiEnv {
  const dotEnv = getDotEnv()

  const rawKey = process.env.OPENROUTER_API_KEY ?? dotEnv.OPENROUTER_API_KEY ?? ''
  const openRouterApiKey = rawKey.trim().length > 0 ? rawKey.trim() : null

  return { openRouterApiKey, aiModel: getEffectiveAiModel().aiModel }
}
