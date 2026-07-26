import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { AiSettingsInfo, AuthStatus } from '../../../../shared/types'
import { useGhAccounts } from '../../hooks/use-gh-accounts'
import { useAppStore } from '../../stores/app-store'
import { Badge } from '../ui/Badge'

interface GithubAccessSectionProps {
  info: AiSettingsInfo
  setGithubAccount: (login: string | null) => Promise<boolean>
  /** Ventana baja (F16/T81): recorta el texto explicativo largo, no los controles. */
  compact?: boolean
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
 * Feedback del `AuthStatus` vigente (T72) para el modo `gh-cli`: distingue
 * los tres estados posibles del probe de `gh`
 * (`main/auth/gh-cli-auth.ts`) con el mismo tono visual que
 * `ActiveConfigSummary`/`CliLoginGuide` (danger/warning/success).
 *
 * F18: `cli_unauthenticated` tiene DOS lecturas muy distintas según haya o no
 * una cuenta elegida a mano (`status.ghAccount`). Sin cuenta elegida el
 * consejo correcto es "corré gh auth login"; CON una cuenta elegida que ya no
 * responde, ese consejo es engañoso — el usuario puede tener otras cuentas
 * perfectamente sanas y lo que falla es la elección, no el CLI.
 */
function GhCliStatusFeedback({ status }: { status: AuthStatus }): React.JSX.Element | null {
  if (status.mode !== 'gh-cli') return null

  if (status.state === 'cli_unavailable') {
    return (
      <p className="text-xs text-danger">
        GitHub CLI no encontrado. Instalalo desde el enlace de arriba y vuelve a intentar.
      </p>
    )
  }
  if (status.state === 'cli_unauthenticated') {
    if (status.ghAccount !== undefined) {
      return (
        <p className="text-xs text-warning">
          La cuenta <span className="font-mono text-text">{status.ghAccount}</span> no tiene sesión
          válida en gh. Elegí otra cuenta abajo, o ejecuta{' '}
          <span className="font-mono text-text">gh auth login</span> para renovarla.
        </p>
      )
    }
    return (
      <p className="text-xs text-warning">
        Sin sesión de gh: ejecuta <span className="font-mono text-text">gh auth login</span> en una
        terminal.
      </p>
    )
  }
  if (status.state === 'signed_in') {
    return <p className="text-xs text-success">Autenticado como {status.user?.login} vía gh.</p>
  }
  return null
}

/** Card tipo radio del selector de cuenta; misma anatomía que las cards de modelo de `ProviderModelPanel.tsx`. */
function AccountCard({
  label,
  description,
  selected,
  busy,
  disabled,
  badge,
  onSelect,
}: {
  label: React.ReactNode
  description: string
  selected: boolean
  busy: boolean
  disabled: boolean
  badge?: React.JSX.Element | null
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-start justify-between gap-2.5 rounded-md border p-2.5 text-left transition-colors duration-150 ${
        selected ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-accent/30'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-text">{label}</span>
        <span className="text-[11px] text-muted">{description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {badge}
        {busy ? (
          <Loader2 size={14} className="mt-0.5 animate-spin text-muted" />
        ) : selected ? (
          <Badge tone="success">Activa</Badge>
        ) : null}
      </span>
    </button>
  )
}

/**
 * Sección "Acceso a GitHub" del modal de Settings (T72, F14; reescrita en F18).
 *
 * F14 la creó como un toggle OAuth ⇄ GitHub CLI. F18 retira el toggle: `gh`
 * es el único modo con UI (OAuth resultó menos conveniente en el uso real —
 * device flow manual por equipo, y bloqueado de entrada en orgs con *OAuth
 * app access restrictions*). El camino OAuth sigue existiendo detrás de
 * `MINERVA_GITHUB_ACCESS=oauth`, y cuando esa env está puesta esta sección lo
 * DICE en vez de ofrecer controles de `gh` que no aplicarían.
 *
 * El control que sí queda es el selector de CUENTA (F18): `gh` admite varias
 * a la vez y sin `--user` resuelve la suya activa, así que hasta ahora una
 * máquina con dos cuentas logueadas no dejaba elegir con cuál revisar PRs.
 * Elegir acá NO corre `gh auth switch`: la elección es local a Minerva y la
 * terminal del usuario se queda donde estaba.
 */
export function GithubAccessSection({
  info,
  setGithubAccount,
  compact = false,
}: GithubAccessSectionProps): React.JSX.Element {
  const authStatus = useAppStore((s) => s.authStatus)
  const isGhCliMode = info.githubAccessMode === 'gh-cli'
  const { accounts, loading, reload } = useGhAccounts(isGhCliMode)
  // `null` como valor legítimo ("seguir la cuenta activa de gh") obliga a un
  // sentinel aparte para "no hay nada en vuelo" — de ahí `undefined` en vez
  // del `string | null` que se está guardando.
  const [saving, setSaving] = useState<string | null | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function select(login: string | null): Promise<void> {
    if (login === info.githubAccount || saving !== undefined) return
    setSaving(login)
    setSaveError(null)
    const ok = await setGithubAccount(login)
    setSaving(undefined)
    if (!ok) setSaveError('No se pudo cambiar la cuenta. Prueba de nuevo.')
  }

  const busy = saving !== undefined
  const activeInGh = accounts.find((account) => account.active) ?? null

  if (!isGhCliMode) {
    return (
      <div className="p-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          Acceso a GitHub
        </h3>
        <p className="text-xs text-muted">
          Modo OAuth forzado por la variable de entorno{' '}
          <span className="font-mono text-text">MINERVA_GITHUB_ACCESS=oauth</span>. Iniciá sesión
          desde la barra superior. Quitá esa variable para volver al modo GitHub CLI, que es el
          predeterminado.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Acceso a GitHub</h3>
      {!compact && (
        <p className="mb-3 text-xs text-muted">
          Minerva usa la sesión de <span className="font-mono text-text">gh</span>, tu GitHub CLI:
          no hay login propio que autorizar. Las orgs enterprise que bloquean apps OAuth de
          terceros suelen aprobar GitHub CLI.
        </p>
      )}

      {info.mockGithub && (
        <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
          Modo demo (MINERVA_MOCK): los datos son simulados; este ajuste aplica al volver al modo
          real.
        </p>
      )}

      <div className="rounded-md border border-border bg-bg/40 px-2.5 py-2">
        <p className="mb-2 text-xs text-muted">
          Instala GitHub CLI desde{' '}
          <ExternalLink href="https://cli.github.com">cli.github.com</ExternalLink> y ejecuta{' '}
          <span className="font-mono text-text">gh auth login</span> en una terminal.
        </p>
        <GhCliStatusFeedback status={authStatus} />
      </div>

      <div className="mb-1.5 mt-3 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Cuenta</h4>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading || busy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:text-text disabled:opacity-50"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      <div className="space-y-2">
        {/*
          Opción "seguir a gh": SIEMPRE presente, incluso con la lista vacía
          (gh sin instalar, o su salida ilegible). Es el comportamiento previo
          a F18 y el único que funciona sin poder enumerar nada — dejarla
          fuera convertiría un fallo del listado en "no se puede elegir nada".
        */}
        <AccountCard
          label="Cuenta activa de gh"
          description={
            activeInGh !== null
              ? 'Sigue la que gh tenga activa (hoy: ' + activeInGh.login + ').'
              : 'Sigue la cuenta que gh resuelva por su cuenta.'
          }
          selected={info.githubAccount === null}
          busy={saving === null}
          disabled={busy}
          onSelect={() => void select(null)}
        />

        {accounts.map((account) => (
          <AccountCard
            key={account.login}
            label={account.login}
            description={
              account.valid
                ? 'Sesión válida en gh.'
                : 'gh reporta su token como inválido o vencido.'
            }
            selected={info.githubAccount === account.login}
            busy={saving === account.login}
            disabled={busy}
            badge={
              account.valid ? null : (
                <Badge tone="warning">Token vencido</Badge>
              )
            }
            onSelect={() => void select(account.login)}
          />
        ))}

        {/*
          Una cuenta elegida que ya no aparece en `gh` (el usuario corrió
          `gh auth logout -u ...`): sin esta card quedaría seleccionada una
          opción INVISIBLE — la de "cuenta activa" no está marcada y ninguna
          otra tampoco, así que la UI parecería no tener selección mientras el
          puente de token sigue pidiendo una cuenta que no existe.

          GATEADA POR `!loading`: mientras el primer `auth:listGhAccounts`
          está en vuelo la lista es `[]`, y sin esta guarda TODA cuenta
          elegida se pinta un instante como "Ya no está en gh" — una acusación
          falsa, y encima la de peor tono (danger) de la sección.
        */}
        {!loading &&
          info.githubAccount !== null &&
          !accounts.some((account) => account.login === info.githubAccount) && (
            <AccountCard
              label={info.githubAccount}
              description="Elegida antes, pero gh ya no la lista. Elegí otra cuenta."
              selected
              busy={saving === info.githubAccount}
              disabled={busy}
              badge={<Badge tone="danger">Ya no está en gh</Badge>}
              onSelect={() => void select(info.githubAccount)}
            />
          )}

        {!loading && accounts.length === 0 && (
          <p className="text-[11px] text-muted">
            No se pudo leer la lista de cuentas de gh. Con una sola cuenta logueada esto no cambia
            nada: Minerva usa la que gh resuelva.
          </p>
        )}
      </div>

      {saveError && <p className="mt-2 text-xs text-danger">{saveError}</p>}
    </div>
  )
}
