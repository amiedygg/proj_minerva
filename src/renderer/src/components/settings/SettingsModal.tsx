import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useSettings } from '../../hooks/use-settings'
import { useProviderStatus } from '../../hooks/use-provider-status'
import type { AiProviderId } from '../../../../shared/ai-providers'
import type { AiProviderStatus, AiSettingsInfo, GithubAccessMode } from '../../../../shared/types'
import { IconButton } from '../ui/IconButton'
import { ActiveConfigSummary } from './ActiveConfigSummary'
import { GithubAccessSection } from './GithubAccessSection'
import { ProviderTabs } from './ProviderTabs'
import { ProviderModelPanel } from './ProviderModelPanel'

/**
 * Modal de settings (T12; rediseñado en T62/F12: tabs por proveedor + strip
 * "En uso" en reemplazo de los radios de `ProviderPicker`/`ModelPicker`).
 * Diagnóstico que motivó el rediseño (ver `PLAN.md` § F12, pedido de
 * Edilson): con el diseño viejo nada enunciaba la config VIGENTE (el
 * proveedor se deducía de qué radio estaba marcada, el modelo ACTIVO se
 * confundía con el BORRADOR sin "Guardar" todavía) y para mirar los modelos
 * de otro proveedor había que cambiar el proveedor activo — acá "ver" y
 * "activar" son gestos distintos: las tabs solo cambian la vista, activar
 * es clickear una card de modelo (`ProviderModelPanel`).
 *
 * `App.tsx` solo monta este componente mientras `settingsOpen` es `true`
 * (`{settingsOpen && <SettingsModal />}`): al cerrar se desmonta por
 * completo, lo que resetea cualquier estado local (de este componente o de
 * sus hijos, incluido `viewedProvider` en `SettingsModalBody`) de forma
 * automática la próxima vez que se abra — el mismo patrón de "resetear vía
 * remount" que usa `DidacticPanel` con `useDidacticAnalysis`.
 *
 * Cierra con Esc o con un clic fuera de la card (el overlay tiene el
 * `onClick`; la card detiene la propagación).
 */
export function SettingsModal(): React.JSX.Element {
  const closeSettings = useAppStore((s) => s.closeSettings)
  const { info, error, selectProvider, saveModel, setModelOption, setGithubAccessMode } = useSettings()
  const providerStatus = useProviderStatus()
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeSettings()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeSettings])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={closeSettings}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl outline-none"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="settings-modal-title" className="text-sm font-semibold text-text">
            Configuración
          </h2>
          <IconButton icon={<X size={16} />} label="Cerrar configuración" onClick={closeSettings} />
        </header>

        {info === null ? (
          <p className="p-4 text-xs text-muted">Cargando…</p>
        ) : (
          <SettingsModalBody
            info={info}
            error={error}
            statuses={providerStatus.statuses}
            statusLoading={providerStatus.loading}
            onRefetchStatus={providerStatus.refetch}
            selectProvider={selectProvider}
            saveModel={saveModel}
            setModelOption={setModelOption}
            setGithubAccessMode={setGithubAccessMode}
          />
        )}
      </div>
    </div>
  )
}

interface SettingsModalBodyProps {
  info: AiSettingsInfo
  error: string | null
  statuses: Record<AiProviderId, AiProviderStatus> | null
  statusLoading: boolean
  onRefetchStatus: () => void
  selectProvider: (provider: AiProviderId) => Promise<boolean>
  saveModel: (provider: AiProviderId, model: string) => Promise<boolean>
  setModelOption: (provider: AiProviderId, optionId: string, value: string) => Promise<boolean>
  setGithubAccessMode: (mode: GithubAccessMode) => Promise<boolean>
}

/**
 * Cuerpo del modal, montado SOLO cuando `info` ya cargó: acá vive
 * `viewedProvider`, qué proveedor están VIENDO las tabs (independiente del
 * proveedor ACTIVO, `info.provider`). Vive en este componente hijo — no en
 * `SettingsModal` — a propósito: `SettingsModal` recién lo monta cuando
 * `info !== null`, así el lazy initializer `useState(info.provider)` siempre
 * arranca en el proveedor activo real, sin necesitar un efecto de
 * sincronización para "corregirlo" cuando `info` termina de cargar
 * (antipatrón que el lint react-hooks de este repo prohíbe).
 */
function SettingsModalBody({
  info,
  error,
  statuses,
  statusLoading,
  onRefetchStatus,
  selectProvider,
  saveModel,
  setModelOption,
  setGithubAccessMode,
}: SettingsModalBodyProps): React.JSX.Element {
  const [viewedProvider, setViewedProvider] = useState<AiProviderId>(info.provider)

  return (
    <>
      {/*
        Primera sección no-IA del modal (T72, F14): "Acceso a GitHub" antes
        que nada relacionado a proveedor/modelo — con heading propio y el
        mismo `border-b` que separa a `ActiveConfigSummary`, para que quede
        visualmente aparte del resto (que sí es todo config de IA).
      */}
      <GithubAccessSection info={info} setGithubAccessMode={setGithubAccessMode} />

      <ActiveConfigSummary info={info} statuses={statuses} />
      <ProviderTabs info={info} statuses={statuses} viewed={viewedProvider} onChange={setViewedProvider} />
      <div className="flex-1 overflow-y-auto">
        <ProviderModelPanel
          key={viewedProvider}
          info={info}
          viewedProvider={viewedProvider}
          statuses={statuses}
          statusLoading={statusLoading}
          error={error}
          onRefetchStatus={onRefetchStatus}
          saveModel={saveModel}
          selectProvider={selectProvider}
          setModelOption={setModelOption}
        />
      </div>
    </>
  )
}
