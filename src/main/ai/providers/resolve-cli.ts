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
import { accessSync, constants as fsConstants } from 'node:fs'
import { homedir, platform } from 'node:os'
import { delimiter, join } from 'node:path'

/** Los dos únicos binarios que Minerva necesita resolver (T28/T29). */
export type CliBinaryName = 'claude' | 'codex'

const cache = new Map<CliBinaryName, string | null>()

/** Directorios del `PATH` actual del proceso, en orden. */
function pathDirectories(): string[] {
  const pathEnv = process.env.PATH ?? process.env.Path ?? ''
  return pathEnv.split(delimiter).filter((entry) => entry.length > 0)
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
