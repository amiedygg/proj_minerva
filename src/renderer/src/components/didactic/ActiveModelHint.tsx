import { getModelOption } from '../../../../shared/ai-providers'
import type { AiProviderCatalogEntry, AiProviderId } from '../../../../shared/ai-providers'
import type { AnalysisGenerationInfo } from '../../../../shared/types'
import { useSettings } from '../../hooks/use-settings'

interface ActiveModelHintProps {
  /**
   * Sello de generación del análisis MOSTRADO (`analysis.generatedWith`,
   * T39/T40). Si viene, el banner pinta proveedor/modelo/effort de ESTE
   * objeto (no de la config vigente) — así no miente si el usuario cambia
   * de proveedor/modelo/effort en Settings después de generar el análisis
   * (Issue 1, F9). Si no viene (streaming en curso, aún sin `analysis`
   * final), cae al comportamiento de siempre: la config vigente.
   */
  generatedWith?: AnalysisGenerationInfo
}

/**
 * Resuelve los labels humanos (proveedor, effort) para un
 * `(provider, model, effortValue)` dado, contra el catálogo ESTÁTICO
 * (`AiSettingsInfo.catalog` — no cambia con la selección del usuario).
 * Compartido por los dos caminos de `ActiveModelHint`: config vigente
 * (sin `generatedWith`) y sello del análisis (`generatedWith`, T41).
 *
 * Si el modelo ya no está en el catálogo (id viejo, o un slug tecleado a
 * mano en el modo "avanzado" de OpenCode) `getModelOption` devuelve
 * `undefined` — degradamos mostrando el id crudo sin effort, sin romper.
 */
function resolveModelHintLabels(
  catalog: Record<AiProviderId, AiProviderCatalogEntry>,
  provider: AiProviderId,
  model: string,
  effortValue: string | undefined,
): { providerLabel: string; effortLabel: string | undefined } {
  const providerLabel = catalog[provider].label
  const effortDescriptor = getModelOption(catalog, provider, model)?.options?.find(
    (descriptor) => descriptor.id === 'effort',
  )
  const effortLabel = effortDescriptor?.choices.find((choice) => choice.value === effortValue)?.label

  return { providerLabel, effortLabel }
}

/**
 * Texto sutil con el proveedor+modelo (+ effort, T37) de IA — sellado con la
 * config de GENERACIÓN del análisis mostrado cuando se pasa `generatedWith`
 * (T41; sellado en T40 por el handler vía `getEffectiveAiSelection()`), o la
 * config vigente de `useSettings()` (vía `settings:get`, compartido con
 * `SettingsModal`) mientras no hay un análisis final que mostrar (streaming
 * en curso). `null` mientras el catálogo (`info`) aún no cargó o si el
 * fetch inicial falló — no vale la pena mostrar un error aquí, es un
 * detalle secundario del header del panel didáctico.
 *
 * Los LABELS (proveedor, effort) siempre se resuelven contra
 * `info.catalog` — es estático, no cambia con la selección — vía
 * `resolveModelHintLabels`, reutilizado por ambos caminos.
 */
export function ActiveModelHint({ generatedWith }: ActiveModelHintProps = {}): React.JSX.Element | null {
  const { info } = useSettings()
  if (!info) return null

  const provider = generatedWith?.provider ?? info.provider
  const model = generatedWith?.model ?? info.model
  const effortValue = generatedWith
    ? generatedWith.options.effort
    : info.selectedOptions?.[info.provider]?.effort

  const { providerLabel, effortLabel } = resolveModelHintLabels(info.catalog, provider, model, effortValue)

  const summary = providerLabel + ' · ' + model + (effortLabel ? ' · ' + effortLabel : '')

  return (
    <span className="truncate text-[11px] text-muted" title={'Proveedor y modelo activos: ' + summary}>
      vía <span className="font-mono">{summary}</span>
    </span>
  )
}
