import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

// Sem isto, qualquer dado inesperado do TSE derruba a página inteira (tela branca).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[apuracao] erro de renderização', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', padding: 24, background: '#050505', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
          <p style={{ fontWeight: 700 }}>Não foi possível exibir a apuração agora.</p>
          <p>
            Recarregue em alguns segundos. Resultado oficial:{' '}
            <a href="https://resultados.tse.jus.br" style={{ color: '#38bdf8' }}>
              resultados.tse.jus.br
            </a>
          </p>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 12, padding: '6px 12px' }}>
            Recarregar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
