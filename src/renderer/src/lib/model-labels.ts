import { getModelOption } from '../../../shared/ai-providers'
import type { AiProviderCatalogEntry, AiProviderId } from '../../../shared/ai-providers'

/**
 * Resuelve los labels humanos (proveedor, effort) para un
 * `(provider, model, effortValue)` dado, contra el catálogo ESTÁTICO
 * (`AiSettingsInfo.catalog` — no cambia con la selección del usuario).
 *
 * Extraído en T62 (F12) de `ActiveModelHint.tsx` para que tres consumidores
 * compartan la MISMA resolución: el banner sutil del panel didáctico
 * (`ActiveModelHint`), el strip "En uso" del modal de Settings
 * (`ActiveConfigSummary`) y el chip de la TitleBar — así "Proveedor · Modelo
 * · Razonamiento" nunca diverge entre superficies.
 *
 * Si el modelo ya no está en el catálogo (id viejo, o un slug tecleado a
 * mano en el modo "avanzado" de OpenCode) `getModelOption` devuelve
 * `undefined` — degradamos mostrando el id crudo sin effort, sin romper.
 */
export function resolveModelHintLabels(
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
