import type { AiProviderId } from '../../../../shared/ai-providers'
import type { AiProviderStatus, AiSettingsInfo } from '../../../../shared/types'
import { resolveModelHintLabels } from '../../lib/model-labels'
import { Badge } from '../ui/Badge'

const STATUS_LABEL: Record<AiProviderStatus['status'], string> = {
  unavailable: 'No disponible',
  installed: 'Instalado, sin sesión',
  authenticated: 'Conectado',
}

const STATUS_TONE: Record<AiProviderStatus['status'], 'neutral' | 'warning' | 'success'> = {
  unavailable: 'neutral',
  installed: 'warning',
  authenticated: 'success',
}

interface ActiveConfigSummaryProps {
  info: AiSettingsInfo
  statuses: Record<AiProviderId, AiProviderStatus> | null
}

/**
 * Strip "En uso" (T62, F12): enuncia sin ambigüedad qué proveedor, modelo y
 * nivel de razonamiento están ACTIVOS antes de que el usuario toque nada más
 * del modal. Diagnóstico que motivó esto (ver `PLAN.md` § F12): con el
 * diseño viejo (`ProviderPicker`/`ModelPicker`, radios) nada lo enunciaba —
 * el proveedor se deducía de qué radio estaba marcada y el modelo activo se
 * confundía con el borrador todavía sin "Guardar".
 *
 * `SettingsModal` lo monta FIJO entre el header y el área con scroll (fuera
 * del `overflow-y-auto`): cambiar de tab para mirar otro proveedor nunca
 * debe hacer perder de vista qué está activo de verdad.
 */
export function ActiveConfigSummary({ info, statuses }: ActiveConfigSummaryProps): React.JSX.Element {
  const status = statuses?.[info.provider]
  const { effortLabel } = resolveModelHintLabels(
    info.catalog,
    info.provider,
    info.model,
    info.selectedOptions?.[info.provider]?.effort,
  )

  return (
    <div className="border-b border-border px-4 py-3">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">En uso</h3>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-text">{info.catalog[info.provider].label}</span>
        {status ? (
          <Badge tone={STATUS_TONE[status.status]}>
            {STATUS_LABEL[status.status]}
            {status.status === 'authenticated' && status.account?.plan ? ' · ' + status.account.plan : ''}
            {status.status === 'authenticated' && status.account?.email ? ' · ' + status.account.email : ''}
          </Badge>
        ) : (
          <Badge tone="neutral">…</Badge>
        )}
      </div>

      <p className="mt-1 text-sm text-text">
        <span className="font-mono">{info.model}</span>
        {effortLabel && <span className="text-muted"> · Razonamiento: {effortLabel}</span>}
      </p>

      {info.modelSource === 'env' && (
        <p className="mt-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
          Definido por MINERVA_AI_MODEL en tu entorno. Elegir un modelo acá lo pisa.
        </p>
      )}
      {info.modelSource === 'default' && (
        <p className="mt-1.5 text-xs text-muted">
          Usando el default del proveedor (todavía no elegiste un modelo).
        </p>
      )}
    </div>
  )
}
