/**
 * Barrido de servers `opencode serve` HUÉRFANOS que dejó la suite.
 *
 * Por qué hace falta: cada launch de la app spawnea uno (el panel didáctico pide
 * `ai:getProviderStatus` al montarse, y eso levanta el server local incluso con
 * `MINERVA_MOCK_AI=1` — ese flag corta antes de la IA, no antes del probe de
 * CLIs) y cada uno pesa ~300 MB. La limpieza REAL vive en el proceso main
 * (`stopOpencodeServer()` en `before-quit`, ver F20); esto es la red para los
 * caminos en que main nunca llega a correrla: un test que muere por timeout, un
 * SIGKILL de Playwright al worker, un crash de Electron.
 *
 * Criterio de selección, deliberadamente estrecho — se mata solo si:
 * 1. tiene `PLAYWRIGHT_TEST=1` en su entorno (lo pone `./fixtures.ts` al lanzar
 *    la app), así la sesión de `opencode` del usuario —o la de Minerva en dev—
 *    nunca entra al barrido; y
 * 2. es huérfano (`ppid === 1`), así nunca se le toca el server a una app que
 *    todavía está viva.
 * Se mata el GRUPO (pid negativo) porque el server se spawnea `detached: true`
 * y es líder de su propio grupo.
 *
 * Solo Linux: la selección depende de `/proc/<pid>/{environ,stat}`, que macOS y
 * Windows no exponen. En otras plataformas devuelve `[]` — y quien llama lo
 * dice, en vez de fingir que barrió.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

export interface SweptServer {
  pid: number
  /** Test al que pertenecía, derivado de `MINERVA_USER_DATA_DIR` (`outputPath` lleva el nombre del test). */
  test: string
}

export const SWEEP_SUPPORTED = process.platform === 'linux'

function listOpencodePids(): number[] {
  try {
    return execFileSync('pgrep', ['-x', 'opencode'], { encoding: 'utf-8' })
      .split('\n')
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    // `pgrep` sale con 1 cuando no hay ninguna coincidencia: no es un error.
    return []
  }
}

/** `true` si el proceso quedó reparentado a init (su app ya murió). */
function isOrphan(pid: number): boolean {
  try {
    // `/proc/<pid>/stat`: el ppid es el 4º campo, pero el 2º (comm) puede traer
    // espacios entre paréntesis — se corta desde el último ')' para no
    // desalinear los índices.
    const stat = readFileSync('/proc/' + String(pid) + '/stat', 'utf-8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return fields[1] === '1'
  } catch {
    return false
  }
}

/** Entorno del proceso como pares `K=V`; `[]` si ya murió o no hay permiso. */
function readEnviron(pid: number): string[] {
  try {
    return readFileSync('/proc/' + String(pid) + '/environ', 'utf-8').split('\0')
  } catch {
    return []
  }
}

function describeTest(environ: string[]): string {
  const entry = environ.find((pair) => pair.startsWith('MINERVA_USER_DATA_DIR='))
  if (entry === undefined) return '(desconocido)'
  // `testInfo.outputPath('user-data')` ⇒ .../test-results/<slug-del-test>/user-data
  return basename(entry.slice('MINERVA_USER_DATA_DIR='.length).replace(/\/user-data$/, ''))
}

/**
 * Mata los servers huérfanos de la suite y devuelve cuáles eran. Lista vacía =
 * no había nada que barrer (el caso esperado cuando la limpieza de main funciona).
 */
export function sweepOrphanedOpencodeServers(): SweptServer[] {
  if (!SWEEP_SUPPORTED) return []

  const swept: SweptServer[] = []
  for (const pid of listOpencodePids()) {
    const environ = readEnviron(pid)
    if (!environ.includes('PLAYWRIGHT_TEST=1')) continue
    if (!isOrphan(pid)) continue

    swept.push({ pid, test: describeTest(environ) })
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Ya murió: nada que limpiar.
      }
    }
  }
  return swept
}

/** Log compartido: ruidoso a propósito — si imprime, hay un camino de limpieza saltándose y la red lo está tapando. */
export function reportSwept(where: string, swept: SweptServer[]): void {
  if (swept.length === 0) return
  console.log(
    '[' +
      where +
      '] ' +
      String(swept.length) +
      ' server(s) huérfanos de opencode matados: ' +
      swept.map((s) => s.test + ' (pid ' + String(s.pid) + ')').join(', '),
  )
}
