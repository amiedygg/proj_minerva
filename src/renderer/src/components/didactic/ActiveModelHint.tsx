import { useSettings } from '../../hooks/use-settings'

/**
 * Texto sutil con el proveedor+modelo de IA activo (T12; multi-proveedor
 * desde T30), leído de `settings:get` (vía `useSettings`, compartido con
 * `SettingsModal`). `null` mientras carga o si el fetch inicial falló — no
 * vale la pena mostrar un error aquí, es un detalle secundario del header
 * del panel didáctico.
 */
export function ActiveModelHint(): React.JSX.Element | null {
  const { info } = useSettings()
  if (!info) return null

  const providerLabel = info.catalog[info.provider].label
  const summary = providerLabel + ' · ' + info.model

  return (
    <span className="truncate text-[11px] text-muted" title={'Proveedor y modelo activos: ' + summary}>
      vía <span className="font-mono">{summary}</span>
    </span>
  )
}
