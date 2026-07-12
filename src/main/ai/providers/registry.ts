/**
 * Metadata de cómo se autentica cada proveedor de IA (T27): fuente de verdad
 * para el resto de la capa de abstracción (`./cli-probe.ts`,
 * `./provider-status.ts`, `../index.ts`).
 *
 * `authKind` distingue las formas de "estar logueado" que soporta la app.
 * Hasta T59 había dos: `api-key` (OpenRouter, "autenticado" = tener la key
 * configurada) y `cli`. Decisión de Edilson (T59): Minerva deja de hablar
 * con OpenRouter directamente, así que hoy los TRES proveedores son `cli` —
 * se opera vía un binario externo (`claude`/`codex`/`opencode`) que hay que
 * encontrar en PATH y hablarle un protocolo propio (Agent SDK / JSON-RPC de
 * `codex app-server` / server HTTP local de `opencode serve`,
 * T28/T29/T55-T57). El tipo `AiAuthKind` conserva `'api-key'` como variante
 * documentada por si algún proveedor futuro volviera a necesitarla, sin
 * ninguna entrada del registro usándola hoy.
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
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    authKind: 'cli',
    binary: 'claude',
  },
  codex: { id: 'codex', label: 'Codex', authKind: 'cli', binary: 'codex' },
  opencode: { id: 'opencode', label: 'OpenCode', authKind: 'cli', binary: 'opencode' },
}
