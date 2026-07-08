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

export interface AiModelOption {
  id: string
  label: string
  vendor: string
}

export interface AiProviderCatalogEntry {
  provider: AiProviderId
  label: string
  models: readonly AiModelOption[]
}

/**
 * IDs verificados contra la API pública de OpenRouter (openrouter.ai/models)
 * — no cambiar sin volver a verificar. Migrado tal cual desde el
 * `ai-models.ts` pre-T26 (T12).
 */
const OPENROUTER_MODELS = [
  { id: 'z-ai/glm-5.2', label: 'GLM 5.2', vendor: 'Z.ai' },
  { id: 'moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code', vendor: 'MoonshotAI' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', vendor: 'Google' },
  { id: 'openai/gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' },
  { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8', vendor: 'Anthropic' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', vendor: 'Anthropic' },
] as const satisfies readonly AiModelOption[]

/**
 * Alias de modelo que entiende `@anthropic-ai/claude-agent-sdk` (T28) vía
 * `query({ options: { model } })` — no son ids de vendor/model estilo
 * OpenRouter, son los nombres que el SDK/CLI de Claude Code resuelve.
 */
const CLAUDE_CODE_MODELS = [
  { id: 'claude-fable-5', label: 'Fable 5', vendor: 'Anthropic' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', vendor: 'Anthropic' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', vendor: 'Anthropic' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', vendor: 'Anthropic' },
] as const satisfies readonly AiModelOption[]

/**
 * IDs verificados contra la RPC `model/list` de `codex app-server` 0.142.x
 * (T29): el server hoy expone `gpt-5.5` (no un id "-codex" aparte). Es el
 * default del thread si no se pasa `model`. `codex-model-catalog.ts` puede
 * refrescar esta lista dinámicamente vía `model/list`, con fallback a esto.
 */
const CODEX_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' },
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
