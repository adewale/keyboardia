/**
 * Hook for managing QR code display mode via URL parameter
 *
 * The ?qr=1 URL parameter transforms any Keyboardia URL into a QR-prominent
 * display mode. This is a composable modifier that works on any existing URL.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

export interface QRModeState {
  /** Whether QR mode is currently active */
  isActive: boolean;
  /** The URL to encode in the QR code (current URL without ?qr=1) */
  targetURL: string;
  /** Activate QR mode by adding ?qr=1 to URL */
  activate: () => void;
  /** Deactivate QR mode by removing ?qr=1 from URL */
  deactivate: () => void;
}

/**
 * Get the QR target URL (current URL without the qr parameter)
 */
function getQRTargetURL(): string {
  const target = new URL(window.location.href);
  target.searchParams.delete('qr');
  return target.toString();
}

/**
 * Check if QR mode is active from URL
 */
function isQRModeActive(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('qr') === '1';
}

export function useQRMode(): QRModeState {
  const [isActive, setIsActive] = useState(() => isQRModeActive());

  // Listen for popstate (browser back/forward) and URL changes
  useEffect(() => {
    const handlePopState = () => {
      setIsActive(isQRModeActive());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const activate = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('qr', '1');
    window.history.pushState({}, '', url.toString());
    setIsActive(true);
  }, []);

  const deactivate = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('qr');
    window.history.pushState({}, '', url.toString());
    setIsActive(false);
  }, []);

  // Recalculate target URL when active state changes (URL is updated via pushState)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- isActive triggers URL recalculation
  const targetURL = useMemo(() => getQRTargetURL(), [isActive]);

  return { isActive, targetURL, activate, deactivate };
}
