import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Barrera de errores global: un crash en cualquier componente muestra un
 * mensaje recuperable en vez de desmontar toda la app (pantalla en blanco).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary atrapó un error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-text">
          <span className="text-4xl">🦉💥</span>
          <h1 className="text-lg font-semibold">Algo salió mal en la interfaz</h1>
          <pre className="max-w-xl overflow-auto rounded-md bg-panel p-4 text-sm text-danger">
            {this.state.error.message}
          </pre>
          <button
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:opacity-90"
            onClick={() => this.setState({ error: null })}
          >
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
