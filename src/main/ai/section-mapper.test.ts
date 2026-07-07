import { describe, expect, it } from 'vitest'
import { mapRawSection, mapSnippet } from './section-mapper'

describe('mapRawSection', () => {
  it('mapea una sección summary válida', () => {
    expect(mapRawSection({ kind: 'summary', markdown: '## hola' })).toEqual({
      kind: 'summary',
      markdown: '## hola',
    })
  })

  it('mapea una sección architecture válida', () => {
    expect(
      mapRawSection({ kind: 'architecture', markdown: 'texto', mermaid: 'C4Context\n  x' }),
    ).toEqual({ kind: 'architecture', markdown: 'texto', mermaid: 'C4Context\n  x' })
  })

  it('mapea una sección schema válida', () => {
    expect(mapRawSection({ kind: 'schema', markdown: 'texto', mermaid: 'erDiagram' })).toEqual({
      kind: 'schema',
      markdown: 'texto',
      mermaid: 'erDiagram',
    })
  })

  it('mapea una sección endpoint válida con snippets', () => {
    expect(
      mapRawSection({
        kind: 'endpoint',
        markdown: 'texto',
        snippets: [{ label: 'curl', language: 'curl', code: 'curl ...' }],
      }),
    ).toEqual({
      kind: 'endpoint',
      markdown: 'texto',
      snippets: [{ label: 'curl', language: 'curl', code: 'curl ...' }],
    })
  })

  it('mapea una sección setup válida con snippets bash/env', () => {
    expect(
      mapRawSection({
        kind: 'setup',
        markdown: 'texto',
        snippets: [
          { label: 'arranque-local', language: 'bash', code: 'npm install\nnpm run dev' },
          { label: 'env', language: 'env', code: 'DATABASE_URL=postgres://localhost:5432/x' },
        ],
      }),
    ).toEqual({
      kind: 'setup',
      markdown: 'texto',
      snippets: [
        { label: 'arranque-local', language: 'bash', code: 'npm install\nnpm run dev' },
        { label: 'env', language: 'env', code: 'DATABASE_URL=postgres://localhost:5432/x' },
      ],
    })
  })

  it('acepta snippets con language bash y env', () => {
    expect(mapSnippet({ label: 'x', language: 'bash', code: 'npm install' })).toEqual({
      label: 'x',
      language: 'bash',
      code: 'npm install',
    })
    expect(mapSnippet({ label: 'x', language: 'env', code: 'FOO=bar' })).toEqual({
      label: 'x',
      language: 'env',
      code: 'FOO=bar',
    })
  })

  it('sigue rechazando un language inválido', () => {
    expect(mapSnippet({ label: 'x', language: 'python', code: 'print(1)' })).toBeNull()
  })

  it('rechaza setup sin array de snippets', () => {
    expect(mapRawSection({ kind: 'setup', markdown: 'texto' })).toBeNull()
    expect(mapRawSection({ kind: 'setup', markdown: 'texto', snippets: 'x' })).toBeNull()
  })

  it('descarta snippets individuales malformados dentro de un endpoint válido', () => {
    const result = mapRawSection({
      kind: 'endpoint',
      markdown: 'texto',
      snippets: [
        { label: 'curl', language: 'curl', code: 'curl ...' },
        { label: 'bad', language: 'python', code: 'print(1)' },
        { label: 'no code', language: 'http' },
      ],
    })
    expect(result).toEqual({
      kind: 'endpoint',
      markdown: 'texto',
      snippets: [{ label: 'curl', language: 'curl', code: 'curl ...' }],
    })
  })

  it('rechaza architecture/schema sin mermaid', () => {
    expect(mapRawSection({ kind: 'architecture', markdown: 'texto' })).toBeNull()
    expect(mapRawSection({ kind: 'schema', markdown: 'texto' })).toBeNull()
  })

  it('rechaza endpoint sin snippets (o snippets no-array)', () => {
    expect(mapRawSection({ kind: 'endpoint', markdown: 'texto' })).toBeNull()
    expect(mapRawSection({ kind: 'endpoint', markdown: 'texto', snippets: 'x' })).toBeNull()
  })

  it('rechaza kind desconocido', () => {
    expect(mapRawSection({ kind: 'other', markdown: 'texto' })).toBeNull()
  })

  it('rechaza sin markdown o markdown vacío', () => {
    expect(mapRawSection({ kind: 'summary' })).toBeNull()
    expect(mapRawSection({ kind: 'summary', markdown: '   ' })).toBeNull()
  })

  it('rechaza valores que no son objetos', () => {
    expect(mapRawSection(null)).toBeNull()
    expect(mapRawSection('x')).toBeNull()
    expect(mapRawSection([1, 2])).toBeNull()
    expect(mapRawSection(42)).toBeNull()
  })
})
