import { describe, expect, it } from 'vitest'
import { AnalysisCache } from './analysis-cache'
import type { DidacticAnalysis, RepoRef } from '../../shared/types'

function repo(name: string): RepoRef {
  return { owner: 'shopwave', name, fullName: 'shopwave/' + name }
}

function analysis(prId: string): DidacticAnalysis {
  return {
    prId,
    sections: [{ kind: 'summary', markdown: prId }],
    generatedAt: '2026-07-06T00:00:00.000Z',
  }
}

describe('AnalysisCache', () => {
  it('devuelve null en un miss', () => {
    const cache = new AnalysisCache()
    expect(cache.get(repo('api'), 1)).toBeNull()
  })

  it('devuelve lo guardado en un hit (misma repo/number, no por identidad de objeto)', () => {
    const cache = new AnalysisCache()
    const value = analysis('shopwave/api#1')
    cache.set(repo('api'), 1, value)

    expect(cache.get({ owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }, 1)).toBe(value)
  })

  it('distingue por repo y por number: no hay colisión entre PRs distintos', () => {
    const cache = new AnalysisCache()
    cache.set(repo('api'), 1, analysis('a'))
    cache.set(repo('api'), 2, analysis('b'))
    cache.set(repo('web'), 1, analysis('c'))

    expect(cache.get(repo('api'), 1)?.prId).toBe('a')
    expect(cache.get(repo('api'), 2)?.prId).toBe('b')
    expect(cache.get(repo('web'), 1)?.prId).toBe('c')
  })

  it('invalidate borra solo la entrada de ese PR', () => {
    const cache = new AnalysisCache()
    cache.set(repo('api'), 1, analysis('a'))
    cache.set(repo('api'), 2, analysis('b'))

    cache.invalidate(repo('api'), 1)

    expect(cache.get(repo('api'), 1)).toBeNull()
    expect(cache.get(repo('api'), 2)?.prId).toBe('b')
  })

  it('invalidate en un PR sin entrada no lanza y no afecta al resto', () => {
    const cache = new AnalysisCache()
    cache.set(repo('api'), 1, analysis('a'))

    expect(() => cache.invalidate(repo('api'), 999)).not.toThrow()
    expect(cache.get(repo('api'), 1)?.prId).toBe('a')
  })

  it('set sobre una clave existente reemplaza el valor', () => {
    const cache = new AnalysisCache()
    cache.set(repo('api'), 1, analysis('old'))
    cache.set(repo('api'), 1, analysis('new'))

    expect(cache.size).toBe(1)
    expect(cache.get(repo('api'), 1)?.prId).toBe('new')
  })

  it('LRU: evict de la entrada menos recientemente usada al pasar de MAX_ENTRIES (20)', () => {
    const cache = new AnalysisCache()
    for (let i = 1; i <= 20; i++) {
      cache.set(repo('api'), i, analysis('pr' + i))
    }
    expect(cache.size).toBe(20)

    // Una entrada más: debe evictar la #1 (la más antigua, nunca releída).
    cache.set(repo('api'), 21, analysis('pr21'))

    expect(cache.size).toBe(20)
    expect(cache.get(repo('api'), 1)).toBeNull()
    expect(cache.get(repo('api'), 21)?.prId).toBe('pr21')
  })

  it('LRU: un get reciente protege esa entrada de ser evictada', () => {
    const cache = new AnalysisCache()
    for (let i = 1; i <= 20; i++) {
      cache.set(repo('api'), i, analysis('pr' + i))
    }

    // Releer #1 la vuelve "la más reciente"; #2 pasa a ser la más antigua.
    cache.get(repo('api'), 1)

    cache.set(repo('api'), 21, analysis('pr21'))

    expect(cache.get(repo('api'), 1)?.prId).toBe('pr1')
    expect(cache.get(repo('api'), 2)).toBeNull()
  })
})
