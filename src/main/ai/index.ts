import type { AiService } from './service'
import type { GithubService } from '../github/service'
import type { AiProviderId } from '../../shared/ai-providers'
import { MockAiService } from './mock-service'
import { ClaudeCodeAiService } from './providers/claude-code-service'
import { CodexAiService } from './providers/codex-service'
import { OpenCodeAiService } from './providers/opencode-service'
import { getCliProviderStatus } from './providers/cli-probe'
import { getEffectiveAiSelection } from './env'

export type { AiService } from './service'

/**
 * Punto único de selección de implementación de `AiService` (T9-final;
 * generalizado a multi-proveedor en T27, ver `../../shared/ai-providers.ts` y
 * `getEffectiveAiSelection` en `./env.ts`). Hasta T59 existía un cuarto caso,
 * `openrouter` (`OpenRouterAiService`, HTTP directo con `openrouter.ai`),
 * resuelto síncrono según hubiera o no `OPENROUTER_API_KEY` — eliminado por
 * decisión de Edilson: quien quiera esos modelos los usa DENTRO de OpenCode.
 *
 * `createAiService` lee el proveedor ACTIVO (settings > env >
 * default, ver `getEffectiveAiSelection`) y delega en
 * `createAiServiceForProvider` para instanciar la implementación concreta;
 * los TRES proveedores son `cli` (`./providers/registry.ts`) y comparten el
 * mismo criterio:
 * - `claude-code` (T28): `ClaudeCodeAiService` (`./providers/claude-code-service.ts`,
 *   Agent SDK oficial) SOLO si `./providers/cli-probe.ts` reporta
 *   `'authenticated'` (CLI instalado Y con sesión — best-effort, ver ese
 *   archivo). Por esto `createAiServiceForProvider`/`createAiService` son
 *   ASYNC desde T28: el probe de CLI (`getCliProviderStatus`) puede spawnear
 *   un proceso corto (`claude --version`) para confirmar que el binario existe.
 * - `codex` (T29): `CodexAiService` (`./providers/codex-service.ts`, `codex
 *   app-server` oficial vía JSON-RPC) SOLO si `getCliProviderStatus('codex')`
 *   reporta `'authenticated'` — mismo criterio y mismo espíritu que el caso
 *   `claude-code` de arriba (el probe sigue siendo el heurístico best-effort
 *   de `./providers/cli-probe.ts`, sin handshake real; T29 decidió, igual
 *   que T28, no encarecer ese hot path).
 * - `opencode` (T57): `OpenCodeAiService` (`./providers/opencode-service.ts`,
 *   server local hablado por SDK oficial) SOLO si `getCliProviderStatus('opencode')`
 *   reporta `'authenticated'` (binario+versión OK Y al menos un upstream
 *   `connected`, ver el comentario de `./providers/cli-probe.ts`).
 *
 * Cuando el proveedor activo NO puede inicializarse (CLI ausente o sin
 * sesión), el comportamiento depende del modo de GitHub:
 * - Con `MINERVA_MOCK=1` (GitHub mock, mismo criterio que
 *   `../github/index.ts`): cae a `MockAiService` con un `console.warn` — la
 *   demo/e2e sin credenciales sigue funcionando como siempre.
 * - Con GitHub REAL: se LANZA un error con la causa concreta y el remedio
 *   (configurar la key en Settings, instalar/loguear el CLI). Antes acá
 *   también se caía al mock, y como el mock solo conoce los PRs ficticios de
 *   shopwave, cualquier análisis de un PR real moría con un absurdo "Pull
 *   request no encontrado" que culpaba al PR en vez de a la configuración
 *   (visto en la 0.2.1 empaquetada en macOS). El mensaje viaja tal cual al
 *   panel didáctico (ver `../ipc/register.ts`), que ya tiene UI de error +
 *   "Reintentar".
 *
 * A propósito, esto sigue siendo INDEPENDIENTE de `MINERVA_MOCK` (el flag que
 * decide si `GithubService` es mock o real, ver `../github/index.ts`): con
 * `MINERVA_MOCK=1` + un proveedor de IA real y autenticado, se puede probar
 * la IA real analizando PRs mock (útil para desarrollo sin necesitar una
 * cuenta de GitHub real). Por eso `createAiService` recibe el `GithubService`
 * ACTIVO como dependencia en vez de crear el suyo: la implementación real le
 * pide el detalle/archivos del PR a lo que sea que `registerIpcHandlers` haya
 * instanciado (mock o real), sin enterarse de cuál es.
 */
/**
 * `true` si la capa GitHub activa es la mock — MISMO criterio que
 * `createGithubService` (`../github/index.ts`). Se lee el env directo en vez
 * de importar de ahí para no arrastrar el grafo de módulos de GitHub real
 * (Octokit, auth-manager/safeStorage) a este factory ni a sus tests.
 */
function isMockGithubMode(): boolean {
  return process.env.MINERVA_MOCK === '1'
}

/**
 * Proveedor activo no inicializable: con GitHub mock se degrada al mock de IA
 * (demo sin credenciales); con GitHub real se lanza `reason` tal cual, para
 * que el panel muestre la causa y el remedio en vez de un error engañoso.
 */
function mockFallbackOrThrow(reason: string): AiService {
  if (isMockGithubMode()) {
    console.warn('[ai] ' + reason + ' GitHub está en modo mock: usando MockAiService.')
    return new MockAiService()
  }
  throw new Error(reason)
}

/** Mensaje para un proveedor `cli` no utilizable, según lo que reportó el probe. */
function cliUnavailableReason(
  label: string,
  binary: string,
  status: 'unavailable' | 'installed',
): string {
  if (status === 'installed') {
    return (
      'El proveedor de IA activo (' +
      label +
      ') está instalado pero sin sesión iniciada. Corré «' +
      binary +
      ' login» en una terminal y reintentá, o elegí otro proveedor en Settings (engrane de la barra de título).'
    )
  }
  return (
    'No se encontró el CLI «' +
    binary +
    '» del proveedor de IA activo (' +
    label +
    ') en esta máquina. Instalalo y reintentá, o elegí otro proveedor en Settings (engrane de la barra de título).'
  )
}

async function createAiServiceForProvider(
  provider: AiProviderId,
  github: GithubService,
): Promise<AiService> {
  switch (provider) {
    case 'claude-code': {
      const status = await getCliProviderStatus('claude-code')
      if (status.status === 'authenticated') {
        return new ClaudeCodeAiService(github)
      }
      return mockFallbackOrThrow(cliUnavailableReason('Claude Code', 'claude', status.status))
    }
    case 'codex': {
      const status = await getCliProviderStatus('codex')
      if (status.status === 'authenticated') {
        return new CodexAiService(github)
      }
      return mockFallbackOrThrow(cliUnavailableReason('Codex', 'codex', status.status))
    }
    case 'opencode': {
      // El probe de opencode (T57, `./providers/cli-probe.ts`) ya encapsula
      // el criterio real de "autenticado": server local respondiendo Y ≥1
      // proveedor upstream conectado (`provider.list`). `installed` acá
      // significa "binario OK pero sin upstreams" — el remedio no es un
      // login del CLI en sí, sino conectar un proveedor DENTRO de OpenCode.
      const status = await getCliProviderStatus('opencode')
      if (status.status === 'authenticated') {
        return new OpenCodeAiService(github)
      }
      if (status.status === 'installed') {
        return mockFallbackOrThrow(
          'OpenCode está instalado pero no reporta ningún proveedor de modelos conectado. ' +
            'Corré «opencode auth login» en una terminal para conectar uno (OpenRouter, ' +
            'Anthropic, etc.) y reintentá, o elegí otro proveedor en Settings (engrane de ' +
            'la barra de título).',
        )
      }
      return mockFallbackOrThrow(
        'No se encontró el CLI «opencode» del proveedor de IA activo (OpenCode) en esta ' +
          'máquina (o su versión es más vieja que la mínima soportada). Instalalo o ' +
          'actualizalo (https://opencode.ai/docs/) y reintentá, o elegí otro proveedor en ' +
          'Settings (engrane de la barra de título).',
      )
    }
  }
}

export async function createAiService(github: GithubService): Promise<AiService> {
  const { provider } = getEffectiveAiSelection()
  return createAiServiceForProvider(provider, github)
}
