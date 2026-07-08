/**
 * Alias delgado (T26): antes de esta tarea este archivo ERA la lista plana de
 * modelos de IA de toda la app (T12); ahora que hay N proveedores
 * (`ai-providers.ts`: OpenRouter / Claude Code / Codex), esos IDs de acá
 * siguen aplicando SOLO a OpenRouter — el catálogo real (los tres
 * proveedores) vive en `ai-providers.ts`. Se conserva este re-export para no
 * romper imports existentes (`ModelPicker.tsx`, `main/ai/env.ts`); no agregar
 * nada nuevo acá.
 */
import { AI_PROVIDER_CATALOG, DEFAULT_MODEL_BY_PROVIDER } from './ai-providers'

export const AI_MODELS = AI_PROVIDER_CATALOG.openrouter.models

export type CuratedAiModel = (typeof AI_MODELS)[number]

/** Default cuando no hay modelo persistido en settings.json ni `MINERVA_AI_MODEL` en el entorno (proveedor OpenRouter). */
export const DEFAULT_AI_MODEL = DEFAULT_MODEL_BY_PROVIDER.openrouter
