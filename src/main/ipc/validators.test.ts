import { describe, expect, it } from 'vitest'
import { payloadValidators } from './validators'

const validRepo = { owner: 'octocat', name: 'hello-world', fullName: 'octocat/hello-world' }

describe('payloadValidators', () => {
  describe('minerva:ping / auth:* / settings:get', () => {
    const channels = [
      'minerva:ping',
      'auth:getStatus',
      'auth:startDeviceFlow',
      'auth:signOut',
      'settings:get',
    ] as const

    it.each(channels)('acepta undefined para %s', (channel) => {
      expect(payloadValidators[channel](undefined)).toBe(true)
    })

    it.each(channels)('rechaza cualquier payload no-undefined para %s', (channel) => {
      expect(payloadValidators[channel]({})).toBe(false)
      expect(payloadValidators[channel]('x')).toBe(false)
      expect(payloadValidators[channel](null)).toBe(false)
    })
  })

  describe('github:listPullRequests', () => {
    const validate = payloadValidators['github:listPullRequests']

    it('acepta payload sin search', () => {
      expect(validate({})).toBe(true)
    })

    it('acepta search string corto', () => {
      expect(validate({ search: 'design system' })).toBe(true)
    })

    it('acepta search vacío', () => {
      expect(validate({ search: '' })).toBe(true)
    })

    it('rechaza search demasiado largo (>256)', () => {
      expect(validate({ search: 'a'.repeat(257) })).toBe(false)
    })

    it('acepta search justo en el límite (256)', () => {
      expect(validate({ search: 'a'.repeat(256) })).toBe(true)
    })

    it('rechaza search que no es string', () => {
      expect(validate({ search: 123 })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ search: 'x', evil: '__proto__' })).toBe(false)
    })

    it('rechaza arrays, null y primitivos', () => {
      expect(validate([])).toBe(false)
      expect(validate(null)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate(undefined)).toBe(false)
    })

    it('acepta cada valor de state (T50)', () => {
      expect(validate({ state: 'open' })).toBe(true)
      expect(validate({ state: 'closed' })).toBe(true)
      expect(validate({ state: 'all' })).toBe(true)
    })

    it('acepta state y search combinados', () => {
      expect(validate({ search: 'design system', state: 'all' })).toBe(true)
    })

    it('rechaza un state desconocido', () => {
      expect(validate({ state: 'merged' })).toBe(false)
      expect(validate({ state: 'OPEN' })).toBe(false)
    })

    it('rechaza state que no es string', () => {
      expect(validate({ state: 1 })).toBe(false)
    })
  })

  describe('github:markPrSeen', () => {
    const validate = payloadValidators['github:markPrSeen']
    const base = { prId: 'PR_kwDOA1', updatedAt: '2026-07-11T10:00:00Z', commentCount: 3 }

    it('acepta payload válido', () => {
      expect(validate(base)).toBe(true)
    })

    it('acepta commentCount en 0', () => {
      expect(validate({ ...base, commentCount: 0 })).toBe(true)
    })

    it('rechaza prId vacío', () => {
      expect(validate({ ...base, prId: '' })).toBe(false)
    })

    it('rechaza prId > 200 chars', () => {
      expect(validate({ ...base, prId: 'a'.repeat(201) })).toBe(false)
    })

    it('acepta prId justo en el límite (200)', () => {
      expect(validate({ ...base, prId: 'a'.repeat(200) })).toBe(true)
    })

    it('rechaza updatedAt vacío', () => {
      expect(validate({ ...base, updatedAt: '' })).toBe(false)
    })

    it('rechaza updatedAt > 64 chars', () => {
      expect(validate({ ...base, updatedAt: 'a'.repeat(65) })).toBe(false)
    })

    it('acepta updatedAt justo en el límite (64)', () => {
      expect(validate({ ...base, updatedAt: 'a'.repeat(64) })).toBe(true)
    })

    it('rechaza commentCount negativo o no entero', () => {
      expect(validate({ ...base, commentCount: -1 })).toBe(false)
      expect(validate({ ...base, commentCount: 1.5 })).toBe(false)
    })

    it('rechaza commentCount que no es number', () => {
      expect(validate({ ...base, commentCount: '3' })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ ...base, evil: true })).toBe(false)
    })

    it('rechaza payload incompleto o no-objeto', () => {
      expect(validate({ prId: 'PR_kwDOA1' })).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('github:getPullRequestDetail / Files / getCommentThreads / ai:analyzePullRequest / ai:getCachedAnalysis / ai:invalidateAnalysis / ai:getAnalysisState', () => {
    const channels = [
      'github:getPullRequestDetail',
      'github:getPullRequestFiles',
      'github:getCommentThreads',
      'ai:analyzePullRequest',
      'ai:getCachedAnalysis',
      'ai:invalidateAnalysis',
      'ai:getAnalysisState',
    ] as const

    it.each(channels)('acepta { repo, number } válido para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validRepo, number: 42 })).toBe(true)
    })

    it.each(channels)('rechaza number <= 0 para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validRepo, number: 0 })).toBe(false)
      expect(payloadValidators[channel]({ repo: validRepo, number: -1 })).toBe(false)
    })

    it.each(channels)('rechaza number no entero para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validRepo, number: 4.5 })).toBe(false)
    })

    it.each(channels)('rechaza number > 1_000_000 para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validRepo, number: 1_000_001 })).toBe(false)
    })

    it.each(channels)('rechaza repo con campos vacíos para %s', (channel) => {
      expect(
        payloadValidators[channel]({ repo: { owner: '', name: 'x', fullName: 'a/x' }, number: 1 }),
      ).toBe(false)
    })

    it.each(channels)('rechaza repo con campos > 200 chars para %s', (channel) => {
      expect(
        payloadValidators[channel]({
          repo: { owner: 'a'.repeat(201), name: 'x', fullName: 'a/x' },
          number: 1,
        }),
      ).toBe(false)
    })

    it.each(channels)('rechaza repo incompleto para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: { owner: 'a', name: 'b' }, number: 1 })).toBe(false)
    })

    it.each(channels)('rechaza payload sin repo/number para %s', (channel) => {
      expect(payloadValidators[channel]({})).toBe(false)
      expect(payloadValidators[channel](undefined)).toBe(false)
    })

    it.each(channels)('rechaza claves extra para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validRepo, number: 1, extra: 'nope' })).toBe(false)
    })
  })

  describe('github:postComment', () => {
    const validate = payloadValidators['github:postComment']
    const base = { repo: validRepo, number: 1, bodyMarkdown: 'Looks good!' }

    it('acepta comentario general mínimo', () => {
      expect(validate(base)).toBe(true)
    })

    it('acepta comentario de línea completo', () => {
      expect(
        validate({ ...base, threadId: 't1', path: 'src/index.ts', line: 10, side: 'RIGHT' }),
      ).toBe(true)
    })

    it('acepta side LEFT', () => {
      expect(validate({ ...base, side: 'LEFT' })).toBe(true)
    })

    it('rechaza bodyMarkdown vacío', () => {
      expect(validate({ ...base, bodyMarkdown: '' })).toBe(false)
    })

    it('rechaza bodyMarkdown > 65536 chars', () => {
      expect(validate({ ...base, bodyMarkdown: 'a'.repeat(65537) })).toBe(false)
    })

    it('acepta bodyMarkdown justo en el límite (65536)', () => {
      expect(validate({ ...base, bodyMarkdown: 'a'.repeat(65536) })).toBe(true)
    })

    it('rechaza threadId > 200 chars', () => {
      expect(validate({ ...base, threadId: 'a'.repeat(201) })).toBe(false)
    })

    it('rechaza path > 500 chars', () => {
      expect(validate({ ...base, path: 'a'.repeat(501) })).toBe(false)
    })

    it('rechaza line < 1 o no entero', () => {
      expect(validate({ ...base, line: 0 })).toBe(false)
      expect(validate({ ...base, line: -5 })).toBe(false)
      expect(validate({ ...base, line: 1.5 })).toBe(false)
    })

    it('rechaza side inválido', () => {
      expect(validate({ ...base, side: 'MIDDLE' })).toBe(false)
    })

    it('rechaza repo inválido', () => {
      expect(validate({ ...base, repo: { owner: 'a', name: 'b', fullName: '' } })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ ...base, injected: true })).toBe(false)
    })

    it('rechaza payload no-objeto', () => {
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('settings:setAiProvider', () => {
    const validate = payloadValidators['settings:setAiProvider']

    it('acepta cada proveedor conocido', () => {
      expect(validate({ provider: 'claude-code' })).toBe(true)
      expect(validate({ provider: 'codex' })).toBe(true)
      expect(validate({ provider: 'opencode' })).toBe(true)
    })

    it('rechaza un proveedor desconocido (incluido "openrouter", eliminado en T59)', () => {
      expect(validate({ provider: 'gemini-cli' })).toBe(false)
      expect(validate({ provider: 'openrouter' })).toBe(false)
    })

    it('rechaza provider que no es string', () => {
      expect(validate({ provider: 42 })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ provider: 'codex', evil: true })).toBe(false)
    })

    it('rechaza payload sin provider o no-objeto', () => {
      expect(validate({})).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('ai:getProviderModels', () => {
    const validate = payloadValidators['ai:getProviderModels']

    it('acepta cada proveedor conocido', () => {
      expect(validate({ provider: 'claude-code' })).toBe(true)
      expect(validate({ provider: 'codex' })).toBe(true)
      expect(validate({ provider: 'opencode' })).toBe(true)
    })

    it('rechaza un proveedor desconocido (incluido "openrouter", eliminado en T59)', () => {
      expect(validate({ provider: 'gemini-cli' })).toBe(false)
      expect(validate({ provider: 'openrouter' })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ provider: 'codex', evil: true })).toBe(false)
    })

    it('rechaza payload sin provider o no-objeto', () => {
      expect(validate({})).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('settings:setProviderModel', () => {
    const validate = payloadValidators['settings:setProviderModel']

    it('acepta un payload válido', () => {
      expect(validate({ provider: 'claude-code', model: 'claude-sonnet-5' })).toBe(true)
    })

    it('acepta un id de modelo fuera de cualquier lista curada (modo "Otro (avanzado)" de OpenCode)', () => {
      expect(validate({ provider: 'opencode', model: 'anthropic/claude-sonnet-5' })).toBe(true)
    })

    it('rechaza un proveedor desconocido', () => {
      expect(validate({ provider: 'gemini-cli', model: 'x' })).toBe(false)
    })

    it('rechaza model vacío o > 100 chars', () => {
      expect(validate({ provider: 'codex', model: '' })).toBe(false)
      expect(validate({ provider: 'codex', model: 'a'.repeat(101) })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ provider: 'codex', model: 'gpt-5.5-codex', evil: true })).toBe(false)
    })

    it('rechaza payload incompleto o no-objeto', () => {
      expect(validate({ provider: 'codex' })).toBe(false)
      expect(validate({ model: 'gpt-5.5-codex' })).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
    })
  })

  describe('settings:setModelOption', () => {
    const validate = payloadValidators['settings:setModelOption']

    it('acepta un payload válido', () => {
      expect(validate({ provider: 'codex', optionId: 'effort', value: 'high' })).toBe(true)
    })

    it('rechaza un proveedor desconocido', () => {
      expect(validate({ provider: 'gemini-cli', optionId: 'effort', value: 'high' })).toBe(false)
    })

    it('rechaza optionId vacío o > 50 chars', () => {
      expect(validate({ provider: 'codex', optionId: '', value: 'high' })).toBe(false)
      expect(validate({ provider: 'codex', optionId: 'a'.repeat(51), value: 'high' })).toBe(false)
    })

    it('acepta optionId justo en el límite (50)', () => {
      expect(validate({ provider: 'codex', optionId: 'a'.repeat(50), value: 'high' })).toBe(true)
    })

    it('rechaza value vacío o > 50 chars', () => {
      expect(validate({ provider: 'codex', optionId: 'effort', value: '' })).toBe(false)
      expect(validate({ provider: 'codex', optionId: 'effort', value: 'a'.repeat(51) })).toBe(false)
    })

    it('acepta value justo en el límite (50)', () => {
      expect(validate({ provider: 'codex', optionId: 'effort', value: 'a'.repeat(50) })).toBe(true)
    })

    it('rechaza optionId/value que no son string', () => {
      expect(validate({ provider: 'codex', optionId: 42, value: 'high' })).toBe(false)
      expect(validate({ provider: 'codex', optionId: 'effort', value: 42 })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ provider: 'codex', optionId: 'effort', value: 'high', evil: true })).toBe(
        false,
      )
    })

    it('rechaza payload incompleto o no-objeto', () => {
      expect(validate({ provider: 'codex', optionId: 'effort' })).toBe(false)
      expect(validate({ optionId: 'effort', value: 'high' })).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('settings:setGithubAccessMode', () => {
    const validate = payloadValidators['settings:setGithubAccessMode']

    it('acepta "oauth"', () => {
      expect(validate({ mode: 'oauth' })).toBe(true)
    })

    it('acepta "gh-cli"', () => {
      expect(validate({ mode: 'gh-cli' })).toBe(true)
    })

    it('rechaza un modo fuera de la whitelist', () => {
      expect(validate({ mode: 'ssh-key' })).toBe(false)
      expect(validate({ mode: 'OAuth' })).toBe(false)
    })

    it('rechaza mode que no es string', () => {
      expect(validate({ mode: 42 })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ mode: 'gh-cli', evil: true })).toBe(false)
    })

    it('rechaza payload sin mode o no-objeto', () => {
      expect(validate({})).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('window:openDidactic', () => {
    const validate = payloadValidators['window:openDidactic']
    const base = { repo: validRepo, number: 482, title: 'Add coupon support' }

    it('acepta payload válido', () => {
      expect(validate(base)).toBe(true)
    })

    it('rechaza title vacío', () => {
      expect(validate({ ...base, title: '' })).toBe(false)
    })

    it('rechaza title > 300 chars', () => {
      expect(validate({ ...base, title: 'a'.repeat(301) })).toBe(false)
    })

    it('acepta title justo en el límite (300)', () => {
      expect(validate({ ...base, title: 'a'.repeat(300) })).toBe(true)
    })

    it('rechaza title que no es string', () => {
      expect(validate({ ...base, title: 123 })).toBe(false)
    })

    it('rechaza repo inválido', () => {
      expect(validate({ ...base, repo: { owner: '', name: 'x', fullName: 'a/x' } })).toBe(false)
    })

    it('rechaza number <= 0 o no entero', () => {
      expect(validate({ ...base, number: 0 })).toBe(false)
      expect(validate({ ...base, number: 4.5 })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ ...base, evil: true })).toBe(false)
    })

    it('rechaza payload no-objeto', () => {
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })
})
