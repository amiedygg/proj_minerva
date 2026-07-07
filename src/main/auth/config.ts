/**
 * Configuración del OAuth Device Flow de GitHub.
 *
 * El Client ID es público **por diseño**: el Device Flow (RFC 8628, tal como
 * lo implementa GitHub) no usa un client secret — cualquier app puede
 * distribuir su Client ID en código cliente/CLI/desktop sin que eso
 * comprometa la seguridad del flujo. Lo que sí debe protegerse (y nunca sale
 * de `main`) es el **token de acceso** obtenido al final del flujo, ver
 * `./token-store.ts` y `./auth-manager.ts`.
 */
export const GITHUB_OAUTH_CLIENT_ID = 'Ov23liwnuK40dnyINVGy'

/** `repo` para leer/escribir PRs y comentarios; `read:user` para GET /user. */
export const GITHUB_OAUTH_SCOPE = 'repo read:user'

export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
export const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
export const GITHUB_USER_API_URL = 'https://api.github.com/user'
