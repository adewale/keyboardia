import { useRef, useEffect, useState, useCallback } from 'react';
import { clamp } from '../shared/validation';
import './Waveform.css';

/**
 * BUG FIX: Pointer capture for slice marker dragging
 * See docs/bug-patterns/POINTER-CAPTURE-AND-STALE-CLOSURES.md
 */

interface WaveformProps {
  buffer: AudioBuffer;
  slicePoints?: number[]; // Normalized 0-1 positions
  onSlicePointsChange?: (points: number[]) => void;
  onPlaySlice?: (startPercent: number, endPercent: number) => void;
  height?: number;
}

export function Waveform({ buffer, slicePoints = [], onSlicePointsChange, onPlaySlice, height = 80 }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null);
  // BUG FIX: Use ref for dragging state in global listener
  const draggingPointRef = useRef<number | null>(null);
  useEffect(() => { draggingPointRef.current = draggingPoint; }, [draggingPoint]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const channelData = buffer.getChannelData(0);
    const step = Math.ceil(channelData.length / width);
    const amp = height / 2;

    // Clear
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    // Draw waveform
    ctx.beginPath();
    ctx.moveTo(0, amp);

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;

      for (let j = 0; j < step; j++) {
        const datum = channelData[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }

      // Draw both min and max for visual density
      ctx.lineTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }

    ctx.strokeStyle = '#ff6b35';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw slice markers
    const allPoints = [0, ...slicePoints, 1].sort((a, b) => a - b);

    for (let i = 0; i < allPoints.length; i++) {
      const x = allPoints[i] * width;

      // Draw vertical line
      if (allPoints[i] > 0 && allPoints[i] < 1) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.strokeStyle = hoveredSlice === i ? '#00d4ff' : '#f39c12';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw handle
        ctx.beginPath();
        ctx.arc(x, height / 2, 6, 0, Math.PI * 2);
        ctx.fillStyle = hoveredSlice === i ? '#00d4ff' : '#f39c12';
        ctx.fill();
      }

      // Shade alternate slices
      if (i < allPoints.length - 1) {
        const nextX = allPoints[i + 1] * width;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 107, 53, 0.1)' : 'rgba(255, 107, 53, 0.05)';
        ctx.fillRect(x, 0, nextX - x, height);
      }
    }

  }, [buffer, slicePoints, height, hoveredSlice]);

  // Handle mouse interactions
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;

    if (draggingPoint !== null && onSlicePointsChange) {
      // Move the slice point
      const newPoints = [...slicePoints];
      newPoints[draggingPoint] = clamp(x, 0.01, 0.99);
      onSlicePointsChange(newPoints.sort((a, b) => a - b));
    } else {
      // Check if hovering over a slice point
      const threshold = 0.02;
      const hoverIndex = slicePoints.findIndex(p => Math.abs(p - x) < threshold);
      setHoveredSlice(hoverIndex >= 0 ? hoverIndex + 1 : null);
    }
  }, [slicePoints, draggingPoint, onSlicePointsChange]);

  // BUG FIX: Add pointer capture for reliable slice marker dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;

    // Check if clicking on a slice point
    const threshold = 0.02;
    const clickIndex = slicePoints.findIndex(p => Math.abs(p - x) < threshold);

    if (clickIndex >= 0) {
      setDraggingPoint(clickIndex);
      // Capture pointer to receive events even when pointer leaves element
      try {
        (e.target as HTMLElement).setPointerCapture((e.nativeEvent as PointerEvent).pointerId || 1);
      } catch {
        // Ignore if capture fails
      }
    } else if (onPlaySlice) {
      // Find which slice was clicked
      const allPoints = [0, ...slicePoints, 1].sort((a, b) => a - b);
      for (let i = 0; i < allPoints.length - 1; i++) {
        if (x >= allPoints[i] && x < allPoints[i + 1]) {
          onPlaySlice(allPoints[i], allPoints[i + 1]);
          break;
        }
      }
    }
  }, [slicePoints, onPlaySlice]);

  // BUG FIX: Release pointer capture on mouse up
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    try {
      (e.target as HTMLElement).releasePointerCapture((e.nativeEvent as PointerEvent).pointerId || 1);
    } catch {
      // Ignore if release fails
    }
    setDraggingPoint(null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredSlice(null);
    // Don't clear dragging on leave - pointer capture handles this
  }, []);

  // BUG FIX: Global listener to catch mouseup outside element
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (draggingPointRef.current !== null) {
        setDraggingPoint(null);
      }
    };
    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  return (
    <div
      ref={containerRef}
      className="waveform-container"
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        style={{ height }}
      />
      {slicePoints.length > 0 && (
        <div className="slice-count">{slicePoints.length + 1} slices</div>
      )}
    </div>
  );
}
