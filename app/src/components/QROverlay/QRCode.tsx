/**
 * QR Code Component
 *
 * Generates an SVG QR code for the given URL.
 * Uses the qrcode library for generation with error correction level M.
 */

import { useState, useEffect } from 'react';
import QRCodeLib from 'qrcode';

interface QRCodeProps {
  /** URL to encode in the QR code */
  value: string;
  /** Size in pixels (width and height) */
  size?: number;
  /** Error correction level */
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
  /** Additional CSS class */
  className?: string;
}

export function QRCode({
  value,
  size = 200,
  errorCorrection = 'M',
  className = '',
}: QRCodeProps) {
  const [svgString, setSvgString] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function generateQR() {
      try {
        const svg = await QRCodeLib.toString(value, {
          type: 'svg',
          errorCorrectionLevel: errorCorrection,
          margin: 2,
          width: size,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });

        if (!cancelled) {
          setSvgString(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to generate QR code');
        }
      }
    }

    generateQR();

    return () => {
      cancelled = true;
    };
  }, [value, size, errorCorrection]);

  if (error) {
    return (
      <div
        className={`qr-code qr-code-error ${className}`}
        style={{ width: size, height: size }}
        role="img"
        aria-label="QR code failed to generate"
      >
        <span>⚠</span>
      </div>
    );
  }

  if (!svgString) {
    return (
      <div
        className={`qr-code qr-code-loading ${className}`}
        style={{ width: size, height: size }}
        role="img"
        aria-label="Generating QR code"
      />
    );
  }

  return (
    <div
      className={`qr-code ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`QR code linking to ${value}`}
      dangerouslySetInnerHTML={{ __html: svgString }}
    />
  );
}
