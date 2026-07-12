/**
 * Metadata de cómo se autentica cada proveedor de IA (T27): fuente de verdad
 * para el resto de la capa de abstracción (`./cli-probe.ts`,
 * `./provider-status.ts`, `../index.ts`).
 *
 * `authKind` distingue las dos formas de "estar logueado" que soporta hoy la
 * app:
 * - `api-key`: no hay CLI ni proceso que consultar, "autenticado" es
 *   simplemente tener la key configurada (hoy solo OpenRouter, ver
 *   `../env.ts` -> `getAiEnv().openRouterApiKey`).
 * - `cli`: el proveedor se opera vía un binario externo (`claude`/`codex`/
 *   `opencode`) que hay que encontrar en PATH y hablarle un protocolo propio
 *   (Agent SDK / JSON-RPC de `codex app-server` / server HTTP local de
 *   `opencode serve`, T28/T29/T55-T57).
 *
 * No incluye la lista de modelos (eso ya vive en
 * `../../../shared/ai-providers.ts`, `AI_PROVIDER_CATALOG`, T26) — esto es
 * exclusivamente metadata de autenticación/proceso, que solo le importa a
 * `main` (el renderer nunca necesita saber el nombre del binario).
 */
import type { AiProviderId } from '../../../shared/ai-providers'
import type { CliBinaryName } from './resolve-cli'

export type AiAuthKind = 'api-key' | 'cli'

export interface AiProviderRegistryEntry {
  id: AiProviderId
  label: string
  authKind: AiAuthKind
  /** Solo presente cuando `authKind === 'cli'`: binario esperado (resuelto vía `./resolve-cli.ts`, T31). */
  binary?: CliBinaryName
}

export const AI_PROVIDER_REGISTRY: Record<AiProviderId, AiProviderRegistryEntry> = {
  openrouter: { id: 'openrouter', label: 'OpenRouter', authKind: 'api-key' },
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    authKind: 'cli',
    binary: 'claude',
  },
  codex: { id: 'codex', label: 'Codex', authKind: 'cli', binary: 'codex' },
  opencode: { id: 'opencode', label: 'OpenCode', authKind: 'cli', binary: 'opencode' },
}
