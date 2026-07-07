/**
 * Implementación del OAuth Device Flow de GitHub con `fetch` nativo (Node 22+
 * / Electron lo trae global) — sin dependencias extra. Dos llamadas HTTP:
 *
 * 1. `requestDeviceCode()`: pide un `device_code`/`user_code` nuevos.
 * 2. `pollAccessToken(deviceCode)`: una iteración del polling contra el
 *    endpoint de token. `auth-manager.ts` es quien orquesta el loop temporal
 *    (respetando `interval`/`slow_down`) — este módulo solo hace peticiones
 *    puras, sin estado, para poder testearlo fácil si hiciera falta.
 */
import {
  GITHUB_ACCESS_TOKEN_URL,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_OAUTH_CLIENT_ID,
  GITHUB_OAUTH_SCOPE,
} from './config'

export interface DeviceCodeInfo {
  deviceCode: string
  userCode: string
  verificationUri: string
  /** Segundos entre cada poll, según GitHub (normalmente 5). */
  interval: number
  /** Segundos hasta que `deviceCode` expira. */
  expiresIn: number
}

export type PollOutcome =
  | { status: 'success'; token: string }
  | { status: 'pending' }
  | { status: 'slow_down'; intervalSeconds: number }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string }

interface DeviceCodeApiResponse {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
  expires_in: number
}

interface AccessTokenApiResponse {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
  interval?: number
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

export async function requestDeviceCode(): Promise<DeviceCodeInfo> {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      client_id: GITHUB_OAUTH_CLIENT_ID,
      scope: GITHUB_OAUTH_SCOPE,
    }),
  })

  if (!response.ok) {
    throw new Error(`No se pudo iniciar el login con GitHub (status ${response.status})`)
  }

  const data = (await response.json()) as DeviceCodeApiResponse
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval,
    expiresIn: data.expires_in,
  }
}

/**
 * Una única iteración de polling. No lanza por `authorization_pending`/
 * `slow_down`/etc: esos son resultados normales del protocolo, modelados en
 * `PollOutcome`. Solo lanza (deja que el `fetch`/parseo de JSON fallen hacia
 * arriba) ante errores de red genuinos.
 */
export async function pollAccessToken(deviceCode: string): Promise<PollOutcome> {
  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      client_id: GITHUB_OAUTH_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })

  const data = (await response.json()) as AccessTokenApiResponse

  if (data.access_token) {
    return { status: 'success', token: data.access_token }
  }

  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending' }
    case 'slow_down':
      // GitHub pide sumar (al menos) 5s al intervalo actual; devolvemos ese
      // incremento y `auth-manager` lo suma a su intervalo en curso.
      return { status: 'slow_down', intervalSeconds: 5 }
    case 'expired_token':
      return { status: 'expired' }
    case 'access_denied':
      return { status: 'denied' }
    default:
      return {
        status: 'error',
        message: data.error_description ?? data.error ?? 'Error desconocido de GitHub',
      }
  }
}
