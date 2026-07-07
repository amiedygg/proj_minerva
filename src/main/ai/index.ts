import type { AiService } from './service'
import type { GithubService } from '../github/service'
import { MockAiService } from './mock-service'
import { OpenRouterAiService } from './openrouter-service'
import { getAiEnv } from './env'

export type { AiService } from './service'

/**
 * Punto único de selección de implementación de `AiService`.
 *
 * Real (`OpenRouterAiService`) si hay `OPENROUTER_API_KEY` disponible (vía
 * `process.env` o el `.env` de la raíz del proyecto en dev, ver `./env.ts`);
 * mock (`MockAiService`) como fallback si no hay key, para poder seguir
 * desarrollando/probando la UI sin credenciales.
 *
 * A propósito, esto es INDEPENDIENTE de `MINERVA_MOCK` (el flag que decide si
 * `GithubService` es mock o real, ver `../github/index.ts`): con
 * `MINERVA_MOCK=1` + `OPENROUTER_API_KEY` presente, se puede probar la IA
 * real analizando PRs mock (útil para desarrollo sin necesitar una cuenta de
 * GitHub real). Por eso `createAiService` recibe el `GithubService` ACTIVO
 * como dependencia en vez de crear el suyo: `OpenRouterAiService` le pide el
 * detalle/archivos del PR a lo que sea que `registerIpcHandlers` haya
 * instanciado (mock o real), sin enterarse de cuál es.
 */
export function createAiService(github: GithubService): AiService {
  const { openRouterApiKey } = getAiEnv()
  if (openRouterApiKey) {
    return new OpenRouterAiService(github)
  }
  return new MockAiService()
}
