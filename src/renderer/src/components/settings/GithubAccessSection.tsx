import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AiSettingsInfo, AuthStatus, GithubAccessMode } from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'
import { Badge } from '../ui/Badge'

interface GithubAccessSectionProps {
  info: AiSettingsInfo
  setGithubAccessMode: (mode: GithubAccessMode) => Promise<boolean>
}

const MODE_META: Record<GithubAccessMode, { label: string; description: string }> = {
  oauth: {
    label: 'OAuth de Minerva',
    description: 'Device flow (github.com/login/device). El modo de siempre.',
  },
  'gh-cli': {
    label: 'GitHub CLI (gh)',
    description: 'Usa la sesión de gh ya iniciada en tu terminal.',
  },
}

/** Enlace externo consistente con el resto del design system (ver `CliLoginGuide.tsx`/`Markdown.tsx`): `target="_blank"` lo intercepta el guard de links externos de main y lo abre en el navegador del sistema. */
function ExternalLink({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline underline-offset-2 hover:text-accent/80"
    >
      {children}
    </a>
  )
}

/**
 * Feedback del `AuthStatus` vigente (T72) dentro de la card de `gh-cli`,
 * SOLO cuando ese modo está activo (`info.githubAccessMode === 'gh-cli'`,
 * ver el `isActive` del llamador): distingue los tres estados posibles del
 * probe de `gh` (`main/auth/gh-cli-auth.ts`) con el mismo tono visual que
 * `ActiveConfigSummary`/`CliLoginGuide` (danger/warning/success).
 */
function GhCliStatusFeedback({ status }: { status: AuthStatus }): React.JSX.Element | null {
  if (status.mode !== 'gh-cli') return null

  if (status.state === 'cli_unavailable') {
    return (
      <p className="mt-2 text-xs text-danger">
        GitHub CLI no encontrado. Instalalo desde el enlace de arriba y vuelve a intentar.
      </p>
    )
  }
  if (status.state === 'cli_unauthenticated') {
    return (
      <p className="mt-2 text-xs text-warning">
        Sin sesión de gh: ejecuta <span className="font-mono">gh auth login</span> en una terminal.
      </p>
    )
  }
  if (status.state === 'signed_in') {
    return (
      <p className="mt-2 text-xs text-success">Autenticado como {status.user?.login} vía gh.</p>
    )
  }
  return null
}

/**
 * Sección "Acceso a GitHub" del modal de Settings (T72, F14): primera
 * sección NO relacionada a IA — orgs enterprise con *OAuth app access
 * restrictions* bloquean la OAuth App de Minerva pero sí permiten GitHub
 * CLI, así que este modo delega la autenticación a `gh` (puente de token,
 * ver `PLAN.md` § F14) sin cambiar en nada el resto del flujo.
 *
 * Dos cards tipo radio (mismo patrón visual que las cards de modelo de
 * `ProviderModelPanel.tsx`): click en la inactiva llama `setGithubAccessMode`
 * con spinner en vuelo; la activa se marca según `info.githubAccessMode`. La
 * card de `gh-cli` siempre muestra la guía compacta de instalación +
 * `gh auth login` (estilo `CliLoginGuide.tsx`) y, cuando ESE modo está
 * activo, el `AuthStatus` vigente como feedback inmediato (leído del store,
 * que `useSettings().setGithubAccessMode` ya refresca sin esperar polling).
 */
export function GithubAccessSection({
  info,
  setGithubAccessMode,
}: GithubAccessSectionProps): React.JSX.Element {
  const authStatus = useAppStore((s) => s.authStatus)
  const [switching, setSwitching] = useState<GithubAccessMode | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  async function activate(mode: GithubAccessMode): Promise<void> {
    if (mode === info.githubAccessMode || switching !== null) return
    setSwitching(mode)
    setSwitchError(null)
    const ok = await setGithubAccessMode(mode)
    setSwitching(null)
    if (!ok) setSwitchError('No se pudo cambiar el modo de acceso. Prueba de nuevo.')
  }

  const modes = Object.keys(MODE_META) as GithubAccessMode[]
  const anySwitching = switching !== null

  return (
    <div className="border-b border-border p-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Acceso a GitHub</h3>
      <p className="mb-3 text-xs text-muted">
        Algunas orgs enterprise bloquean la OAuth App de Minerva (
        <em>OAuth app access restrictions</em>). El modo GitHub CLI usa la sesión de{' '}
        <span className="font-mono text-text">gh</span>, que esas orgs sí suelen aprobar.
      </p>

      {info.mockGithub && (
        <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
          Modo demo (MINERVA_MOCK): los datos son simulados; este ajuste aplica al volver al modo
          real.
        </p>
      )}

      <div className="space-y-2">
        {modes.map((mode) => {
          const isActive = info.githubAccessMode === mode
          const isThisSwitching = switching === mode

          return (
            <div key={mode}>
              <button
                type="button"
                disabled={anySwitching}
                onClick={() => void activate(mode)}
                className={`flex w-full items-start justify-between gap-2.5 rounded-md border p-2.5 text-left transition-colors duration-150 ${
                  isActive ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-accent/30'
                } ${anySwitching ? 'opacity-60' : ''}`}
              >
                <span className="flex flex-col">
                  <span className="text-sm text-text">{MODE_META[mode].label}</span>
                  <span className="text-[11px] text-muted">{MODE_META[mode].description}</span>
                </span>
                {isThisSwitching ? (
                  <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-muted" />
                ) : isActive ? (
                  <Badge tone="success">Activo</Badge>
                ) : null}
              </button>

              {mode === 'gh-cli' && (
                <div className="mt-2 rounded-md border border-border bg-bg/40 p-2.5">
                  <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
                    <li>
                      Instala GitHub CLI desde{' '}
                      <ExternalLink href="https://cli.github.com">cli.github.com</ExternalLink>.
                    </li>
                    <li>
                      Ejecuta <span className="font-mono text-text">gh auth login</span> en una
                      terminal.
                    </li>
                  </ol>

                  {isActive && <GhCliStatusFeedback status={authStatus} />}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {switchError && <p className="mt-2 text-xs text-danger">{switchError}</p>}
    </div>
  )
}
