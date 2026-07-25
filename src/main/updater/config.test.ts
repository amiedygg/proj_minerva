import { describe, expect, it } from 'vitest'
import { buildReleaseUrl, RELEASE_OWNER, RELEASE_REPO } from './config'

describe('buildReleaseUrl', () => {
  it('una versión semver válida produce la URL esperada con RELEASE_OWNER/RELEASE_REPO', () => {
    expect(buildReleaseUrl('0.7.0')).toBe(
      `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/tag/v0.7.0`,
    )
  })

  it('acepta prerelease y build metadata (semver completo)', () => {
    expect(buildReleaseUrl('0.7.0-rc.1')).toBe(
      `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/tag/v0.7.0-rc.1`,
    )
    expect(buildReleaseUrl('0.7.0+build.5')).toBe(
      `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/tag/v0.7.0+build.5`,
    )
  })

  it('un path traversal ("../../evil") NO produce URL', () => {
    expect(buildReleaseUrl('../../evil')).toBeUndefined()
  })

  it('inyección de shell ("1.2.3 && rm -rf") NO produce URL', () => {
    expect(buildReleaseUrl('1.2.3 && rm -rf')).toBeUndefined()
  })

  it('string vacío NO produce URL', () => {
    expect(buildReleaseUrl('')).toBeUndefined()
  })

  it('versión incompleta (sin patch) NO produce URL', () => {
    expect(buildReleaseUrl('1.2')).toBeUndefined()
  })
})
