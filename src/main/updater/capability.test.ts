import { describe, expect, it } from 'vitest'
import { resolveUpdaterCapability, type UpdaterCapabilityInput } from './capability'

/** Todos escribibles por default; los tests que quieran "no escribible" pasan sus propios `canWrite`. */
function input(overrides: Partial<UpdaterCapabilityInput> = {}): UpdaterCapabilityInput {
  return {
    platform: 'linux',
    isPackaged: true,
    env: {},
    canWrite: () => true,
    ...overrides,
  }
}

describe('resolveUpdaterCapability', () => {
  it('MINERVA_UPDATER=off gana a TODO lo demás (kill switch)', () => {
    expect(
      resolveUpdaterCapability(input({ platform: 'win32', isPackaged: true, env: { MINERVA_UPDATER: 'off' } })),
    ).toEqual({ mode: 'disabled' })
    expect(
      resolveUpdaterCapability(
        input({
          platform: 'linux',
          isPackaged: true,
          env: { MINERVA_UPDATER: 'off', APPIMAGE: '/opt/Minerva.AppImage' },
        }),
      ),
    ).toEqual({ mode: 'disabled' })
  })

  it('!isPackaged (dev y suite e2e) -> disabled, incluso en plataformas que serían auto', () => {
    expect(resolveUpdaterCapability(input({ platform: 'win32', isPackaged: false }))).toEqual({
      mode: 'disabled',
    })
    expect(
      resolveUpdaterCapability(
        input({ platform: 'linux', isPackaged: false, env: { APPIMAGE: '/opt/Minerva.AppImage' } }),
      ),
    ).toEqual({ mode: 'disabled' })
  })

  it('darwin -> notify mac-unsigned (sin Developer ID)', () => {
    expect(resolveUpdaterCapability(input({ platform: 'darwin', isPackaged: true }))).toEqual({
      mode: 'notify',
      reason: 'mac-unsigned',
    })
  })

  it('linux sin $APPIMAGE -> notify not-appimage (linux-unpacked o paquete de distro)', () => {
    expect(resolveUpdaterCapability(input({ platform: 'linux', isPackaged: true, env: {} }))).toEqual({
      mode: 'notify',
      reason: 'not-appimage',
    })
  })

  it('linux con $APPIMAGE escribible (archivo y directorio padre) -> auto', () => {
    expect(
      resolveUpdaterCapability(
        input({
          platform: 'linux',
          isPackaged: true,
          env: { APPIMAGE: '/home/edygg/Apps/Minerva.AppImage' },
          canWrite: () => true,
        }),
      ),
    ).toEqual({ mode: 'auto' })
  })

  it('linux con $APPIMAGE pero el ARCHIVO no escribible -> notify not-writable', () => {
    expect(
      resolveUpdaterCapability(
        input({
          platform: 'linux',
          isPackaged: true,
          env: { APPIMAGE: '/opt/Minerva.AppImage' },
          canWrite: (path) => path !== '/opt/Minerva.AppImage',
        }),
      ),
    ).toEqual({ mode: 'notify', reason: 'not-writable' })
  })

  it('linux con $APPIMAGE pero el DIRECTORIO padre no escribible -> notify not-writable', () => {
    expect(
      resolveUpdaterCapability(
        input({
          platform: 'linux',
          isPackaged: true,
          env: { APPIMAGE: '/opt/Minerva.AppImage' },
          canWrite: (path) => path !== '/opt',
        }),
      ),
    ).toEqual({ mode: 'notify', reason: 'not-writable' })
  })

  it('win32 -> auto (sin firmar, funciona igual — decisión de producto)', () => {
    expect(resolveUpdaterCapability(input({ platform: 'win32', isPackaged: true }))).toEqual({ mode: 'auto' })
  })

  it('plataforma no contemplada (p. ej. freebsd) -> notify not-appimage', () => {
    expect(resolveUpdaterCapability(input({ platform: 'freebsd', isPackaged: true }))).toEqual({
      mode: 'notify',
      reason: 'not-appimage',
    })
  })
})
