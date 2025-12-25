import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Initialize unified debugging infrastructure
// The debug coordinator handles URL flags (?debug=1, ?trace=1, etc.)
// and initializes all subsystems (log-store, tracer, playback-debug, bug-patterns)
import { initDebugCoordinator } from './utils/debug-coordinator'

// Initialize debug systems in development
// In production, only error logging is enabled by default
if (import.meta.env.DEV) {
  initDebugCoordinator()
}

/**
 * App handles all routing internally:
 * - "/" shows LandingPage (showLanding = true)
 * - "/s/{id}" shows session UI (showLanding = false)
 *
 * This avoids the full page reload that window.location.href causes.
 * App.tsx uses React state transitions for instant navigation.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
