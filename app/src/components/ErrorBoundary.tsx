import { Component, type ReactNode } from 'react';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Phase 13B: React Error Boundary
 *
 * Catches render errors and displays a recovery UI instead of crashing to white screen.
 * Users can retry or start fresh without losing their browser session.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });

    // Log to console for debugging
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);

    // TODO: Send to error tracking service in production
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleRefresh = (): void => {
    window.location.reload();
  };

  handleNewSession = (): void => {
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h1>Something went wrong</h1>
            <p className="error-message">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>

            <div className="error-actions">
              <button
                className="error-btn primary"
                onClick={this.handleRetry}
              >
                Try Again
              </button>
              <button
                className="error-btn secondary"
                onClick={this.handleRefresh}
              >
                Refresh Page
              </button>
              <button
                className="error-btn secondary"
                onClick={this.handleNewSession}
              >
                Start New Session
              </button>
            </div>

            {/* Show technical details in dev mode */}
            {import.meta.env.DEV && this.state.errorInfo && (
              <details className="error-details">
                <summary>Technical Details</summary>
                <pre className="error-stack">
                  {this.state.error?.stack}
                </pre>
                <pre className="component-stack">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
