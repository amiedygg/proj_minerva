import { describe, expect, it } from 'vitest'
import { parseDotEnv } from './env'

describe('parseDotEnv', () => {
  it('parsea pares KEY=VALUE simples', () => {
    expect(parseDotEnv('OPENROUTER_API_KEY=sk-abc123\nMINERVA_AI_MODEL=anthropic/claude-sonnet-4.5')).toEqual({
      OPENROUTER_API_KEY: 'sk-abc123',
      MINERVA_AI_MODEL: 'anthropic/claude-sonnet-4.5',
    })
  })

  it('ignora comentarios y líneas vacías', () => {
    const content = [
      '# comentario de cabecera',
      '',
      'OPENROUTER_API_KEY=sk-abc123',
      '  # otro comentario indentado',
      '',
      'MINERVA_AI_MODEL=openai/gpt-5',
    ].join('\n')

    expect(parseDotEnv(content)).toEqual({
      OPENROUTER_API_KEY: 'sk-abc123',
      MINERVA_AI_MODEL: 'openai/gpt-5',
    })
  })

  it('recorta espacios alrededor de key y value', () => {
    expect(parseDotEnv('  OPENROUTER_API_KEY  =   sk-abc123  ')).toEqual({
      OPENROUTER_API_KEY: 'sk-abc123',
    })
  })

  it('quita comillas dobles o simples que envuelven el valor completo', () => {
    expect(parseDotEnv('A="hello world"\nB=\'single quoted\'')).toEqual({
      A: 'hello world',
      B: 'single quoted',
    })
  })

  it('no quita comillas que no envuelven todo el valor', () => {
    expect(parseDotEnv('A=hello "world"')).toEqual({ A: 'hello "world"' })
  })

  it('ignora líneas sin "="', () => {
    expect(parseDotEnv('no es una línea válida\nOPENROUTER_API_KEY=sk-abc123')).toEqual({
      OPENROUTER_API_KEY: 'sk-abc123',
    })
  })

  it('permite valores vacíos', () => {
    expect(parseDotEnv('EMPTY=')).toEqual({ EMPTY: '' })
  })

  it('devuelve objeto vacío para contenido vacío', () => {
    expect(parseDotEnv('')).toEqual({})
  })

  it('un "=" dentro del valor no rompe el parseo (solo el primero separa key/value)', () => {
    expect(parseDotEnv('MINERVA_AI_MODEL=anthropic/claude-sonnet-4.5?x=1')).toEqual({
      MINERVA_AI_MODEL: 'anthropic/claude-sonnet-4.5?x=1',
    })
  })
})
