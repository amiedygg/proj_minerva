import { describe, expect, it } from 'vitest'
import { delimiter } from 'node:path'
import { extractMarkedPath, mergePaths } from './shell-path'

describe('extractMarkedPath', () => {
  it('extrae el PATH entre los marcadores aunque haya ruido alrededor', () => {
    const noisy =
      'Welcome to zsh!\nlast login: ...\n__MINERVA_PATH_START__/usr/bin:/home/u/.local/bin__MINERVA_PATH_END__\n'
    expect(extractMarkedPath(noisy)).toBe('/usr/bin:/home/u/.local/bin')
  })

  it('devuelve null si faltan los marcadores', () => {
    expect(extractMarkedPath('/usr/bin:/bin')).toBeNull()
    expect(extractMarkedPath('__MINERVA_PATH_START__/usr/bin (sin cierre)')).toBeNull()
  })

  it('devuelve null si el PATH marcado está vacío', () => {
    expect(extractMarkedPath('__MINERVA_PATH_START____MINERVA_PATH_END__')).toBeNull()
  })
})

describe('mergePaths', () => {
  const p = (...dirs: string[]) => dirs.join(delimiter)

  it('agrega las rutas nuevas al final, conservando el orden y prioridad de las actuales', () => {
    const current = p('/usr/bin', '/bin')
    const captured = p('/usr/bin', '/home/u/.local/bin', '/opt/homebrew/bin')
    expect(mergePaths(current, captured)).toBe(
      p('/usr/bin', '/bin', '/home/u/.local/bin', '/opt/homebrew/bin'),
    )
  })

  it('no duplica rutas que ya están presentes', () => {
    const current = p('/usr/bin', '/home/u/.local/bin')
    const captured = p('/home/u/.local/bin', '/usr/bin')
    expect(mergePaths(current, captured)).toBe(current)
  })

  it('devuelve el PATH actual sin cambios si no hay nada que añadir', () => {
    const current = p('/usr/bin', '/bin')
    expect(mergePaths(current, current)).toBe(current)
  })

  it('nunca reemplaza ni reordena las rutas heredadas (append-only)', () => {
    const current = p('/first', '/second')
    const captured = p('/second', '/third', '/first')
    expect(mergePaths(current, captured)).toBe(p('/first', '/second', '/third'))
  })

  it('ignora segmentos vacíos del PATH capturado', () => {
    const current = '/usr/bin'
    const captured = delimiter + '/new' + delimiter + delimiter
    expect(mergePaths(current, captured)).toBe(p('/usr/bin', '/new'))
  })
})
