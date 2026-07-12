/**
 * `GET /user` contra la API de GitHub, dado un token válido.
 *
 * Extraído de `./auth-manager.ts` (F14) para que `./gh-cli-auth.ts` (el modo
 * de acceso `gh-cli`) pueda validar un token de `gh auth token` sin importar
 * nada del OAuth Device Flow — ambos módulos comparten esta única función.
 */
import { GITHUB_USER_API_URL } from './config'
import type { UserRef } from '../../shared/types'

export async function fetchGithubUser(token: string): Promise<UserRef> {
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
