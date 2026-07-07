/**
 * Estado global de la UI (layout + selección), no de datos de dominio: los
 * datos de PRs viven en `main` y se piden vía IPC (T4, ver `src/renderer/src/hooks`).
 *
 * Se guarda el `PullRequestSummary` seleccionado completo (no solo su id):
 * los canales `github:getPullRequestDetail/Files/CommentThreads` piden
 * `{ repo, number }`, no un id de string, así que el selector de la lista ya
 * tiene todo lo necesario para pedir el detalle sin tener que volver a buscarlo.
 *
 * Los componentes deben consumir slices vía selector (`useAppStore((s) => s.x)`)
 * en vez de desestructurar el store completo, para no re-renderizar de más.
 */
import { create } from 'zustand'
import type { AuthStatus, EffectiveAiModelInfo, PullRequestSummary } from '../../../shared/types'

export type CenterTab = 'conversation' | 'files'
export type DiffViewMode = 'split' | 'inline'
export type FileTreeMode = 'tree' | 'list'

export const DIDACTIC_PANEL_DEFAULT_WIDTH = 380
export const DIDACTIC_PANEL_MIN_WIDTH = 320
/** Fracción máxima del viewport que puede ocupar el panel didáctico acoplado (T23). */
const DIDACTIC_PANEL_MAX_FRACTION = 0.6
const DIDACTIC_PANEL_WIDTH_KEY = 'minerva.didacticPanelWidth'

/**
 * Ancho del panel didáctico acoplado (T23, resize por arrastre): clamp entre
 * el mínimo fijo y una fracción del viewport ACTUAL — el máximo se evalúa en
 * cada llamada (no una vez) porque la ventana puede cambiar de tamaño entre
 * arrastres, y un ancho persistido en un monitor grande no debe comerse la
 * pantalla entera en uno chico.
 */
function clampDidacticPanelWidth(width: number): number {
  const max = Math.max(
    DIDACTIC_PANEL_MIN_WIDTH,
    Math.round(window.innerWidth * DIDACTIC_PANEL_MAX_FRACTION),
  )
  return Math.min(Math.max(Math.round(width), DIDACTIC_PANEL_MIN_WIDTH), max)
}

/** Ancho persistido en `localStorage` (sobrevive reinicios del renderer); inválido o ausente → default. */
function readInitialDidacticPanelWidth(): number {
  const raw = window.localStorage.getItem(DIDACTIC_PANEL_WIDTH_KEY)
  const parsed = raw === null ? Number.NaN : Number(raw)
  if (!Number.isFinite(parsed)) return DIDACTIC_PANEL_DEFAULT_WIDTH
  return clampDidacticPanelWidth(parsed)
}

/**
 * Foco pendiente al navegar desde un chip `path:line` en ConversationTab hacia
 * el tab Archivos: `FilesTab`/`DiffView` lo consumen para hacer scroll al hilo
 * una vez que el archivo correspondiente terminó de montarse, y lo limpian
 * (`clearPendingThreadFocus`) para no repetir el scroll en renders futuros.
 */
interface PendingThreadFocus {
  path: string
  line: number
  threadId: string
}

interface AppState {
  selectedPr: PullRequestSummary | null
  searchQuery: string
  centerTab: CenterTab
  didacticPanelOpen: boolean
  /** Ancho en px del panel didáctico acoplado (T23); se arrastra desde su borde izquierdo y persiste en `localStorage`. */
  didacticPanelWidth: number

  /** Archivo seleccionado en el tab "Archivos" (T7); se resetea al cambiar de PR. */
  selectedFilePath: string | null
  diffViewMode: DiffViewMode
  fileTreeMode: FileTreeMode
  wordWrap: boolean

  /** Hilo de línea expandido actualmente en la vista de diff (T8); uno solo a la vez. */
  expandedThreadId: string | null
  pendingThreadFocus: PendingThreadFocus | null

  /**
   * Estado de auth compartido (T6): fuente única de verdad para TitleBar,
   * Sidebar y los hooks de datos. Lo escribe `useAuth` (getStatus/polling);
   * `usePullRequests` lo usa como dependencia para refetchear al iniciar o
   * cerrar sesión (sin esto, la lista quedaba con el error 'No autenticado'
   * de antes del login hasta recargar la app).
   */
  authStatus: AuthStatus

  /**
   * Modal de settings (T12, engrane en TitleBar). `aiModelInfo` es la última
   * respuesta conocida de `settings:get`/`settings:setAiModel` (modelo de IA
   * efectivo + su procedencia): se guarda en el store en vez de en estado
   * local de un solo hook para que todos los consumidores (el modal y el
   * hint sutil del panel didáctico, `useSettings` en ambos) compartan el
   * mismo valor sin refetchear cada uno por su lado innecesariamente.
   */
  settingsOpen: boolean
  aiModelInfo: EffectiveAiModelInfo | null

  selectPr: (pr: PullRequestSummary | null) => void
  setSearchQuery: (query: string) => void
  setCenterTab: (tab: CenterTab) => void
  toggleDidacticPanel: () => void
  /** Fija el ancho del panel didáctico acoplado (clampeado y persistido); ver `clampDidacticPanelWidth`. */
  setDidacticPanelWidth: (width: number) => void
  setSelectedFilePath: (path: string | null) => void
  setDiffViewMode: (mode: DiffViewMode) => void
  setFileTreeMode: (mode: FileTreeMode) => void
  toggleWordWrap: () => void
  setExpandedThreadId: (threadId: string | null) => void
  /** Navega al tab Archivos, selecciona `path` y deja el hilo `threadId` expandido/enfocado. */
  openLineThread: (path: string, line: number, threadId: string) => void
  clearPendingThreadFocus: () => void
  setAuthStatus: (status: AuthStatus) => void
  openSettings: () => void
  closeSettings: () => void
  setAiModelInfo: (info: EffectiveAiModelInfo) => void
}

export const useAppStore = create<AppState>((set) => ({
  selectedPr: null,
  searchQuery: '',
  centerTab: 'conversation',
  didacticPanelOpen: true,
  didacticPanelWidth: readInitialDidacticPanelWidth(),

  selectedFilePath: null,
  diffViewMode: 'split',
  fileTreeMode: 'tree',
  wordWrap: false,

  expandedThreadId: null,
  pendingThreadFocus: null,

  authStatus: { state: 'signed_out' },

  settingsOpen: false,
  aiModelInfo: null,

  selectPr: (pr) =>
    set({
      selectedPr: pr,
      centerTab: 'conversation',
      selectedFilePath: null,
      expandedThreadId: null,
      pendingThreadFocus: null,
    }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setCenterTab: (tab) => set({ centerTab: tab }),
  toggleDidacticPanel: () => set((state) => ({ didacticPanelOpen: !state.didacticPanelOpen })),
  setDidacticPanelWidth: (width) => {
    const clamped = clampDidacticPanelWidth(width)
    // Best-effort: si `localStorage` fallara (cuota, modo raro), el resize
    // sigue funcionando dentro de la sesión.
    try {
      window.localStorage.setItem(DIDACTIC_PANEL_WIDTH_KEY, String(clamped))
    } catch {
      // sin persistencia, pero sin romper el arrastre
    }
    set({ didacticPanelWidth: clamped })
  },
  setSelectedFilePath: (path) => set({ selectedFilePath: path }),
  setDiffViewMode: (mode) => set({ diffViewMode: mode }),
  setFileTreeMode: (mode) => set({ fileTreeMode: mode }),
  toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
  setExpandedThreadId: (threadId) => set({ expandedThreadId: threadId }),
  openLineThread: (path, line, threadId) =>
    set({
      centerTab: 'files',
      selectedFilePath: path,
      expandedThreadId: threadId,
      pendingThreadFocus: { path, line, threadId },
    }),
  clearPendingThreadFocus: () => set({ pendingThreadFocus: null }),
  setAuthStatus: (status) => set({ authStatus: status }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setAiModelInfo: (info) => set({ aiModelInfo: info }),
}))
