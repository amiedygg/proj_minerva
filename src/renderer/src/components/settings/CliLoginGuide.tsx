import { RefreshCw } from 'lucide-react'
import type { AiProviderStatus } from '../../../../shared/types'

type CliProvider = 'claude-code' | 'codex' | 'opencode'

interface CliMeta {
  binary: string
  loginCmd: string
  installHint: string
}

/**
 * Metadata puramente de UI (comando a mostrar): la lógica real de detección
 * vive en `main` (T27; OpenCode en T57). La entrada de OpenCode acá es
 * MÍNIMA a propósito (mismo `installHint` de texto plano que el resto) — la
 * generalización completa con `installUrl` clicable (`<a target="_blank">`
 * vía `external-link-guard`) para los TRES proveedores es T60, no esta tarea.
 */
const CLI_META: Record<CliProvider, CliMeta> = {
  'claude-code': {
    binary: 'claude',
    loginCmd: 'claude login',
    installHint: 'Instalá el CLI de Claude Code (paquete @anthropic-ai/claude-code) y volvé a intentar.',
  },
  codex: {
    binary: 'codex',
    loginCmd: 'codex login',
    installHint: 'Instalá el CLI de Codex y volvé a intentar.',
  },
  opencode: {
    binary: 'opencode',
    loginCmd: 'opencode auth login',
    installHint: 'Instalá OpenCode (ver https://opencode.ai/docs/) y volvé a intentar.',
  },
}

interface CliLoginGuideProps {
  provider: CliProvider
  status: AiProviderStatus | undefined
  loading: boolean
  onRecheck: () => void
}

/**
 * Guía de login para proveedores que se autentican vía CLI externo
 * (`claude`/`codex`, T27/T30): el login sucede FUERA de Minerva (el
 * renderer no puede spawnear procesos ni el main puede leer la sesión sin
 * el handshake real de T28/T29), así que acá solo se muestra el comando a
 * correr y un botón que vuelve a pedir `ai:getProviderStatus`
 * (`use-provider-status.ts`) para reflejar el resultado.
 */
export function CliLoginGuide({
  provider,
  status,
  loading,
  onRecheck,
}: CliLoginGuideProps): React.JSX.Element {
  const meta = CLI_META[provider]
  const value = status?.status ?? 'unavailable'

  return (
    <div className="mt-2 rounded-md border border-border bg-bg/40 p-2.5">
      {value === 'unavailable' && (
        <p className="text-xs text-muted">
          No se encontró el CLI <span className="font-mono text-text">{meta.binary}</span> en tu
          PATH. {meta.installHint}
        </p>
      )}
      {value === 'installed' && (
        <p className="text-xs text-muted">
          El CLI está instalado pero no detectamos una sesión iniciada. Corré{' '}
          <span className="font-mono text-text">{meta.loginCmd}</span> en una terminal y volvé a
          comprobar acá.
        </p>
      )}
      {value === 'authenticated' && (
        <p className="text-xs text-muted">
          Conectado
          {status?.account?.plan ? ' · plan ' + status.account.plan : ''}
          {status?.account?.email ? ' · ' + status.account.email : ''}. Si cerraste sesión desde la
          terminal, volvé a comprobar para reflejarlo acá.
        </p>
      )}

      <button
        type="button"
        onClick={onRecheck}
        disabled={loading}
        className="mt-2 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-60"
      >
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        Volver a comprobar
      </button>
    </div>
  )
}
