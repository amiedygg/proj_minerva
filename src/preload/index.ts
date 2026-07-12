import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcChannel, IpcRequest, IpcResponse, MinervaApi } from '../shared/ipc'
import { MINERVA_EVENTS, type AnalysisProgressEvent } from '../shared/events'

/** Wrapper fino sobre `ipcRenderer.invoke` para un canal concreto del contrato. */
function invoke<C extends IpcChannel>(channel: C) {
  return (req: IpcRequest<C>): Promise<IpcResponse<C>> =>
    ipcRenderer.invoke(channel, req) as Promise<IpcResponse<C>>
}

/**
 * Guard mínimo de forma para el payload de `analysisProgress`: no valida
 * exhaustivamente cada sección (eso ya lo hizo `StreamSectionParser` en
 * main), solo que el objeto tiene la forma esperada de nivel superior antes
 * de pasarlo al callback del renderer — defensa en profundidad por si algo
 * llegara a emitir por este canal con una forma inesperada. `error` (T22) es
 * opcional: solo viaja en el evento terminal de un análisis fallido, así que
 * no se exige, solo se valida su tipo cuando está presente.
 */
function isAnalysisProgressPayload(value: unknown): value is AnalysisProgressEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.repo === 'object' &&
    v.repo !== null &&
    typeof v.number === 'number' &&
    Array.isArray(v.sections) &&
    typeof v.done === 'boolean' &&
    (v.error === undefined || typeof v.error === 'string') &&
    // `phase` (T60): campo ADITIVO opcional, mismo criterio que `error` —
    // ausente (mock/evento terminal) o uno de los dos valores válidos.
    (v.phase === undefined || v.phase === 'exploring' || v.phase === 'writing')
  )
}

/**
 * Suscripción al streaming del análisis didáctico (T13). A propósito NO es
 * un `on(channel, cb)` genérico: el canal está hardcodeado literal
 * (`MINERVA_EVENTS.analysisProgress`), así que el renderer nunca puede pedir
 * suscribirse a un canal IPC arbitrario aunque tuviera acceso a esta función.
 * Devuelve la función de desuscripción (`removeListener` de ESE listener en
 * particular, no de todos los del canal).
 */
function onAnalysisProgress(callback: (payload: AnalysisProgressEvent) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    if (isAnalysisProgressPayload(payload)) {
      callback(payload)
    }
  }
  ipcRenderer.on(MINERVA_EVENTS.analysisProgress, listener)
  return () => ipcRenderer.removeListener(MINERVA_EVENTS.analysisProgress, listener)
}

const minervaApi = {
  system: {
    ping: invoke('minerva:ping'),
  },
  auth: {
    getStatus: invoke('auth:getStatus'),
    startDeviceFlow: invoke('auth:startDeviceFlow'),
    signOut: invoke('auth:signOut'),
  },
  github: {
    listPullRequests: invoke('github:listPullRequests'),
    getPullRequestDetail: invoke('github:getPullRequestDetail'),
    getPullRequestFiles: invoke('github:getPullRequestFiles'),
    getCommentThreads: invoke('github:getCommentThreads'),
    postComment: invoke('github:postComment'),
  },
  ai: {
    analyzePullRequest: invoke('ai:analyzePullRequest'),
    getCachedAnalysis: invoke('ai:getCachedAnalysis'),
    invalidateAnalysis: invoke('ai:invalidateAnalysis'),
    getAnalysisState: invoke('ai:getAnalysisState'),
    getProviderStatus: invoke('ai:getProviderStatus'),
    getProviderModels: invoke('ai:getProviderModels'),
  },
  settings: {
    get: invoke('settings:get'),
    setAiProvider: invoke('settings:setAiProvider'),
    setProviderModel: invoke('settings:setProviderModel'),
    setModelOption: invoke('settings:setModelOption'),
  },
  window: {
    openDidactic: invoke('window:openDidactic'),
  },
  events: {
    onAnalysisProgress,
  },
} satisfies MinervaApi

export type { MinervaApi }

// Sin rama de fallback para contextIsolation deshabilitado: si alguna vez se
// apaga por error, el bridge simplemente no se expone y el fallo es visible,
// en vez de activarse silenciosamente en un contexto comprometido.
if (!process.contextIsolated) {
  throw new Error('proj_minerva requiere contextIsolation habilitado')
}
contextBridge.exposeInMainWorld('minerva', minervaApi)
