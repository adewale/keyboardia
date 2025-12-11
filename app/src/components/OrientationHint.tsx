import { useState, useEffect } from 'react';
import './OrientationHint.css';

const DISMISSED_KEY = 'keyboardia-orientation-hint-dismissed';

export function OrientationHint() {
  const [isPortrait, setIsPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(DISMISSED_KEY) === 'true';
  });

  useEffect(() => {
    const checkOrientation = () => {
      // Only show on mobile devices in portrait mode
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      setIsPortrait(isMobile && portrait);
    };

    checkOrientation();

    // Listen for orientation changes
    const orientationQuery = window.matchMedia('(orientation: portrait)');
    const widthQuery = window.matchMedia('(max-width: 768px)');

    orientationQuery.addEventListener('change', checkOrientation);
    widthQuery.addEventListener('change', checkOrientation);

    return () => {
      orientationQuery.removeEventListener('change', checkOrientation);
      widthQuery.removeEventListener('change', checkOrientation);
    };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, 'true');
  };

  // Don't render if not portrait or already dismissed
  if (!isPortrait || dismissed) {
    return null;
  }

  return (
    <div className="orientation-hint">
      <span className="orientation-hint-icon">↻</span>
      <span className="orientation-hint-text">Rotate for more steps</span>
      <button
        className="orientation-hint-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
