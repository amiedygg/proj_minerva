/**
 * Máquina de estados del login de GitHub, en memoria del proceso `main`.
 *
 * `signed_out` -> `device_pending` (esperando que el usuario ingrese el
 * código en github.com/login/device) -> `signed_in` (con el `UserRef`
 * obtenido de `GET /user`). Esta máquina modela SOLO el modo `oauth` — desde
 * F14 (v0.5.0) `AuthManager` es CONSCIENTE del modo de acceso a GitHub
 * (`settingsStore.getGithubAccessMode()`) y en modo `gh-cli` delega TODO a
 * `./gh-cli-auth.ts` (`ghCliAuth`), que tiene su propio mapeo de estados
 * (`cli_unavailable`/`cli_unauthenticated`/`signed_in`) — ver el comentario de
 * cabecera de ese módulo.
 *
 * El token vive únicamente en el campo privado `token` del estado interno de
 * esta clase (modo oauth) o en `ghCliAuth` (modo gh-cli): `getStatus()` (lo
 * que sale por IPC como `AuthStatus`) nunca lo incluye. Solo `getToken()` lo
 * expone, y solo dentro de `main` (lo consume `RealGithubService` vía el
 * provider que le pasa `src/main/github/index.ts`).
 *
 * No hay canales IPC de eventos push en esta tarea: el renderer se entera del
 * avance del polling repitiendo `auth:getStatus` (ver `useAuth` en el
 * renderer). Esta clase solo necesita, entonces, que `getStatus()` siempre
 * refleje el estado más reciente — el polling real hacia GitHub lo maneja
 * ella misma con `setTimeout` recursivo, independiente de que el renderer
 * esté o no preguntando. F14: `getStatus()` pasa a ASYNC (delega a
 * `ghCliAuth.getStatus()`, que spawnea `gh` on-demand) — el `handle()` de IPC
 * ya soporta promesas, así que el canal `auth:getStatus` no cambia de forma.
 */
import { pollAccessToken, requestDeviceCode, type PollOutcome } from './device-flow'
import { ghCliAuth } from './gh-cli-auth'
import { fetchGithubUser } from './github-user'
import { clearToken, loadToken, saveToken } from './token-store'
import { settingsStore } from '../settings/store'
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

  /**
   * F14: en modo `gh-cli` delega ÍNTEGRAMENTE a `ghCliAuth.getStatus()` (su
   * propio cache TTL + single-flight, ver `./gh-cli-auth.ts`) — la máquina de
   * estados oauth de esta clase queda "congelada" pero intacta en memoria
   * (`this.state`), lista para reflejarse de nuevo apenas el usuario vuelva a
   * modo `oauth` desde Settings.
   */
  getStatus(): Promise<AuthStatus> {
    if (settingsStore.getGithubAccessMode() === 'gh-cli') {
      return ghCliAuth.getStatus()
    }
    return Promise.resolve(this.oauthStatus())
  }

  /** Estado oauth puro, sin considerar el modo — lo reutilizan `startDeviceFlow`/`signOut` para construir su respuesta cuando el modo activo SÍ es oauth. */
  private oauthStatus(): AuthStatus {
    switch (this.state.kind) {
      case 'signed_out':
        return { mode: 'oauth', state: 'signed_out' }
      case 'device_pending':
        return {
          mode: 'oauth',
          state: 'device_pending',
          deviceCode: {
            userCode: this.state.userCode,
            verificationUri: this.state.verificationUri,
            expiresAt: this.state.expiresAt,
          },
        }
      case 'signed_in':
        return { mode: 'oauth', state: 'signed_in', user: this.state.user }
    }
  }

  /**
   * Único punto por el que el token cruza la frontera main -> resto de main.
   * Nunca sale por IPC. F14: en modo `gh-cli` delega a `ghCliAuth.getTokenSync()`
   * (snapshot en memoria del último probe, sin spawnear nada — sigue siendo
   * SÍNCRONO porque lo consume `RealGithubService` en cada request).
   */
  getToken(): string | null {
    if (settingsStore.getGithubAccessMode() === 'gh-cli') {
      return ghCliAuth.getTokenSync()
    }
    return this.state.kind === 'signed_in' ? this.state.token : null
  }

  /**
   * Idempotente: si ya hay un device flow en curso, devuelve ese mismo código
   * en vez de pedir uno nuevo. F14: NO-OP en modo `gh-cli` — el login en ese
   * modo es cosa de `gh auth login` en una terminal, jamás de un Device Flow
   * de Minerva; devuelve el status gh actual sin tocar la máquina de estados
   * oauth.
   */
  async startDeviceFlow(): Promise<AuthStatus> {
    if (settingsStore.getGithubAccessMode() === 'gh-cli') {
      return ghCliAuth.getStatus()
    }

    if (this.state.kind === 'device_pending') {
      return this.oauthStatus()
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
    return this.oauthStatus()
  }

  /**
   * F14: NO-OP en modo `gh-cli` — "cerrar sesión" en ese modo no tiene
   * sentido (la sesión es de `gh`, no de Minerva) y JAMÁS debe correr
   * `gh auth logout` (es la sesión del usuario, ajena a esta app) ni
   * `clearToken()` del token OAuth persistido (volver a modo oauth debe
   * restaurar esa sesión tal cual estaba). Devuelve el status gh actual.
   */
  async signOut(): Promise<AuthStatus> {
    if (settingsStore.getGithubAccessMode() === 'gh-cli') {
      return ghCliAuth.getStatus()
    }

    if (this.state.kind === 'device_pending' && this.state.pollTimer !== null) {
      clearTimeout(this.state.pollTimer)
    }
    clearToken()
    this.state = { kind: 'signed_out' }
    return this.oauthStatus()
  }

  /*
   * F14 tenía acá `cancelDeviceFlowIfPending()`: cancelaba un device flow a
   * mitad de camino cuando el usuario cambiaba a `gh-cli` desde Settings, para
   * que ese polling no quedara huérfano. F18 lo retira junto con el toggle —
   * el modo se decide en el arranque de main desde el entorno, así que ya no
   * existe el evento "cambio de modo con un login oauth en vuelo" que ese
   * método venía a limpiar.
   */

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
