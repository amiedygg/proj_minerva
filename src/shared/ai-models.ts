/**
 * Lista curada de modelos de IA seleccionables desde Settings (T12). Vive en
 * `shared/` porque la UI (renderer) la necesita para pintar las radio-cards y
 * `main` la usa como referencia de default (`DEFAULT_AI_MODEL`) — los IDs no
 * se validan contra esta lista en el guard de IPC (`main/ipc/validators.ts`):
 * la opción "Otro (avanzado)" permite cualquier id de OpenRouter, la lista de
 * abajo es solo el camino feliz.
 *
 * IDs verificados contra la API pública de OpenRouter (openrouter.ai/models)
 * — no cambiar sin volver a verificar.
 */
export const AI_MODELS = [
  { id: 'z-ai/glm-5.2', label: 'GLM 5.2', vendor: 'Z.ai' },
  { id: 'moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code', vendor: 'MoonshotAI' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', vendor: 'Google' },
  { id: 'openai/gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' },
  { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8', vendor: 'Anthropic' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', vendor: 'Anthropic' },
] as const

export type CuratedAiModel = (typeof AI_MODELS)[number]

/** Default cuando no hay modelo persistido en settings.json ni `MINERVA_AI_MODEL` en el entorno. */
export const DEFAULT_AI_MODEL = 'z-ai/glm-5.2'
