/**
 * Catálogo de proveedores de IA (T26): OpenRouter, Claude Code y Codex, cada
 * uno con su propia lista curada de modelos. Antes de esta tarea solo existía
 * OpenRouter y su lista vivía plana en `ai-models.ts`; esos IDs de OpenRouter
 * (`z-ai/glm-5.2`, etc.) aplican SOLO a OpenRouter — Claude Code y Codex no
 * llaman a una API HTTP con un id de modelo libre, usan los CLIs/SDK
 * oficiales (T27/T28/T29), así que su catálogo es curado a mano.
 *
 * `ai-models.ts` ahora re-exporta el slice de OpenRouter desde acá para no
 * romper imports existentes (`ModelPicker.tsx`, `main/ai/env.ts`) — no
 * agregar nada nuevo en `ai-models.ts`, el catálogo real vive acá.
 */
export type AiProviderId = 'openrouter' | 'claude-code' | 'codex'

/**
 * Una opción concreta dentro de un `ModelOptionDescriptor` (T34, F8): p. ej.
 * para el descriptor `effort`, cada choice es un nivel (`low`/`medium`/...)
 * con su etiqueta humana y una descripción corta para la UI (T37).
 * `isDefault` marca el choice al que cae la resolución cuando no hay nada
 * persistido para ese modelo, o cuando lo persistido no es válido para él
 * (ver `resolveOptionValue` más abajo y `getEffectiveAiSelection` en
 * `main/ai/env.ts`) — a lo sumo un choice por descriptor debería tener
 * `isDefault: true`; si ninguno lo tiene, `resolveOptionValue` cae al primero
 * de la lista.
 */
export interface ModelOptionChoice {
  value: string
  label: string
  description?: string
  isDefault?: boolean
}

/**
 * Descriptor de opción AUTOCONTENIDO por modelo (patrón de t3code, F8): cada
 * modelo del catálogo declara sus propias opciones configurables (hoy solo
 * `effort`, extensible a service tier/thinking/context window después) con
 * sus choices válidas — la UI (T37) es genérica sobre este array, nunca
 * bifurca por proveedor, y al cambiar de modelo el valor elegido se recalcula
 * contra las choices del nuevo descriptor (nunca se manda un valor que el
 * modelo activo no soporta).
 */
export interface ModelOptionDescriptor {
  id: string
  label: string
  choices: ModelOptionChoice[]
}

export interface AiModelOption {
  id: string
  label: string
  vendor: string
  /** Descriptores de opción de este modelo (T34); ausente = el modelo no tiene opciones configurables. */
  options?: ModelOptionDescriptor[]
}

export interface AiProviderCatalogEntry {
  provider: AiProviderId
  label: string
  models: readonly AiModelOption[]
}

/**
 * Etiquetas/descripciones humanas para choices de `effort`, compartidas por
 * todos los descriptores `effort` del catálogo (T34, F8) — así la UI (T37)
 * siempre ve el mismo texto para el mismo nivel, sea cual sea el proveedor.
 */
const EFFORT_CHOICE_LABELS: Record<string, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  xhigh: 'Muy alto',
  max: 'Máximo',
}

const EFFORT_CHOICE_DESCRIPTIONS: Record<string, string> = {
  low: 'Respuestas más rápidas, con menos razonamiento.',
  medium: 'Equilibrio entre velocidad y profundidad de razonamiento.',
  high: 'Razonamiento más profundo; respuestas más lentas.',
  xhigh: 'Razonamiento extendido para tareas complejas.',
  max: 'El máximo razonamiento disponible; la opción más lenta.',
}

/**
 * Arma el descriptor `effort` a partir de la lista de niveles soportados por
 * un modelo concreto y cuál es su default (T34) — evita repetir a mano las
 * choices en cada entrada del catálogo de abajo. `defaultValue` DEBE estar en
 * `values` (invariante de los datos curados de este archivo, no se valida en
 * runtime porque es contenido estático, no input de usuario).
 */
function effortDescriptor(values: readonly string[], defaultValue: string): ModelOptionDescriptor {
  return {
    id: 'effort',
    label: 'Razonamiento',
    choices: values.map((value) => ({
      value,
      label: EFFORT_CHOICE_LABELS[value] ?? value,
      description: EFFORT_CHOICE_DESCRIPTIONS[value],
      isDefault: value === defaultValue,
    })),
  }
}

/**
 * Matriz de `effort` para Claude Code curada a mano (T34, fuente: informe de
 * investigación de t3code): `fable-5`/`opus-4-8`/`sonnet-5` soportan el rango
 * completo (incluido `xhigh` nativo); `haiku-4-5` es más conservador (sin
 * `xhigh`/`max`). El default en los cuatro es `high`. T36 normaliza cualquier
 * remapeo de compatibilidad adicional al pasarlo al SDK.
 */
const CLAUDE_CODE_FULL_EFFORT = effortDescriptor(['low', 'medium', 'high', 'xhigh', 'max'], 'high')
const CLAUDE_CODE_HAIKU_EFFORT = effortDescriptor(['low', 'medium', 'high'], 'high')

/**
 * `effort` para los modelos de OpenRouter claramente capaces de reasoning
 * (T34, conservador a propósito): el resto del catálogo (`glm`, `kimi`,
 * `gemini-flash`) queda SIN descriptor por ahora — T36 valida el formato/
 * soporte fino contra la API real antes de ampliar esta lista.
 */
const OPENROUTER_REASONING_EFFORT = effortDescriptor(['low', 'medium', 'high'], 'medium')

/**
 * IDs verificados contra la API pública de OpenRouter (openrouter.ai/models)
 * — no cambiar sin volver a verificar. Migrado tal cual desde el
 * `ai-models.ts` pre-T26 (T12).
 */
const OPENROUTER_MODELS = [
  { id: 'z-ai/glm-5.2', label: 'GLM 5.2', vendor: 'Z.ai' },
  { id: 'moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code', vendor: 'MoonshotAI' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', vendor: 'Google' },
  { id: 'openai/gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI', options: [OPENROUTER_REASONING_EFFORT] },
  {
    id: 'anthropic/claude-opus-4.8',
    label: 'Claude Opus 4.8',
    vendor: 'Anthropic',
    options: [OPENROUTER_REASONING_EFFORT],
  },
  {
    id: 'anthropic/claude-sonnet-5',
    label: 'Claude Sonnet 5',
    vendor: 'Anthropic',
    options: [OPENROUTER_REASONING_EFFORT],
  },
] as const satisfies readonly AiModelOption[]

/**
 * Alias de modelo que entiende `@anthropic-ai/claude-agent-sdk` (T28) vía
 * `query({ options: { model } })` — no son ids de vendor/model estilo
 * OpenRouter, son los nombres que el SDK/CLI de Claude Code resuelve.
 */
const CLAUDE_CODE_MODELS = [
  { id: 'claude-fable-5', label: 'Fable 5', vendor: 'Anthropic', options: [CLAUDE_CODE_FULL_EFFORT] },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', vendor: 'Anthropic', options: [CLAUDE_CODE_FULL_EFFORT] },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', vendor: 'Anthropic', options: [CLAUDE_CODE_FULL_EFFORT] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', vendor: 'Anthropic', options: [CLAUDE_CODE_HAIKU_EFFORT] },
] as const satisfies readonly AiModelOption[]

/**
 * Todos los modelos de Codex comparten el mismo set de reasoning efforts
 * (`low|medium|high|xhigh`) según `model/list` de `codex app-server` 0.142.x —
 * los `defaultReasoningEffort` varían por modelo (gpt-5.5=medium,
 * spark=high) pero eso solo cambia a qué cae cuando NO hay valor elegido, y el
 * catálogo DINÁMICO (`codex-model-catalog.ts`) trae el default real por modelo
 * para la UI. Acá el default es `medium` (el más común).
 */
const CODEX_EFFORT = effortDescriptor(['low', 'medium', 'high', 'xhigh'], 'medium')

/**
 * IDs verificados contra la RPC `model/list` de `codex app-server` 0.142.x
 * (T29/T35). Esta lista ESTÁTICA cumple dos roles: (a) fallback cuando no hay
 * sesión Codex / la RPC falla, y (b) — CLAVE — es el catálogo contra el que
 * `getEffectiveAiSelection` (`main/ai/env.ts`, SÍNCRONO) resuelve el `effort`
 * elegido: por eso cada modelo lleva su descriptor `effort`, sin el cual el
 * effort guardado se descartaría al resolver (bug destapado en la verificación
 * e2e de F8). `codex-model-catalog.ts` refresca la LISTA dinámicamente para la
 * UI (`ai:getProviderModels`), con los defaults reales por modelo; un modelo
 * dinámico que no esté en esta lista igual se puede elegir, pero su effort solo
 * se resuelve en main si comparte los valores de `CODEX_EFFORT` (hoy, todos).
 */
const CODEX_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI', options: [CODEX_EFFORT] },
  { id: 'gpt-5.4', label: 'GPT-5.4', vendor: 'OpenAI', options: [CODEX_EFFORT] },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', vendor: 'OpenAI', options: [CODEX_EFFORT] },
  {
    id: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3-Codex-Spark',
    vendor: 'OpenAI',
    options: [CODEX_EFFORT],
  },
] as const satisfies readonly AiModelOption[]

export const AI_PROVIDER_CATALOG: Record<AiProviderId, AiProviderCatalogEntry> = {
  openrouter: { provider: 'openrouter', label: 'OpenRouter', models: OPENROUTER_MODELS },
  'claude-code': { provider: 'claude-code', label: 'Claude Code', models: CLAUDE_CODE_MODELS },
  codex: { provider: 'codex', label: 'Codex', models: CODEX_MODELS },
}

export const AI_PROVIDER_IDS = [
  'openrouter',
  'claude-code',
  'codex',
] as const satisfies readonly AiProviderId[]

/** Guard de runtime: valida un `unknown` (payload IPC, JSON persistido, env var) como `AiProviderId`. */
export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

/** Proveedor activo cuando no hay nada persistido en `settings.json` ni `MINERVA_AI_PROVIDER` en el entorno. */
export const DEFAULT_AI_PROVIDER: AiProviderId = 'openrouter'

/** Modelo default por proveedor, usado cuando no hay nada persistido ni `MINERVA_AI_MODEL` para ESE proveedor. */
export const DEFAULT_MODEL_BY_PROVIDER: Record<AiProviderId, string> = {
  openrouter: 'z-ai/glm-5.2',
  'claude-code': 'claude-sonnet-5',
  codex: 'gpt-5.5',
}

/**
 * Busca la entrada de catálogo (`AiModelOption`, con sus `options` si tiene)
 * de un modelo concreto dentro de un proveedor (T34) — la usan
 * `getEffectiveAiSelection`/`getAiSettingsInfo` (`main/ai/env.ts`) para saber
 * qué descriptores de opción aplican al modelo ACTIVO, y la UI (T37) para
 * pintar el selector de opciones del modelo seleccionado. `undefined` si el
 * modelo no está en el catálogo curado (p. ej. un id "avanzado" de OpenRouter
 * tecleado a mano, que no tiene opciones configurables).
 */
export function getModelOption(
  catalog: Record<AiProviderId, AiProviderCatalogEntry>,
  provider: AiProviderId,
  modelId: string,
): AiModelOption | undefined {
  return catalog[provider].models.find((model) => model.id === modelId)
}

/**
 * Resuelve el valor efectivo de un descriptor de opción (T34): si
 * `savedValue` es una de las `choices` del descriptor, gana; si no (no hay
 * nada guardado, o lo guardado no aplica al modelo ACTIVO — p. ej. `effort:
 * 'xhigh'` guardado para un modelo que no lo soporta), cae al choice marcado
 * `isDefault`; si ninguno lo está, cae al primero de la lista. Esta es la
 * "resolución robusta" que garantiza que NUNCA se le manda a un servicio
 * (T36) un valor que el modelo activo no soporta, sin importar qué haya
 * quedado persistido de una selección de modelo anterior.
 */
export function resolveOptionValue(
  descriptor: ModelOptionDescriptor,
  savedValue: string | undefined,
): string {
  if (savedValue !== undefined && descriptor.choices.some((choice) => choice.value === savedValue)) {
    return savedValue
  }
  const defaultChoice = descriptor.choices.find((choice) => choice.isDefault)
  return (defaultChoice ?? descriptor.choices[0])?.value ?? ''
}
