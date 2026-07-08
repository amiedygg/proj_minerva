import { getModelOption } from '../../../../shared/ai-providers'
import { useSettings } from '../../hooks/use-settings'

/**
 * Texto sutil con el proveedor+modelo (+ effort, T37) de IA activo (T12;
 * multi-proveedor desde T30), leído de `settings:get` (vía `useSettings`,
 * compartido con `SettingsModal`). `null` mientras carga o si el fetch
 * inicial falló — no vale la pena mostrar un error aquí, es un detalle
 * secundario del header del panel didáctico.
 *
 * El effort mostrado sale de `info.selectedOptions[provider].effort` (T34,
 * ya resuelto por `getEffectiveAiSelection` en main) — se busca su
 * `choice.label` humano en el descriptor `effort` del modelo activo
 * (`getModelOption`, `shared/ai-providers.ts`); si el modelo activo no tiene
 * ese descriptor (p. ej. un modelo Codex sin efforts, o un id "avanzado" de
 * OpenRouter tecleado a mano), no se agrega nada.
 */
export function ActiveModelHint(): React.JSX.Element | null {
  const { info } = useSettings()
  if (!info) return null

  const providerLabel = info.catalog[info.provider].label
  const effortValue = info.selectedOptions?.[info.provider]?.effort
  const effortDescriptor = getModelOption(info.catalog, info.provider, info.model)?.options?.find(
    (descriptor) => descriptor.id === 'effort',
  )
  const effortLabel = effortDescriptor?.choices.find((choice) => choice.value === effortValue)?.label

  const summary =
    providerLabel + ' · ' + info.model + (effortLabel ? ' · ' + effortLabel : '')

  return (
    <span className="truncate text-[11px] text-muted" title={'Proveedor y modelo activos: ' + summary}>
      vía <span className="font-mono">{summary}</span>
    </span>
  )
}
