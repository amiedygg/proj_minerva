interface DidacticPlaceholderProps {
  /** `undefined` (sin PR seleccionado) deja el botón deshabilitado. */
  onAnalyze?: () => void
}

/** Descripción de lo que hace el panel + botón "Analizar PR" (habilitado solo con PR seleccionado). */
export function DidacticPlaceholder({ onAnalyze }: DidacticPlaceholderProps): React.JSX.Element {
  return (
    <>
      <div className="rounded-md border border-border bg-bg p-3 text-sm text-muted">
        <p className="mb-2 text-text">Aquí verás el análisis con IA del PR seleccionado:</p>
        <ul className="list-inside list-disc space-y-1">
          <li>Resumen didáctico del cambio</li>
          <li>Diagrama C4 si toca arquitectura</li>
          <li>Documentación de endpoints nuevos, con ejemplo para probarlos en local</li>
          <li>Diagrama ER si hay cambios de esquema</li>
        </ul>
      </div>

      <button
        type="button"
        disabled={!onAnalyze}
        onClick={onAnalyze}
        title={onAnalyze ? undefined : 'Selecciona un PR primero'}
        className={
          onAnalyze
            ? 'rounded-md border border-accent/40 bg-accent/15 px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25'
            : 'cursor-not-allowed rounded-md border border-border bg-border/40 px-3 py-2 text-sm font-medium text-muted'
        }
      >
        Analizar PR
      </button>
    </>
  )
}
