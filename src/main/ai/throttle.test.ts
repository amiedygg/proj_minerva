import { describe, expect, it } from 'vitest'
import { createThrottle } from './throttle'

describe('createThrottle', () => {
  it('permite la primera llamada inmediatamente', () => {
    const now = 1000
    const throttle = createThrottle(150, () => now)
    expect(throttle.shouldRun()).toBe(true)
  })

  it('bloquea llamadas dentro del intervalo', () => {
    let now = 1000
    const throttle = createThrottle(150, () => now)
    expect(throttle.shouldRun()).toBe(true)

    now += 50
    expect(throttle.shouldRun()).toBe(false)

    now += 99
    expect(throttle.shouldRun()).toBe(false)
  })

  it('permite de nuevo justo al cumplirse el intervalo', () => {
    let now = 1000
    const throttle = createThrottle(150, () => now)
    expect(throttle.shouldRun()).toBe(true)

    now += 150
    expect(throttle.shouldRun()).toBe(true)
  })

  it('permite de nuevo bastante después del intervalo', () => {
    let now = 1000
    const throttle = createThrottle(150, () => now)
    expect(throttle.shouldRun()).toBe(true)

    now += 10_000
    expect(throttle.shouldRun()).toBe(true)
  })

  it('reset() permite una ejecución inmediata en la próxima llamada', () => {
    let now = 1000
    const throttle = createThrottle(150, () => now)
    expect(throttle.shouldRun()).toBe(true)

    now += 10
    throttle.reset()
    expect(throttle.shouldRun()).toBe(true)
  })

  it('sostiene el throttle a través de muchas llamadas seguidas', () => {
    let now = 0
    const throttle = createThrottle(150, () => now)
    const results: boolean[] = []
    for (let i = 0; i < 20; i++) {
      results.push(throttle.shouldRun())
      now += 10
    }
    // Con paso de 10ms e intervalo de 150ms, debería pasar en 0, 150 (pasos 0 y 15).
    expect(results.filter(Boolean)).toHaveLength(2)
    expect(results[0]).toBe(true)
    expect(results[15]).toBe(true)
  })
})
