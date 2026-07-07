import { describe, expect, it } from 'vitest'
import { buildInlineRows, buildSplitRows, parsePatch } from './diff-parser'

describe('parsePatch', () => {
  it('parses a single hunk with context, del and add lines', () => {
    const patch = [
      "@@ -10,6 +10,7 @@ import { Router } from 'express'",
      " import { CartService } from '../services/cart-service'",
      "-import { OrderRepository } from '../repositories/order-repository'",
      "+import { OrderRepository } from '../repositories/order-repository'",
      "+import { CouponService } from '../services/coupon-service'",
      ' ',
      ' export function registerCartRoutes(router: Router): void {',
    ].join('\n')

    const hunks = parsePatch(patch)
    expect(hunks).toHaveLength(1)
    const hunk = hunks[0]
    expect(hunk.oldStart).toBe(10)
    expect(hunk.oldLines).toBe(6)
    expect(hunk.newStart).toBe(10)
    expect(hunk.newLines).toBe(7)
    expect(hunk.lines).toEqual([
      {
        kind: 'context',
        oldNumber: 10,
        newNumber: 10,
        content: "import { CartService } from '../services/cart-service'",
      },
      {
        kind: 'del',
        oldNumber: 11,
        content: "import { OrderRepository } from '../repositories/order-repository'",
      },
      {
        kind: 'add',
        newNumber: 11,
        content: "import { OrderRepository } from '../repositories/order-repository'",
      },
      {
        kind: 'add',
        newNumber: 12,
        content: "import { CouponService } from '../services/coupon-service'",
      },
      { kind: 'context', oldNumber: 12, newNumber: 13, content: '' },
      {
        kind: 'context',
        oldNumber: 13,
        newNumber: 14,
        content: 'export function registerCartRoutes(router: Router): void {',
      },
    ])
  })

  it('parses multiple hunks in the same patch', () => {
    const patch = [
      '@@ -1,2 +1,2 @@',
      '-old top',
      '+new top',
      ' unchanged',
      '@@ -20,2 +20,3 @@',
      ' unchanged tail',
      '+new tail',
    ].join('\n')

    const hunks = parsePatch(patch)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].header).toBe('@@ -1,2 +1,2 @@')
    expect(hunks[1].header).toBe('@@ -20,2 +20,3 @@')
    expect(hunks[1].lines[1]).toEqual({ kind: 'add', newNumber: 21, content: 'new tail' })
  })

  it('pairs consecutive del+add blocks of unequal length', () => {
    const patch = ['@@ -1,3 +1,2 @@', '-line a', '-line b', '-line c', '+line a2'].join('\n')

    const hunks = parsePatch(patch)
    expect(hunks[0].lines.map((l) => l.kind)).toEqual(['del', 'del', 'del', 'add'])
  })

  it('handles an added-only file (no oldNumber anywhere)', () => {
    const patch = ['@@ -0,0 +1,3 @@', '+export const x = 1', '+', '+export const y = 2'].join('\n')

    const hunks = parsePatch(patch)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldLines).toBe(0)
    for (const line of hunks[0].lines) {
      expect(line.kind).toBe('add')
      expect(line.oldNumber).toBeUndefined()
    }
  })

  it('returns an empty array for a renamed file without a patch', () => {
    expect(parsePatch('')).toEqual([])
  })

  it('ignores the "\\ No newline at end of file" marker gracefully', () => {
    const patch = ['@@ -1,1 +1,1 @@', '-old', '+new', '\\ No newline at end of file'].join('\n')

    const hunks = parsePatch(patch)
    expect(hunks[0].lines).toHaveLength(2)
    expect(hunks[0].lines.map((l) => l.kind)).toEqual(['del', 'add'])
  })

  it('ignores a trailing newline artifact without adding a phantom context line', () => {
    const patch = '@@ -1,1 +1,1 @@\n-old\n+new\n'
    const hunks = parsePatch(patch)
    expect(hunks[0].lines).toHaveLength(2)
  })
})

describe('buildSplitRows', () => {
  it('puts context lines on both sides', () => {
    const hunks = parsePatch(['@@ -1,1 +1,1 @@', ' same'].join('\n'))
    const rows = buildSplitRows(hunks)
    expect(rows).toEqual([
      {
        left: { number: 1, content: 'same', kind: 'context' },
        right: { number: 1, content: 'same', kind: 'context' },
      },
    ])
  })

  it('pairs del+add blocks line by line, leaving the longer side dangling', () => {
    const hunks = parsePatch(
      ['@@ -1,3 +1,2 @@', '-del one', '-del two', '-del three', '+add one'].join('\n'),
    )
    const rows = buildSplitRows(hunks)
    expect(rows).toEqual([
      {
        left: { number: 1, content: 'del one', kind: 'del' },
        right: { number: 1, content: 'add one', kind: 'add' },
      },
      { left: { number: 2, content: 'del two', kind: 'del' }, right: undefined },
      { left: { number: 3, content: 'del three', kind: 'del' }, right: undefined },
    ])
  })

  it('leaves the left side empty for an added-only file', () => {
    const hunks = parsePatch(['@@ -0,0 +1,2 @@', '+one', '+two'].join('\n'))
    const rows = buildSplitRows(hunks)
    expect(rows).toEqual([
      { left: undefined, right: { number: 1, content: 'one', kind: 'add' } },
      { left: undefined, right: { number: 2, content: 'two', kind: 'add' } },
    ])
  })

  it('returns an empty array when there are no hunks', () => {
    expect(buildSplitRows([])).toEqual([])
  })
})

describe('buildInlineRows', () => {
  it('keeps the natural order of the patch across multiple hunks', () => {
    const hunks = parsePatch(
      ['@@ -1,2 +1,1 @@', '-old', ' same', '@@ -10,1 +9,2 @@', ' tail', '+new tail'].join('\n'),
    )
    const rows = buildInlineRows(hunks)
    expect(rows).toEqual([
      { kind: 'del', oldNumber: 1, newNumber: undefined, content: 'old' },
      { kind: 'context', oldNumber: 2, newNumber: 1, content: 'same' },
      { kind: 'context', oldNumber: 10, newNumber: 9, content: 'tail' },
      { kind: 'add', oldNumber: undefined, newNumber: 10, content: 'new tail' },
    ])
  })
})
