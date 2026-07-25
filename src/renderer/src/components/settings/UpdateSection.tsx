import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useUpdater } from '../../hooks/use-updater'
import type { UpdaterStatus } from '../../../../shared/types'

type UnsupportedReason = Extract<UpdaterStatus, { phase: 'unsupported' }>['reason']

/** Texto honesto de por qué ESTA instalación no puede auto-actualizarse (T93). */
const UNSUPPORTED_REASON_TEXT: Record<UnsupportedReason, string> = {
  'mac-unsigned': 'la versión de macOS todavía no está firmada',
  'not-appimage': 'esta instalación no es la AppImage oficial',
  'not-writable': 'Minerva no puede escribir sobre su propio archivo',
}

function formatCheckedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

interface UpdateSectionProps {
  /** Ventana baja (F16): recorta el texto explicativo, no los controles — mismo criterio que `GithubAccessSection`. */
  compact?: boolean
}

/**
 * Sección "Actualizaciones" del modal de Settings (T93, F17).
 *
 * Cubre los 8 `phase` de `UpdaterStatus` (`shared/types.ts`):
 * - `disabled` (y mientras el estado inicial no cargó): el componente
 *   devuelve `null` — no se monta NADA, es el estado real en dev y en TODA la
 *   suite e2e (el core real vive en `main/updater/`, T91).
 * - `idle`/`checking`/`error` comparten una fila: mensaje a la izquierda
 *   (según fase) + un único botón a la derecha que cambia de label
 *   ("Buscar actualizaciones" / deshabilitado mientras chequea / "Reintentar"
 *   en error) — evita duplicar tres botones casi iguales.
 * - `available`: CTA "Descargar (130 MB)" — la descarga NUNCA arranca sola,
 *   necesita este click (decisión de producto, ver `PLAN.md` § F17).
 * - `downloading`: barra de progreso con `percent`, sin botón.
 * - `downloaded`: el mensaje PRINCIPAL es que se instala sola al salir;
 *   "Reiniciar ahora" es a propósito un link-button subordinado (texto
 *   pequeño subrayado), no el CTA — invertir esa jerarquía contradice la
 *   decisión de producto ("instalar al salir" es el camino por defecto).
 * - `unsupported`: nunca un botón de descarga; si el feed ya encontró una
 *   versión más nueva (`available`), se ofrece "Ver la release"
 *   (`openReleasePage`, que construye la URL en MAIN — nunca desde el feed).
 *
 * Las release notes NO se renderizan en ningún estado (vienen de GitHub como
 * HTML crudo — ver la frontera de seguridad del `PLAN.md`/`CLAUDE.md`): el
 * único camino a esa información es `openReleasePage()`.
 */
export function UpdateSection({ compact = false }: UpdateSectionProps): React.JSX.Element | null {
  const { status, version, error, check, download, quitAndInstall, openReleasePage } = useUpdater()
  const [restarting, setRestarting] = useState(false)
  const [openingRelease, setOpeningRelease] = useState(false)

  if (status === null || status.phase === 'disabled') return null

  const checking = status.phase === 'checking'
  const showCheckRow = status.phase === 'idle' || status.phase === 'checking' || status.phase === 'error'

  async function handleRestart(): Promise<void> {
    setRestarting(true)
    await quitAndInstall()
    setRestarting(false)
  }

  async function handleOpenRelease(): Promise<void> {
    setOpeningRelease(true)
    await openReleasePage()
    setOpeningRelease(false)
  }

  return (
    <div className="border-t border-border p-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Actualizaciones</h3>
      {!compact && (
        <p className="mb-3 text-xs text-muted">
          Minerva revisa si hay una versión nueva; la descarga solo empieza con tu confirmación.
        </p>
      )}

      <p className="text-xs text-muted">
        Versión instalada: <span className="font-mono text-text">{version ?? '…'}</span>
      </p>

      <div className="mt-2.5 space-y-2">
        {showCheckRow && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              {status.phase === 'idle' && (
                <>
                  <p className="text-sm text-text">Estás al día.</p>
                  {status.lastCheckedAt && (
                    <p className="text-[11px] text-muted">
                      Último chequeo: {formatCheckedAt(status.lastCheckedAt)}
                    </p>
                  )}
                </>
              )}
              {status.phase === 'checking' && (
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <Loader2 size={13} className="animate-spin" />
                  Buscando actualizaciones…
                </p>
              )}
              {status.phase === 'error' && (
                <>
                  <p className="text-xs text-danger">{status.message}</p>
                  {status.lastCheckedAt && (
                    <p className="text-[11px] text-muted">
                      Último chequeo con éxito: {formatCheckedAt(status.lastCheckedAt)}
                    </p>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              disabled={checking}
              onClick={() => void check()}
              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-text transition-colors duration-150 hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status.phase === 'error' ? 'Reintentar' : 'Buscar actualizaciones'}
            </button>
          </div>
        )}

        {status.phase === 'available' && (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm text-text">Disponible v{status.info.version}</p>
            <button
              type="button"
              onClick={() => void download()}
              className="shrink-0 rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20"
            >
              Descargar (130 MB)
            </button>
          </div>
        )}

        {status.phase === 'downloading' && (
          <div>
            <p className="mb-1 truncate text-sm text-text">Descargando v{status.info.version}…</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-150"
                style={{ width: Math.max(0, Math.min(100, status.percent)) + '%' }}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted">{Math.round(status.percent)}%</p>
          </div>
        )}

        {status.phase === 'downloaded' && (
          <div>
            <p className="text-sm text-text">Se instalará al salir de Minerva.</p>
            <button
              type="button"
              disabled={restarting}
              onClick={() => void handleRestart()}
              className="mt-1 text-[11px] text-muted underline decoration-dotted transition-colors duration-150 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reiniciar ahora
            </button>
          </div>
        )}

        {/*
          `unsupported` va en COLUMNA, no en fila: con dos botones al lado, el
          texto explicativo se estrangula a una tira de ~35px en el modal
          angosto (visto en captura). Acá el mensaje manda y los controles van
          debajo.
        */}
        {status.phase === 'unsupported' && (
          <div className="flex flex-col gap-2">
            <p className="min-w-0 text-xs text-muted">
              Esta instalación no puede actualizarse sola:{' '}
              {UNSUPPORTED_REASON_TEXT[status.reason]}.
            </p>
            {/*
              El chequeo manual TAMBIÉN vive acá: `unsupported` sigue
              consultando el feed (solo no descarga ni instala), así que sin
              este botón no habría forma de pedirlo a mano y habría que esperar
              al tick del scheduler para que aparezca "Ver la release".
            */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void check()}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-text transition-colors duration-150 hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Buscar actualizaciones
              </button>
              {status.available && (
                <button
                  type="button"
                  disabled={openingRelease}
                  onClick={() => void handleOpenRelease()}
                  className="rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ver la release
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
