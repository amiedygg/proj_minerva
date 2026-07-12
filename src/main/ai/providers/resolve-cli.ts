/**
 * Resuelve la ruta absoluta de los CLIs oficiales `claude`/`codex` en la
 * máquina del usuario (T31). Existe porque Minerva NO bundlea esos binarios
 * (decisión de arquitectura de § F7: usar la sesión ya autenticada del CLI
 * del sistema en vez de reimplementar OAuth) — pero una app GUI lanzada
 * desde el launcher de escritorio (icono, `.desktop`, Finder, el menú de
 * Windows) NO siempre hereda el `PATH` completo de una terminal interactiva:
 * a `process.env.PATH` le pueden faltar entradas que el shell agrega vía
 * `.bashrc`/`.zshrc`/`.profile` (que un `.desktop`/AppImage no ejecuta). Sin
 * esto, el probe de `./cli-probe.ts` reportaría "no disponible" y los
 * servicios reales (`./claude-code-service.ts`, `./codex-app-server-client.ts`)
 * fallarían con ENOENT aunque el usuario tenga el CLI instalado y logueado.
 *
 * Estrategia: buscar primero en `process.env.PATH` (cubre el caso común de
 * quien lanza Minerva desde una terminal, y respeta cualquier override del
 * usuario) y, si no aparece ahí, en un set de ubicaciones comunes donde estos
 * CLIs suelen instalarse (gestores de paquetes de Node, instaladores
 * oficiales, etc.) que una terminal interactiva sí vería pero un proceso GUI
 * podría no heredar.
 *
 * Cachea el resultado (por binario, en memoria del proceso main): resolver
 * implica tocar el filesystem por cada directorio candidato, y este módulo se
 * llama desde el probe de estado (`./cli-probe.ts`, que ya se invoca on-demand
 * desde Settings) y desde cada análisis real — no hace falta repetir la
 * búsqueda en disco en cada llamada, el usuario no reinstala el CLI a mitad
 * de una sesión de la app. `clearCliPathCache()` existe solo para tests.
 *
 * NOTA: las rutas de Windows (`%APPDATA%\npm`, extensiones `.cmd`/`.exe`/
 * `.ps1`) son best-effort — no se pudieron probar contra un Windows real en
 * este sandbox (Linux). `X_OK` de `fs.accessSync` en Windows no verifica un
 * bit de "ejecutable" real (NTFS no tiene ese concepto) y degrada a un chequeo
 * de existencia, que alcanza para el propósito de este resolver.
 */
import { accessSync, constants as fsConstants, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { delimiter, join } from 'node:path'

/** Los binarios que Minerva necesita resolver (T28/T29/T55: `opencode`, mismas ubicaciones). */
export type CliBinaryName = 'claude' | 'codex' | 'opencode'

const cache = new Map<CliBinaryName, string | null>()

/** Directorios del `PATH` actual del proceso, en orden. */
function pathDirectories(): string[] {
  const pathEnv = process.env.PATH ?? process.env.Path ?? ''
  return pathEnv.split(delimiter).filter((entry) => entry.length > 0)
}

/**
 * Orden descendente por versión semver-ish (`v22.11.0`, `22.4.1`): los
 * directorios de un version manager se prueban de la versión más nueva a la
 * más vieja — si el CLI está instalado en varias, gana la más reciente, que
 * es la que un `nvm use` típico dejaría activa en la terminal del usuario.
 */
function compareVersionsDesc(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const [a0 = 0, a1 = 0, a2 = 0] = parse(a)
  const [b0 = 0, b1 = 0, b2 = 0] = parse(b)
  return b0 - a0 || b1 - a1 || b2 - a2
}

/** Subdirectorios de `dir` ordenados como versiones descendentes; `[]` si `dir` no existe o no se puede leer. */
function listVersionsDesc(dir: string): string[] {
  try {
    return readdirSync(dir).sort(compareVersionsDesc)
  } catch {
    return []
  }
}

/**
 * Directorios `bin` de los version managers de Node más comunes (nvm, fnm,
 * volta, asdf). Un CLI instalado con `npm install -g` bajo nvm/fnm vive en
 * `<versions>/<vX.Y.Z>/bin`, ruta que SOLO entra al PATH cuando el shell
 * ejecuta el hook del manager (`nvm.sh`, `fnm env`) — un proceso GUI lanzado
 * desde Finder/launcher nunca lo corre, así que sin esto el probe reportaba
 * "no disponible" con el CLI perfectamente instalado (visto en macOS con la
 * 0.2.1 empaquetada). Se respetan los overrides `NVM_DIR`/`FNM_DIR` si el
 * proceso los trae.
 */
function nodeVersionManagerDirectories(home: string): string[] {
  const dirs = [join(home, '.volta', 'bin'), join(home, '.asdf', 'shims')]

  const nvmVersions = join(process.env.NVM_DIR ?? join(home, '.nvm'), 'versions', 'node')
  for (const version of listVersionsDesc(nvmVersions)) {
    dirs.push(join(nvmVersions, version, 'bin'))
  }

  // fnm: instalación oficial en ~/.local/share/fnm (XDG) o ~/.fnm (legado).
  const fnmBases = [process.env.FNM_DIR ?? join(home, '.local', 'share', 'fnm'), join(home, '.fnm')]
  for (const base of fnmBases) {
    const fnmVersions = join(base, 'node-versions')
    for (const version of listVersionsDesc(fnmVersions)) {
      dirs.push(join(fnmVersions, version, 'installation', 'bin'))
    }
  }

  return dirs
}

/**
 * Ubicaciones comunes donde `claude`/`codex` (o cualquier CLI de Node/Bun/Deno
 * instalado por el usuario, o un paquete de un gestor del sistema) suelen
 * vivir, que un proceso GUI podría no tener en su `PATH` heredado.
 */
function commonInstallDirectories(): string[] {
  const home = homedir()

  if (platform() === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return [
      join(appData, 'npm'),
      join(localAppData, 'Programs', 'claude'),
      join(home, '.local', 'bin'),
    ]
  }

  const dirs = [
    join(home, '.local', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.deno', 'bin'),
  ]

  if (platform() === 'darwin') {
    // Homebrew en Apple Silicon instala bajo /opt/homebrew, no /usr/local.
    dirs.push('/opt/homebrew/bin')
  }

  dirs.push(...nodeVersionManagerDirectories(home))

  return dirs
}

/** Nombres de archivo candidatos para un binario dado, según plataforma (Windows agrega extensiones ejecutables comunes). */
function candidateFileNames(binary: CliBinaryName): string[] {
  if (platform() !== 'win32') return [binary]
  return [binary + '.cmd', binary + '.exe', binary + '.ps1', binary]
}

/** `true` si el archivo existe y es (o se puede tratar como) ejecutable. */
function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Busca `binary` en `PATH` y, si no aparece, en las ubicaciones comunes de
 * `commonInstallDirectories()`. Devuelve la primera ruta existente y
 * ejecutable, o `null` si no se encontró en ningún lado. Resultado cacheado
 * en memoria (ver comentario del módulo).
 */
export function resolveCliPath(binary: CliBinaryName): string | null {
  const cached = cache.get(binary)
  if (cached !== undefined) return cached

  const directories = [...pathDirectories(), ...commonInstallDirectories()]
  const fileNames = candidateFileNames(binary)

  for (const dir of directories) {
    for (const fileName of fileNames) {
      const candidate = join(dir, fileName)
      if (isExecutableFile(candidate)) {
        cache.set(binary, candidate)
        return candidate
      }
    }
  }

  cache.set(binary, null)
  return null
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a tocar el filesystem en vez de servir la cache. */
export function clearCliPathCache(): void {
  cache.clear()
}
