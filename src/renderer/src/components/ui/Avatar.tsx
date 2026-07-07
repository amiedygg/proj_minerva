import type { UserRef } from '../../../../shared/types'

/**
 * Círculo con inicial, coloreado de forma determinística según el login.
 * A propósito no usamos `avatarUrl` como `<img src>`: evita depender de red y
 * de relajar la CSP (`default-src 'self'`) solo para el shell visual (T3).
 */
const PALETTE = ['#14b8a6', '#6366f1', '#ec4899', '#f97316', '#22c55e', '#0ea5e9']

function colorForLogin(login: string): string {
  let hash = 0
  for (let i = 0; i < login.length; i++) {
    hash = (hash * 31 + login.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

interface AvatarProps {
  user: UserRef
  size?: number
}

export function Avatar({ user, size = 24 }: AvatarProps): React.JSX.Element {
  const initial = user.login.slice(0, 1).toUpperCase()
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        backgroundColor: colorForLogin(user.login),
      }}
      title={user.login}
    >
      {initial}
    </span>
  )
}
