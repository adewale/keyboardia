/**
 * Phase 34: Feature-Level Error Boundary
 *
 * Isolates errors within specific features to prevent entire app crashes.
 * Unlike the top-level ErrorBoundary, this provides feature-specific recovery options.
 */

import { Component, type ReactNode } from 'react';
import './FeatureErrorBoundary.css';

export type FeatureType = 'sequencer' | 'multiplayer' | 'audio' | 'generic';

interface Props {
  children: ReactNode;
  feature: FeatureType;
  /** Optional custom fallback - if not provided, uses default feature-specific UI */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Feature-specific error messages and recovery actions
 */
const FEATURE_CONFIG: Record<FeatureType, {
  title: string;
  message: string;
  retryLabel: string;
}> = {
  sequencer: {
    title: 'Sequencer Error',
    message: 'The sequencer encountered an error. Your session data is safe.',
    retryLabel: 'Reload Tracks',
  },
  multiplayer: {
    title: 'Connection Error',
    message: 'Lost connection to other players. Changes are saved locally.',
    retryLabel: 'Reconnect',
  },
  audio: {
    title: 'Audio Error',
    message: 'Audio playback encountered an issue.',
    retryLabel: 'Restart Audio',
  },
  generic: {
    title: 'Something went wrong',
    message: 'This section encountered an error.',
    retryLabel: 'Try Again',
  },
};

export class FeatureErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log with feature context for easier debugging
    console.error(`[FeatureErrorBoundary:${this.props.feature}] Error:`, error);
    console.error(`[FeatureErrorBoundary:${this.props.feature}] Component stack:`, errorInfo.componentStack);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default feature-specific error UI
      const config = FEATURE_CONFIG[this.props.feature];

      return (
        <div className={`feature-error-boundary feature-error-${this.props.feature}`}>
          <div className="feature-error-content">
            <h3>{config.title}</h3>
            <p>{config.message}</p>
            <button
              className="feature-error-retry"
              onClick={this.handleRetry}
            >
              {config.retryLabel}
            </button>
            {/* Show error details in dev mode */}
            {import.meta.env.DEV && this.state.error && (
              <details className="feature-error-details">
                <summary>Technical Details</summary>
                <pre>{this.state.error.message}</pre>
                <pre>{this.state.error.stack}</pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
