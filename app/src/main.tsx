import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './motion.css'

// Initialize debug systems in development
// In production, only error logging is enabled by default. Keeping this
// import behind the compile-time DEV guard prevents diagnostic tooling from
// becoming part of the production entry chunk.
if (import.meta.env.DEV) {
  void import('./utils/debug-coordinator').then(({ initDebugCoordinator }) => {
    initDebugCoordinator()
  }).catch((error: unknown) => {
    console.error('Failed to initialize debug tooling:', error)
  })
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
