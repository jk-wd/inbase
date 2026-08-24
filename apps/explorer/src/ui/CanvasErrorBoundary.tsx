import { Component, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  failed: boolean
}

export class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('Visualizer canvas error', error)
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="canvas-error">
          <div className="hud-gate-card">
            <h1>Visualizer stopped</h1>
            <p>The 3D view hit an error. Reload the page to restore it.</p>
            <button
              className="hud-button"
              type="button"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
