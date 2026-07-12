/**
 * Validación profunda de payloads IPC, un guard por canal.
 *
 * `register.ts` (`handle()`) valida contra `payloadValidators[channel]` antes
 * de invocar el handler real: un payload que no matchea el guard nunca llega
 * al código de negocio. Esto es defensa en profundidad — el preload solo
 * expone funciones con nombre y tipos (`window.minerva.*`), pero un renderer
 * comprometido (XSS, prompt injection en el panel didáctico, etc.) podría en
 * teoría intentar invocar un canal con un payload arbitrario si llegara a
 * tener acceso a `ipcRenderer` por alguna vía no prevista.
 *
 * Los guards son manuales (sin dependencias — nada de zod) para mantener el
 * proyecto liviano; cada uno es una función `(payload: unknown) => boolean`
 * indexada por canal, así el tipado (`Record<IpcChannel, ...>`) obliga a
 * cubrir cualquier canal nuevo del contrato.
 */
import { isAiProviderId } from '../../shared/ai-providers'
import type { IpcChannel } from '../../shared/ipc'

const MAX_SEARCH_LEN = 256
const MAX_REPO_FIELD_LEN = 200
const MAX_BODY_LEN = 65536
const MAX_THREAD_ID_LEN = 200
const MAX_PATH_LEN = 500
const MAX_PR_NUMBER = 1_000_000
const MAX_AI_MODEL_LEN = 100
const MAX_PR_TITLE_LEN = 300
const MAX_OPENROUTER_KEY_LEN = 500
const MAX_OPTION_ID_LEN = 50
const MAX_OPTION_VALUE_LEN = 50
const MAX_PR_ID_LEN = 200
const MAX_UPDATED_AT_LEN = 64

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Ningún payload trae claves fuera de `keys` (evita "prototype pollution"-ish shapes disfrazadas de payload válido). */
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => (keys as readonly string[]).includes(key))
}

function isNonEmptyString(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLen
}

function isOptionalString(value: unknown, maxLen: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLen)
}

/** String obligatorio pero que SÍ puede venir vacío (a diferencia de `isNonEmptyString`) — p. ej. `key` de `settings:setOpenRouterKey`, donde un string vacío es la señal de "borrar". */
function isStringUpToLen(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.length <= maxLen
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isOptionalIntGte(value: unknown, min: number): boolean {
  return (
    value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= min)
  )
}

function isRepoRef(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['owner', 'name', 'fullName'])) return false
  return (
    isNonEmptyString(value.owner, MAX_REPO_FIELD_LEN) &&
    isNonEmptyString(value.name, MAX_REPO_FIELD_LEN) &&
    isNonEmptyString(value.fullName, MAX_REPO_FIELD_LEN)
  )
}

/** Forma común a `getPullRequestDetail/Files/getCommentThreads` y `ai:analyzePullRequest`. */
function isRepoAndNumberPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number'])) return false
  return isRepoRef(value.repo) && isIntInRange(value.number, 1, MAX_PR_NUMBER)
}

function isVoidPayload(value: unknown): boolean {
  return value === undefined
}

/** `state` (T50, F10): filtro de estado opcional, uno de los tres valores de `PrStateFilter`. */
function isOptionalPrStateFilter(value: unknown): boolean {
  return value === undefined || value === 'open' || value === 'closed' || value === 'all'
}

function isListPullRequestsPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['search', 'state'])) return false
  if (!isOptionalString(value.search, MAX_SEARCH_LEN)) return false
  return isOptionalPrStateFilter(value.state)
}

/**
 * `github:markPrSeen` (T50/T51, F10): `prId` no vacío (id opaco de GitHub,
 * puede no ser numérico), `updatedAt` no vacío (string ISO), `commentCount`
 * entero ≥0 — sin claves extra.
 */
function isMarkPrSeenPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['prId', 'updatedAt', 'commentCount'])) return false
  if (!isNonEmptyString(value.prId, MAX_PR_ID_LEN)) return false
  if (!isNonEmptyString(value.updatedAt, MAX_UPDATED_AT_LEN)) return false
  return isIntInRange(value.commentCount, 0, Number.MAX_SAFE_INTEGER)
}

function isPostCommentPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number', 'bodyMarkdown', 'threadId', 'path', 'line', 'side'])) {
    return false
  }
  if (!isRepoRef(value.repo)) return false
  if (!isIntInRange(value.number, 1, MAX_PR_NUMBER)) return false
  if (!isNonEmptyString(value.bodyMarkdown, MAX_BODY_LEN)) return false
  if (!isOptionalString(value.threadId, MAX_THREAD_ID_LEN)) return false
  if (!isOptionalString(value.path, MAX_PATH_LEN)) return false
  if (!isOptionalIntGte(value.line, 1)) return false
  if (value.side !== undefined && value.side !== 'LEFT' && value.side !== 'RIGHT') return false
  return true
}

/** `ai:getProviderModels` (T35): un `provider` conocido del catálogo, sin claves extra. */
function isGetProviderModelsPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['provider'])) return false
  return isAiProviderId(value.provider)
}

/**
 * `aiModel` no se valida contra la lista curada (`shared/ai-models.ts`): la
 * opción "Otro (avanzado)" de la UI permite cualquier id de OpenRouter, así
 * que aquí solo se exige una forma razonable (string no vacío, acotado).
 */
function isSetAiModelPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['aiModel'])) return false
  return isNonEmptyString(value.aiModel, MAX_AI_MODEL_LEN)
}

/** `settings:setAiProvider` (T26): un `provider` conocido del catálogo, sin claves extra. */
function isSetAiProviderPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['provider'])) return false
  return isAiProviderId(value.provider)
}

/**
 * `settings:setProviderModel` (T26): mismo criterio que `isSetAiModelPayload`
 * para `model` (string no vacío, acotado, sin validar contra la lista curada
 * de ESE proveedor — el modo "avanzado" de OpenRouter debe seguir
 * funcionando), más `provider` conocido del catálogo.
 */
function isSetProviderModelPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['provider', 'model'])) return false
  if (!isAiProviderId(value.provider)) return false
  return isNonEmptyString(value.model, MAX_AI_MODEL_LEN)
}

/**
 * `settings:setModelOption` (T34): `provider` conocido del catálogo,
 * `optionId` (id del descriptor, p. ej. `'effort'`) y `value` (id del choice
 * elegido) strings no vacíos y acotados — no se valida contra las choices
 * REALES del descriptor de ese modelo (eso es responsabilidad de la lectura,
 * `getEffectiveAiSelection` en `../ai/env.ts`, ver `resolveOptionValue`).
 */
function isSetModelOptionPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['provider', 'optionId', 'value'])) return false
  if (!isAiProviderId(value.provider)) return false
  if (!isNonEmptyString(value.optionId, MAX_OPTION_ID_LEN)) return false
  return isNonEmptyString(value.value, MAX_OPTION_VALUE_LEN)
}

/**
 * `settings:setOpenRouterKey` (T32): `key` debe ser string (puede venir vacío
 * o solo espacios — esa es la señal para borrar, ver `handlers.ts`), acotado
 * a `MAX_OPENROUTER_KEY_LEN`.
 */
function isSetOpenRouterKeyPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['key'])) return false
  return isStringUpToLen(value.key, MAX_OPENROUTER_KEY_LEN)
}

/** `window:openDidactic` (T14): mismo `repo`/`number` que `isRepoAndNumberPayload`, más el título humano del PR. */
function isOpenDidacticWindowPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number', 'title'])) return false
  if (!isRepoRef(value.repo)) return false
  if (!isIntInRange(value.number, 1, MAX_PR_NUMBER)) return false
  return isNonEmptyString(value.title, MAX_PR_TITLE_LEN)
}

/**
 * Un validador por canal. `register.ts` (`handle`) lo usa para rechazar
 * payloads malformados antes de llegar al handler real; ver también el
 * comentario de cabecera de este archivo.
 */
export const payloadValidators: Record<IpcChannel, (payload: unknown) => boolean> = {
  'minerva:ping': isVoidPayload,
  'auth:getStatus': isVoidPayload,
  'auth:startDeviceFlow': isVoidPayload,
  'auth:signOut': isVoidPayload,
  'github:listPullRequests': isListPullRequestsPayload,
  'github:markPrSeen': isMarkPrSeenPayload,
  'github:getPullRequestDetail': isRepoAndNumberPayload,
  'github:getPullRequestFiles': isRepoAndNumberPayload,
  'github:getCommentThreads': isRepoAndNumberPayload,
  'github:postComment': isPostCommentPayload,
  'ai:analyzePullRequest': isRepoAndNumberPayload,
  'ai:getCachedAnalysis': isRepoAndNumberPayload,
  'ai:invalidateAnalysis': isRepoAndNumberPayload,
  'ai:getAnalysisState': isRepoAndNumberPayload,
  'ai:getProviderStatus': isVoidPayload,
  'ai:getProviderModels': isGetProviderModelsPayload,
  'settings:get': isVoidPayload,
  'settings:setAiModel': isSetAiModelPayload,
  'settings:setAiProvider': isSetAiProviderPayload,
  'settings:setProviderModel': isSetProviderModelPayload,
  'settings:setModelOption': isSetModelOptionPayload,
  'settings:setOpenRouterKey': isSetOpenRouterKeyPayload,
  'settings:getOpenRouterKeyStatus': isVoidPayload,
  'window:openDidactic': isOpenDidacticWindowPayload,
}
