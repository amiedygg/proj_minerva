import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrWatcher } from './pr-watcher'
import type { PullRequestSummary } from '../../shared/types'

const REPO = { owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }

function makeSummary(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    id: 'shopwave/api#1',
    number: 1,
    title: 'PR de prueba',
    author: { login: 'mgarcia', avatarUrl: '' },
    repo: REPO,
    state: 'open',
    isDraft: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    headRef: 'feature/x',
    baseRef: 'main',
    headSha: 'a1',
    commentCount: 0,
    reviewDecision: null,
    ciStatus: null,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    ...overrides,
  }
}

describe('createPrWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('el primer tick exitoso solo fija el baseline, SIN broadcast', async () => {
    const list = vi.fn().mockResolvedValue([makeSummary()])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(list).toHaveBeenCalledTimes(1)
    expect(broadcast).not.toHaveBeenCalled()

    watcher.stop()
  })

  it('detecta un PR nuevo (new_pr)', async () => {
    const prA = makeSummary({ id: 'shopwave/api#1', number: 1 })
    const prB = makeSummary({ id: 'shopwave/api#2', number: 2, title: 'PR nuevo' })
    const list = vi.fn().mockResolvedValueOnce([prA]).mockResolvedValueOnce([prA, prB])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0) // baseline
    await vi.advanceTimersByTimeAsync(1000) // segundo tick

    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith({
      changes: [
        { type: 'new_pr', prId: prB.id, number: prB.number, title: prB.title, repo: prB.repo },
      ],
    })

    watcher.stop()
  })

  it('detecta cierre (open -> closed): pr_closed', async () => {
    const open = makeSummary({ state: 'open' })
    const closed = makeSummary({ state: 'closed' })
    const list = vi.fn().mockResolvedValueOnce([open]).mockResolvedValueOnce([closed])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(broadcast).toHaveBeenCalledWith({
      changes: [
        {
          type: 'pr_closed',
          prId: closed.id,
          number: closed.number,
          title: closed.title,
          repo: closed.repo,
        },
      ],
    })

    watcher.stop()
  })

  it('detecta merge (open -> merged): pr_merged', async () => {
    const open = makeSummary({ state: 'open' })
    const merged = makeSummary({ state: 'merged' })
    const list = vi.fn().mockResolvedValueOnce([open]).mockResolvedValueOnce([merged])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(broadcast).toHaveBeenCalledWith({
      changes: [
        {
          type: 'pr_merged',
          prId: merged.id,
          number: merged.number,
          title: merged.title,
          repo: merged.repo,
        },
      ],
    })

    watcher.stop()
  })

  it('detecta comentarios nuevos (mismo estado, commentCount subió): new_comments', async () => {
    const before = makeSummary({ commentCount: 1 })
    const after = makeSummary({ commentCount: 2 })
    const list = vi.fn().mockResolvedValueOnce([before]).mockResolvedValueOnce([after])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(broadcast).toHaveBeenCalledWith({
      changes: [
        {
          type: 'new_comments',
          prId: after.id,
          number: after.number,
          title: after.title,
          repo: after.repo,
        },
      ],
    })

    watcher.stop()
  })

  it('detecta cualquier otro cambio de updatedAt como "updated"', async () => {
    const before = makeSummary({ updatedAt: '2026-07-01T00:00:00.000Z' })
    const after = makeSummary({ updatedAt: '2026-07-02T00:00:00.000Z' })
    const list = vi.fn().mockResolvedValueOnce([before]).mockResolvedValueOnce([after])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(broadcast).toHaveBeenCalledWith({
      changes: [
        {
          type: 'updated',
          prId: after.id,
          number: after.number,
          title: after.title,
          repo: after.repo,
        },
      ],
    })

    watcher.stop()
  })

  it('prioridad: un cierre con comentarios nuevos reporta SOLO pr_closed, no new_comments', async () => {
    const before = makeSummary({ state: 'open', commentCount: 1 })
    const after = makeSummary({ state: 'closed', commentCount: 5 })
    const list = vi.fn().mockResolvedValueOnce([before]).mockResolvedValueOnce([after])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    const event = broadcast.mock.calls[0][0]
    expect(event.changes).toHaveLength(1)
    expect(event.changes[0].type).toBe('pr_closed')

    watcher.stop()
  })

  it('prioridad: comentarios nuevos con updatedAt distinto reporta SOLO new_comments, no updated', async () => {
    const before = makeSummary({ commentCount: 1, updatedAt: '2026-07-01T00:00:00.000Z' })
    const after = makeSummary({ commentCount: 2, updatedAt: '2026-07-02T00:00:00.000Z' })
    const list = vi.fn().mockResolvedValueOnce([before]).mockResolvedValueOnce([after])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    const event = broadcast.mock.calls[0][0]
    expect(event.changes).toHaveLength(1)
    expect(event.changes[0].type).toBe('new_comments')

    watcher.stop()
  })

  it('un PR que desaparece del listado NO genera change', async () => {
    const prA = makeSummary({ id: 'shopwave/api#1', number: 1 })
    const prB = makeSummary({ id: 'shopwave/api#2', number: 2 })
    const list = vi.fn().mockResolvedValueOnce([prA, prB]).mockResolvedValueOnce([prA])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(broadcast).not.toHaveBeenCalled()

    watcher.stop()
  })

  it('sin cambios entre ticks: no hace broadcast', async () => {
    const pr = makeSummary()
    const list = vi.fn().mockResolvedValue([pr])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(list).toHaveBeenCalledTimes(3)
    expect(broadcast).not.toHaveBeenCalled()

    watcher.stop()
  })

  describe('manejo de errores', () => {
    it('"No autenticado" hace skip silencioso y reintenta al intervalo nominal', async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce([makeSummary()])
        .mockRejectedValueOnce(new Error('No autenticado: inicia sesión con GitHub'))
        .mockResolvedValueOnce([makeSummary({ updatedAt: '2026-07-09T00:00:00.000Z' })])
      const broadcast = vi.fn()
      const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

      watcher.start()
      await vi.advanceTimersByTimeAsync(0) // baseline
      await vi.advanceTimersByTimeAsync(1000) // falla: no autenticado
      expect(list).toHaveBeenCalledTimes(2)

      // Reintenta al intervalo NOMINAL (sin backoff) tras un error de auth.
      await vi.advanceTimersByTimeAsync(1000)
      expect(list).toHaveBeenCalledTimes(3)
      expect(broadcast).toHaveBeenCalledTimes(1) // el updatedAt distinto del 3er tick

      watcher.stop()
    })

    it('rate limit duplica el intervalo efectivo (backoff x2) y resetea al próximo éxito', async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce([makeSummary()]) // baseline
        .mockRejectedValueOnce(new Error('Rate limit de GitHub alcanzado, intenta en 5 min'))
        .mockRejectedValueOnce(new Error('Rate limit de GitHub alcanzado, intenta en 5 min'))
        .mockResolvedValue([makeSummary()]) // éxito: resetea el backoff (y sigue como default)
      const broadcast = vi.fn()
      const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

      watcher.start()
      await vi.advanceTimersByTimeAsync(0) // baseline, tick #1
      expect(list).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000) // tick #2: rate limit -> backoff a 2000ms
      expect(list).toHaveBeenCalledTimes(2)

      // Con el intervalo nominal (1000ms) todavía NO debería haber un tick #3
      // (el backoff duplicó el intervalo efectivo a 2000ms).
      await vi.advanceTimersByTimeAsync(1000)
      expect(list).toHaveBeenCalledTimes(2)

      // A los 2000ms desde el tick #2, sí llega el tick #3 (otro rate limit -> backoff a 4000ms).
      await vi.advanceTimersByTimeAsync(1000)
      expect(list).toHaveBeenCalledTimes(3)

      // Backoff duplicado de nuevo: el próximo tick tarda 4000ms, no 2000ms.
      await vi.advanceTimersByTimeAsync(2000)
      expect(list).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(2000)
      expect(list).toHaveBeenCalledTimes(4) // tick #4: éxito, resetea backoff a 1000ms

      // Tras el reset, el próximo tick vuelve a tardar el intervalo NOMINAL (1000ms).
      await vi.advanceTimersByTimeAsync(1000)
      expect(list).toHaveBeenCalledTimes(5)

      watcher.stop()
    })

    it('el backoff nunca supera el tope de 15 minutos', async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce([makeSummary()])
        .mockRejectedValue(new Error('Rate limit'))
      const broadcast = vi.fn()
      // intervalMs alto para que unos pocos dobles ya superen el tope de 15min.
      const watcher = createPrWatcher({ list, broadcast, intervalMs: 600_000 }) // 10 min

      watcher.start()
      await vi.advanceTimersByTimeAsync(0) // baseline
      await vi.advanceTimersByTimeAsync(600_000) // tick #2: rate limit -> backoff a 1_200_000 (20min), tope 900_000
      expect(list).toHaveBeenCalledTimes(2)

      // Con el tope de 15min (900_000ms), el próximo tick debería llegar ahí, no a los 1_200_000.
      await vi.advanceTimersByTimeAsync(900_000)
      expect(list).toHaveBeenCalledTimes(3)

      watcher.stop()
    })

    it('cualquier otro error se loguea y el timer sigue re-armándose', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const list = vi
        .fn()
        .mockResolvedValueOnce([makeSummary()])
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce([makeSummary({ updatedAt: '2026-07-09T00:00:00.000Z' })])
      const broadcast = vi.fn()
      const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

      watcher.start()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000) // error genérico
      expect(consoleErrorSpy).toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000) // el timer sigue vivo
      expect(list).toHaveBeenCalledTimes(3)
      expect(broadcast).toHaveBeenCalledTimes(1)

      consoleErrorSpy.mockRestore()
      watcher.stop()
    })
  })

  it('stop() detiene el timer: no hay más ticks después', async () => {
    const list = vi.fn().mockResolvedValue([makeSummary()])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(list).toHaveBeenCalledTimes(1)

    watcher.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('start() es idempotente: llamarlo dos veces no duplica el timer', async () => {
    const list = vi.fn().mockResolvedValue([makeSummary()])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(list).toHaveBeenCalledTimes(1)

    watcher.stop()
  })

  it('sin intervalMs explícito, usa el default de 60000ms', async () => {
    const list = vi.fn().mockResolvedValue([makeSummary()])
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(list).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(59_999)
    expect(list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(list).toHaveBeenCalledTimes(2)

    watcher.stop()
  })
})
