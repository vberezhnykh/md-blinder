import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  hasError: boolean
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="error-boundary"
          style={{
            maxWidth: 560,
            margin: '10vh auto',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <h1>Что-то пошло не так</h1>
          <p>
            Ваши данные не отправлялись на сервер и остаются локально в браузере. Перед
            перезагрузкой рекомендуем экспортировать историю в резервную копию.
          </p>
          <button type="button" onClick={this.handleReload}>
            Сбросить и перезагрузить
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
