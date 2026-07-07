import { describe, expect, it } from 'vitest'
import { buildDidacticHash, parseDidacticHash } from './didactic-route'

describe('didactic-route', () => {
  const repo = { owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }

  it('round-trips owner/name/number/title through build+parse', () => {
    const hash = buildDidacticHash(repo, 482, 'Add coupon support')
    const parsed = parseDidacticHash('#' + hash)
    expect(parsed).toEqual({ repo, number: 482, title: 'Add coupon support' })
  })

  it('parses without a leading #, since main passes it bare to loadFile', () => {
    const hash = buildDidacticHash(repo, 1, 'x')
    expect(parseDidacticHash(hash)).toEqual({ repo, number: 1, title: 'x' })
  })

  it('handles special characters in owner/name/title', () => {
    const weirdRepo = { owner: 'a b', name: 'c/d', fullName: 'a b/c/d' }
    const hash = buildDidacticHash(weirdRepo, 7, 'Título con ñ & <script>')
    const parsed = parseDidacticHash('#' + hash)
    expect(parsed).toEqual({ repo: weirdRepo, number: 7, title: 'Título con ñ & <script>' })
  })

  it('returns null for a hash without the didactic/ prefix', () => {
    expect(parseDidacticHash('#/some/other/route')).toBeNull()
    expect(parseDidacticHash('')).toBeNull()
  })

  it('returns null for a malformed didactic hash (missing number)', () => {
    expect(parseDidacticHash('#didactic/owner/name')).toBeNull()
    expect(parseDidacticHash('#didactic/owner/name/not-a-number')).toBeNull()
    expect(parseDidacticHash('#didactic/owner/name/0')).toBeNull()
  })

  it('parses fine without a title in the query', () => {
    expect(parseDidacticHash('#didactic/owner/name/5')).toEqual({
      repo: { owner: 'owner', name: 'name', fullName: 'owner/name' },
      number: 5,
      title: null,
    })
  })
})
