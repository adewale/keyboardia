import { StrictMode, useState, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './components/LandingPage'

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
 * Root Router Component
 *
 * Handles routing between LandingPage and App:
 * - "/" shows LandingPage
 * - "/s/{uuid}" shows App with session
 *
 * @see /specs/LANDING-PAGE.md for routing specification
 */
function Router() {
  const [showApp, setShowApp] = useState(false);

  useEffect(() => {
    const path = window.location.pathname;

    // Check for session URL pattern: /s/{uuid}
    // UUIDs are 36 characters: 8-4-4-4-12 hex digits
    const sessionMatch = path.match(/^\/s\/([a-f0-9-]{36})$/i);
    if (sessionMatch) {
      setShowApp(true);
      return;
    }

    // Any other path with /s/ prefix should show the app
    // (handles partial UUIDs, session not found, etc.)
    if (path.startsWith('/s/')) {
      setShowApp(true);
      return;
    }

    // Root path or unknown paths show landing page
    // Landing page is the default
  }, []);

  // Start a new session from landing page
  const handleStartSession = useCallback(() => {
    // Navigate to create a new session
    // The App component will handle creating a new session on mount
    window.location.href = '/s/new';
  }, []);

  // Select an example pattern - navigate to app with pattern in URL state
  const handleSelectExample = useCallback((pattern: number[][], bpm: number) => {
    // Store example in sessionStorage for App to pick up
    sessionStorage.setItem('pendingExample', JSON.stringify({ pattern, bpm }));
    window.location.href = '/s/new';
  }, []);

  if (showApp) {
    return <App />;
  }

  return <LandingPage onStartSession={handleStartSession} onSelectExample={handleSelectExample} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
