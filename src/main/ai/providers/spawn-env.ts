/**
 * Entorno saneado para los procesos hijo que spawnean los CLIs de IA
 * (`codex app-server` vía `./codex-app-server-client.ts`, y el binario que
 * `@anthropic-ai/claude-agent-sdk` lanza internamente vía
 * `./claude-code-service.ts`, T31). Ninguno de los dos necesita heredar
 * secretos de OTROS proveedores del proceso `main` de Electron — se
 * autentican solos contra su propia sesión (`~/.codex`/`~/.claude`) — y
 * heredarlos sin necesidad ensancha la superficie de fuga si ese binario (o
 * algo que invoque) llegara a loguear su entorno.
 *
 * Extraído a un módulo propio para no duplicar el criterio entre los dos
 * puntos de spawn (antes solo vivía en `codex-app-server-client.ts`).
 */
export const ENV_KEYS_TO_STRIP = ['OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN']

/** Copia de `process.env` sin las keys de `ENV_KEYS_TO_STRIP`. */
export function buildSanitizedSpawnEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of ENV_KEYS_TO_STRIP) {
    delete env[key]
  }
  return env
}
