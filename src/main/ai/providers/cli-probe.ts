/**
 * Detección NO BLOQUEANTE del estado de los CLIs `claude`/`codex`/`opencode`
 * (T27, `opencode` en T57): ¿está el binario en PATH? y, si sí, ¿hay indicios
 * de sesión iniciada?
 *
 * Nunca cuelga el arranque de la app: cada spawn tiene un timeout corto
 * (`PROBE_TIMEOUT_MS`) y CUALQUIER falla (binario ausente -> ENOENT, timeout,
 * exit code distinto de 0) degrada a `'unavailable'` en vez de lanzar. Este
 * módulo se llama on-demand desde el canal IPC `ai:getProviderStatus`
 * (`./provider-status.ts`), nunca desde `whenReady` — por eso además cachea
 * el resultado con un TTL corto (`PROBE_CACHE_TTL_MS`): abrir la pantalla de
 * Settings varias veces seguidas no debe spawnear un proceso por cada
 * render.
 *
 * Login: BEST-EFFORT en esta tarea. No hay handshake real con el CLI todavía
 * (eso es T28 para Claude Code vía `@anthropic-ai/claude-agent-sdk`
 * -`query().initializationResult().account`- y T29 para Codex vía la RPC
 * `account/read` de `codex app-server`) así que acá solo se infiere de la
 * existencia de un depósito de credenciales conocido:
 * - Claude Code: `~/.claude/.credentials.json` (guarda `claudeAiOauth` con
 *   `subscriptionType`, que se expone como `account.plan`; no hay email en
 *   ese archivo). En macOS el CLI NO usa ese archivo: guarda la sesión en el
 *   Keychain del sistema (ítem `Claude Code-credentials`) — sin el fallback
 *   de `hasClaudeKeychainCredentials()` una Mac autenticada caía SIEMPRE a
 *   `'installed'` ("no detectamos sesión", F14.1). El fallback solo consulta
 *   la EXISTENCIA del ítem (`security find-generic-password` sin `-w`: exit
 *   code, jamás el secreto).
 * - Codex: `~/.codex/auth.json` (se verifica solo su existencia; el formato
 *   no es estable/documentado así que no se parsea contenido).
 *
 * TODO(T28/T29): reemplazar esta heurística de archivo por el handshake real
 * de cada proveedor (que además confirma que la sesión sigue siendo VÁLIDA,
 * no solo que en algún momento se hizo login) y por `account.email` real.
 *
 * DECISIÓN (T28): se evaluó el handshake real para Claude Code —
 * `query({ prompt, options: { maxTurns: 0, abortController } })
 *   .initializationResult()` resuelve `{ account: { email, subscriptionType,
 * ... } }` ANTES de que el modelo genere nada (se puede abortar el
 * controller apenas resuelve, sin pagar ni un token) — es técnicamente
 * viable y da `email` real, algo que el archivo de credenciales no tiene. Se
 * DEJA sin implementar por ahora: este probe corre en un hot path barato (se
 * llama on-demand desde la pantalla de Settings, con un TTL de cache de solo
 * `PROBE_CACHE_TTL_MS`) donde hoy un `execFile('claude', ['--version'])` con
 * timeout corto alcanza; reemplazarlo por un spawn completo del Agent SDK
 * (que a su vez lanza su propio binario node/nativo y hace un handshake
 * JSON por stdio) es notablemente más pesado y agrega una superficie de
 * fallo nueva (parsing de `initializationResult`, limpieza del proceso
 * fantasma, condiciones de carrera si el abort llega antes de que la
 * promesa de init se resuelva) que conviene introducir con sus propios
 * tests dedicados en vez de mezclarla con esta tarea. `ClaudeCodeAiService`
 * (`./claude-code-service.ts`, T28) SÍ usa el Agent SDK real para el
 * análisis en sí — este archivo solo decide si vale la pena intentarlo.
 *
 * RESOLUCIÓN DEL BINARIO (T31): antes este probe hacía `execFile(binary,
 * ['--version'])` confiando en que `child_process.execFile` resolviera
 * `binary` contra el `PATH` del proceso. En una app GUI empaquetada (lanzada
 * desde un `.desktop`/AppImage, no desde una terminal) ese `PATH` puede venir
 * recortado y no incluir donde el usuario instaló `claude`/`codex` — el
 * probe reportaría "no disponible" con el CLI perfectamente instalado. Ahora
 * `./resolve-cli.ts` busca la ruta absoluta (PATH + ubicaciones comunes) y
 * ese resultado es lo que se pasa a `execFile`; si no se encuentra en NINGÚN
 * lado se reporta `'unavailable'` directamente, sin intentar spawnear nada.
 *
 * OPENCODE (T57): criterio DISTINTO al resto de los CLI — no hay archivo de
 * credenciales que inspeccionar, "autenticado" es que el server local
 * (`./opencode-runtime.ts`, T55, singleton lazy) reporte al menos un upstream
 * en `connected` vía `provider.list()` (criterio t3code, forma verificada
 * EMPÍRICAMENTE contra el binario real 1.17.18 — ver el comentario de
 * `./opencode-model-catalog.ts`). `unavailable` si el binario no está o
 * `checkOpencodeVersion()` reporta una versión por debajo del mínimo;
 * `installed` si el binario+versión están OK pero no se pudo confirmar ningún
 * upstream conectado (server que no reporta ninguno, o que no llegó a
 * responder a tiempo — nunca se interpreta como "no instalado", el binario sí
 * está ahí). Jamás arranca el server si el binario ni existe.
 */
import { createOpencodeClient } from '@opencode-ai/sdk'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import type { AiProviderId } from '../../../shared/ai-providers'
import type { AiAccountInfo, AiProviderStatus } from '../../../shared/types'
import { checkOpencodeVersion, getOpencodeServer } from './opencode-runtime'
import { AI_PROVIDER_REGISTRY } from './registry'
import { clearCliPathCache, resolveCliPath } from './resolve-cli'

/**
 * Tiempo máximo que se espera a `<binario> --version` antes de degradar a
 * "no disponible". 4s y no menos: en macOS el PRIMER exec de un binario
 * recién escrito (el auto-update de `claude` crea uno nuevo en cada versión)
 * paga el escaneo de Gatekeeper/XProtect, que puede superar con holgura los
 * 1.5s que se usaban antes (F14.1) — y el probe era quién pagaba ese primer
 * exec, reportando "no disponible" con el CLI perfectamente instalado.
 */
const PROBE_TIMEOUT_MS = 4000
/** TTL de la cache: evita spawnear un proceso por cada llamada IPC seguida. */
const PROBE_CACHE_TTL_MS = 5000

/** `true` si `path --version` respondió dentro del timeout con exit code 0; `false` para CUALQUIER otro caso (ENOENT, timeout, exit != 0). `path` ya viene resuelto a una ruta absoluta por `resolveCliPath`. */
function isBinaryAvailable(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile(path, ['--version'], { timeout: PROBE_TIMEOUT_MS }, (error) => {
        resolve(!error)
      })
    } catch {
      // Defensa extra: `execFile` normalmente reporta ENOENT vía el callback
      // de error, nunca lanzando, pero un binario/entorno raro no debería
      // poder tumbar el probe.
      resolve(false)
    }
  })
}

/** Nombre del ítem del Keychain de macOS donde `claude login` guarda la sesión OAuth. */
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'

/**
 * `true` si el Keychain de macOS tiene el ítem de sesión de Claude Code.
 * SOLO existencia: sin `-w` el secreto nunca llega a stdout, y la salida se
 * descarta entera — lo único que se mira es el exit code (0 = existe).
 * Cualquier falla (no-darwin, `security` ausente, timeout, keychain
 * bloqueado) degrada a `false`, igual que el resto del probe.
 */
function hasClaudeKeychainCredentials(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile(
        'security',
        ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE],
        { timeout: PROBE_TIMEOUT_MS },
        (error) => resolve(!error),
      )
    } catch {
      resolve(false)
    }
  })
}

async function readClaudeAccount(): Promise<AiAccountInfo | null> {
  try {
    const path = join(homedir(), '.claude', '.credentials.json')
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(raw) as { claudeAiOauth?: { subscriptionType?: string } }
      if (parsed.claudeAiOauth) return { plan: parsed.claudeAiOauth.subscriptionType }
    }
  } catch {
    // Archivo no-JSON o forma inesperada: no es fatal — todavía puede haber
    // sesión en el Keychain (abajo).
  }

  // macOS: el CLI guarda la sesión en el Keychain, no en el archivo (ver el
  // comentario del módulo). Sin plan/email que exhibir: solo "hay sesión".
  if (platform() === 'darwin' && (await hasClaudeKeychainCredentials())) return {}

  return null
}

function readCodexAccount(): AiAccountInfo | null {
  try {
    const path = join(homedir(), '.codex', 'auth.json')
    if (!existsSync(path)) return null
    // Solo se verifica existencia: el formato de este archivo no es estable
    // ni está documentado, así que no se parsea contenido (T29 lo reemplaza
    // por la RPC `account/read`, que sí trae forma conocida).
    return {}
  } catch {
    return null
  }
}

function readAccountFor(provider: AiProviderId): Promise<AiAccountInfo | null> {
  switch (provider) {
    case 'claude-code':
      return readClaudeAccount()
    case 'codex':
      return Promise.resolve(readCodexAccount())
    case 'opencode':
      // OpenCode SÍ es un CLI pero su probe (`probeOpencode`) nunca llega a
      // `readAccountFor` — no hay archivo de credenciales que leer, el
      // criterio es el server local (ver el comentario del módulo). Este
      // caso queda solo por exhaustividad.
      return Promise.resolve(null)
  }
}

/**
 * Describe cuántos/cuáles upstreams reporta `connected` como texto corto para
 * `account.plan` (no hay un campo dedicado en `AiAccountInfo`, ver
 * `shared/types.ts`) — la UI (`ProviderPicker`/`CliLoginGuide`) ya sabe pintar
 * `account.plan` junto al badge de estado.
 */
function describeConnectedUpstreams(connected: readonly string[]): string {
  const count = connected.length
  return String(count) + (count === 1 ? ' upstream' : ' upstreams') + ': ' + connected.join(', ')
}

/** Probe específico de OpenCode (T57) — ver el comentario grande del módulo. */
async function probeOpencode(): Promise<AiProviderStatus> {
  const resolvedPath = resolveCliPath('opencode')
  if (resolvedPath === null) return { status: 'unavailable', reason: 'not-found' }

  const version = await checkOpencodeVersion()
  if (!version.ok) return { status: 'unavailable', reason: 'probe-failed', resolvedPath }

  try {
    const server = await getOpencodeServer()
    const client = createOpencodeClient({ baseUrl: server.url })
    const result = await client.provider.list()
    const connected = result.data?.connected ?? []
    if (connected.length === 0) return { status: 'installed' }

    return { status: 'authenticated', account: { plan: describeConnectedUpstreams(connected) } }
  } catch {
    // El server no arrancó a tiempo, o `provider.list` no respondió: el
    // binario y la versión SÍ están OK (ya se confirmó arriba), así que se
    // reporta "instalado" en vez de "no disponible" — no hay indicio de que
    // el CLI en sí sea el problema.
    return { status: 'installed' }
  }
}

async function probeCli(provider: AiProviderId): Promise<AiProviderStatus> {
  const entry = AI_PROVIDER_REGISTRY[provider]
  if (entry.authKind !== 'cli' || !entry.binary) {
    throw new Error('probeCli llamado con un proveedor que no es CLI: ' + provider)
  }

  if (provider === 'opencode') return probeOpencode()

  const resolvedPath = resolveCliPath(entry.binary)
  if (resolvedPath === null) return { status: 'unavailable', reason: 'not-found' }

  const available = await isBinaryAvailable(resolvedPath)
  if (!available) {
    // La ruta positiva cacheada pudo quedar vieja (el auto-update del CLI
    // reemplaza el binario): se invalida para que el próximo intento
    // re-resuelva contra el disco en vez de reprobar la misma ruta muerta.
    clearCliPathCache(entry.binary)
    return { status: 'unavailable', reason: 'probe-failed', resolvedPath }
  }

  const account = await readAccountFor(provider)
  if (account) return { status: 'authenticated', account }

  return { status: 'installed' }
}

interface CacheEntry {
  expiresAt: number
  promise: Promise<AiProviderStatus>
}

const cache = new Map<AiProviderId, CacheEntry>()

/**
 * Estado de un proveedor `cli` (`claude-code`/`codex`/`opencode`), cacheado
 * con TTL corto. Un rechazo (no debería ocurrir, `probeCli` no lanza salvo
 * mal uso) no se cachea, para no dejar el proveedor "atascado" en error. Para
 * OpenCode este TTL corto conviene con el singleton lazy del server
 * (`./opencode-runtime.ts`, T55): el arranque en frío es caro, pero una vez
 * arriba las llamadas siguientes (aunque hayan expirado este TTL) reusan el
 * mismo proceso.
 */
export function getCliProviderStatus(provider: AiProviderId): Promise<AiProviderStatus> {
  const now = Date.now()
  const cached = cache.get(provider)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = probeCli(provider)
  cache.set(provider, { expiresAt: now + PROBE_CACHE_TTL_MS, promise })
  promise.catch(() => cache.delete(provider))
  return promise
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a spawnear en vez de servir la cache. */
export function clearCliProbeCache(): void {
  cache.clear()
}
