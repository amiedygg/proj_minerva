import { useSettings } from '../../hooks/use-settings'

/**
 * Texto sutil con el modelo de IA activo (T12), leído de `settings:get`
 * (vía `useSettings`, compartido con `SettingsModal`). `null` mientras carga
 * o si el fetch inicial falló — no vale la pena mostrar un error aquí, es un
 * detalle secundario del header del panel didáctico.
 */
export function ActiveModelHint(): React.JSX.Element | null {
  const { info } = useSettings()
  if (!info) return null

  return (
    <span className="truncate text-[11px] text-muted" title={'Modelo activo: ' + info.aiModel}>
      vía <span className="font-mono">{info.aiModel}</span>
    </span>
  )
}
