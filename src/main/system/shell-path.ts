/**
 * Hidratación del `PATH` desde el shell de login del usuario (T33).
 *
 * Problema: una app GUI de Electron lanzada desde el LAUNCHER del sistema (menú
 * de aplicaciones, dock, .desktop) NO hereda el `PATH` del shell interactivo
 * del usuario — solo un `PATH` mínimo del sistema. Eso rompe `resolve-cli.ts`
 * cuando el `claude`/`codex` del usuario vive en una ruta que solo su shell
 * conoce (gestores de versiones tipo nvm/volta/fnm, prefijos de npm/pnpm/bun
 * globales, rutas custom del `.zshrc`/`.bashrc`). En cambio, lanzada desde una
 * terminal (`npm run dev`), el `PATH` ya viene completo y esto es un no-op.
 *
 * Solución (misma técnica que t3code): al arrancar, lanzar el shell de LOGIN
 * del usuario, leer su `$PATH` real, y FUSIONARLO en `process.env.PATH` (append
 * sin duplicar, nunca reemplazando lo heredado). Así, cuando `resolve-cli.ts`
 * busca en `process.env.PATH`, ya ve las rutas del shell del usuario — además
 * de la lista de ubicaciones comunes que ese módulo prueba como fallback.
 *
 * Solo POSIX (Linux/macOS): en Windows las apps GUI heredan el `PATH` de
 * usuario+sistema del registro (que ya incluye los prefijos globales de npm),
 * así que ahí no se hace nada y `resolve-cli.ts` cubre el resto con sus rutas
 * conocidas. macOS suma un fallback vía `launchctl getenv PATH` (el mecanismo
 * por el que `launchd` propaga el PATH a la sesión gráfica).
 *
 * NUNCA lanza: cualquier fallo (shell ausente, timeout, salida ilegible) deja
 * el `PATH` como estaba. Con timeout corto para no colgar el arranque.
 */
import { execFileSync } from 'node:child_process'
import { delimiter } from 'node:path'

/** Tope de espera al shell de login: si tarda más, se abandona sin tocar el PATH. */
const LOGIN_SHELL_TIMEOUT_MS = 2500

/**
 * Marcadores que envuelven el `$PATH` en la salida del shell: un shell de login
 * interactivo puede imprimir ruido (motd, banners, secuencias del prompt) antes
 * o después, así que se aísla el valor entre marcadores en vez de confiar en
 * que la salida sea SOLO el PATH.
 */
const START = '__MINERVA_PATH_START__'
const END = '__MINERVA_PATH_END__'

/** Extrae el PATH entre los marcadores de una salida potencialmente ruidosa; `null` si no aparecen. */
export function extractMarkedPath(output: string): string | null {
  const start = output.indexOf(START)
  const end = output.indexOf(END, start + START.length)
  if (start === -1 || end === -1) return null
  const value = output.slice(start + START.length, end)
  return value.length > 0 ? value : null
}

/**
 * Fusiona los directorios de `capturedPath` que falten en `currentPath`,
 * APPEND-eándolos (las rutas ya presentes conservan su prioridad; nunca se
 * reemplaza ni reordena lo que ya había). Devuelve el PATH resultante, o
 * `currentPath` sin cambios si no hay nada que añadir.
 */
export function mergePaths(currentPath: string, capturedPath: string): string {
  const current = currentPath.split(delimiter).filter(Boolean)
  const seen = new Set(current)
  const additions = capturedPath.split(delimiter).filter((dir) => dir.length > 0 && !seen.has(dir))
  if (additions.length === 0) return currentPath
  return [...current, ...additions].join(delimiter)
}

/** Corre el shell de login del usuario y devuelve su `$PATH` real, o `null` ante cualquier fallo. */
function capturePathFromLoginShell(): string | null {
  const shell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : '/bin/bash'
  // `-l` (login) + `-i` (interactive) para que el shell cargue el perfil
  // completo del usuario (.zprofile/.bash_profile/.zshrc...); `-c` con
  // `command printf` (builtin, evita alias) envuelto en los marcadores.
  const script = 'command printf "' + START + '%s' + END + '" "$PATH"'
  try {
    const output = execFileSync(shell, ['-ilc', script], {
      timeout: LOGIN_SHELL_TIMEOUT_MS,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return extractMarkedPath(output)
  } catch {
    return null
  }
}

/** Fallback de macOS: el PATH que `launchd` expone a la sesión gráfica. */
function capturePathFromLaunchctl(): string | null {
  try {
    const output = execFileSync('launchctl', ['getenv', 'PATH'], {
      timeout: LOGIN_SHELL_TIMEOUT_MS,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const value = output.trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Enriquecer `process.env.PATH` con el PATH del shell de login del usuario.
 * Idempotente y sin efectos si ya se corre con un PATH completo (dev desde
 * terminal). No-op en Windows. Llamar UNA vez al arrancar, ANTES de cualquier
 * resolución de binarios (`resolve-cli.ts` cachea, así que debe ver el PATH ya
 * enriquecido).
 */
export function hydratePathFromLoginShell(): void {
  if (process.platform === 'win32') return

  const captured =
    capturePathFromLoginShell() ??
    (process.platform === 'darwin' ? capturePathFromLaunchctl() : null)
  if (!captured) return

  const current = process.env.PATH ?? ''
  const merged = mergePaths(current, captured)
  if (merged !== current) {
    process.env.PATH = merged
  }
}
