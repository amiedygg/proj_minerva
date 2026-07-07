/**
 * Máquina de estados del login de GitHub, en memoria del proceso `main`.
 *
 * `signed_out` -> `device_pending` (esperando que el usuario ingrese el
 * código en github.com/login/device) -> `signed_in` (con el `UserRef`
 * obtenido de `GET /user`).
 *
 * El token vive únicamente en el campo privado `token` del estado interno de
 * esta clase: `getStatus()` (lo que sale por IPC como `AuthStatus`) nunca lo
 * incluye. Solo `getToken()` lo expone, y solo dentro de `main` (lo consume
 * `RealGithubService` vía el provider que le pasa `src/main/github/index.ts`).
 *
 * No hay canales IPC de eventos push en esta tarea: el renderer se entera del
 * avance del polling repitiendo `auth:getStatus` (ver `useAuth` en el
 * renderer). Esta clase solo necesita, entonces, que `getStatus()` siempre
 * refleje el estado más reciente — el polling real hacia GitHub lo maneja
 * ella misma con `setTimeout` recursivo, independiente de que el renderer
 * esté o no preguntando.
 */
import { GITHUB_USER_API_URL } from './config'
import { pollAccessToken, requestDeviceCode, type PollOutcome } from './device-flow'
import { clearToken, loadToken, saveToken } from './token-store'
import type { AuthStatus, UserRef } from '../../shared/types'

interface SignedOutState {
  kind: 'signed_out'
}

interface DevicePendingState {
  kind: 'device_pending'
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: string
  /** Milisegundos actuales entre polls; crece si GitHub pide `slow_down`. */
  intervalMs: number
  pollTimer: ReturnType<typeof setTimeout> | null
}

interface SignedInState {
  kind: 'signed_in'
  token: string
  user: UserRef
}

type InternalState = SignedOutState | DevicePendingState | SignedInState

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function fetchGithubUser(token: string): Promise<UserRef> {
  const response = await fetch(GITHUB_USER_API_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!response.ok) {
    throw new Error(`GET /user respondió ${response.status}`)
  }
  const data = (await response.json()) as { login: string; avatar_url: string }
  return { login: data.login, avatarUrl: data.avatar_url }
}

export class AuthManager {
  private state: InternalState = { kind: 'signed_out' }

  /**
   * Llamar una vez al arrancar la app, antes de registrar los handlers IPC.
   * Intenta cargar un token persistido y validarlo contra GitHub; si no hay
   * token, o el token ya no sirve (revocado/expirado), termina en
   * `signed_out` (y borra el archivo persistido en el segundo caso).
   */
  async init(): Promise<void> {
    const token = loadToken()
    if (!token) return

    try {
      const user = await fetchGithubUser(token)
      this.state = { kind: 'signed_in', token, user }
    } catch (error) {
      console.warn('[auth] token persistido ya no es válido, se descarta:', toErrorMessage(error))
      clearToken()
      this.state = { kind: 'signed_out' }
    }
  }

  getStatus(): AuthStatus {
    switch (this.state.kind) {
      case 'signed_out':
        return { state: 'signed_out' }
      case 'device_pending':
        return {
          state: 'device_pending',
          deviceCode: {
            userCode: this.state.userCode,
            verificationUri: this.state.verificationUri,
            expiresAt: this.state.expiresAt,
          },
        }
      case 'signed_in':
        return { state: 'signed_in', user: this.state.user }
    }
  }

  /** Único punto por el que el token cruza la frontera main -> resto de main. Nunca sale por IPC. */
  getToken(): string | null {
    return this.state.kind === 'signed_in' ? this.state.token : null
  }

  /** Idempotente: si ya hay un device flow en curso, devuelve ese mismo código en vez de pedir uno nuevo. */
  async startDeviceFlow(): Promise<AuthStatus> {
    if (this.state.kind === 'device_pending') {
      return this.getStatus()
    }

    const info = await requestDeviceCode()
    const pending: DevicePendingState = {
      kind: 'device_pending',
      deviceCode: info.deviceCode,
      userCode: info.userCode,
      verificationUri: info.verificationUri,
      expiresAt: new Date(Date.now() + info.expiresIn * 1000).toISOString(),
      intervalMs: Math.max(1, info.interval) * 1000,
      pollTimer: null,
    }
    this.state = pending
    this.schedulePoll(pending)
    return this.getStatus()
  }

  signOut(): AuthStatus {
    if (this.state.kind === 'device_pending' && this.state.pollTimer !== null) {
      clearTimeout(this.state.pollTimer)
    }
    clearToken()
    this.state = { kind: 'signed_out' }
    return this.getStatus()
  }

  private schedulePoll(pending: DevicePendingState): void {
    pending.pollTimer = setTimeout(() => {
      void this.poll(pending)
    }, pending.intervalMs)
  }

  /**
   * `pending` es el objeto de estado capturado cuando se programó este poll:
   * si `this.state` ya no es ese mismo objeto (el usuario cerró sesión, o se
   * arrancó otro device flow) se compara por identidad y se aborta sin tocar
   * nada — evita que un poll "viejo" pise un estado más nuevo.
   */
  private async poll(pending: DevicePendingState): Promise<void> {
    if ((this.state as InternalState) !== pending) return

    let outcome: PollOutcome
    try {
      outcome = await pollAccessToken(pending.deviceCode)
    } catch (error) {
      console.warn('[auth] error de red durante el polling de device flow:', toErrorMessage(error))
      if ((this.state as InternalState) === pending) this.schedulePoll(pending)
      return
    }

    if ((this.state as InternalState) !== pending) return

    switch (outcome.status) {
      case 'pending':
        this.schedulePoll(pending)
        return
      case 'slow_down':
        pending.intervalMs += outcome.intervalSeconds * 1000
        this.schedulePoll(pending)
        return
      case 'expired':
      case 'denied':
        this.state = { kind: 'signed_out' }
        return
      case 'error':
        console.error('[auth] GitHub devolvió un error durante el polling:', outcome.message)
        this.state = { kind: 'signed_out' }
        return
      case 'success': {
        try {
          const user = await fetchGithubUser(outcome.token)
          saveToken(outcome.token)
          this.state = { kind: 'signed_in', token: outcome.token, user }
        } catch (error) {
          console.error('[auth] login exitoso pero GET /user falló:', toErrorMessage(error))
          this.state = { kind: 'signed_out' }
        }
        return
      }
    }
  }
}

/** Instancia única del proceso `main`; `ipc/handlers.ts` y `github/index.ts` la comparten. */
export const authManager = new AuthManager()
