import { useEffect, useRef, useCallback } from 'react';
import './BottomSheet.css';

/**
 * BUG FIX: Stale closure fix for onClose callback
 * See docs/bug-patterns/POINTER-CAPTURE-AND-STALE-CLOSURES.md
 */

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // BUG FIX: Use refs to avoid stale closures
  const onCloseRef = useRef(onClose);
  const isOpenRef = useRef(isOpen);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  // Close on escape key
  // BUG FIX: Register once on mount, use refs for current state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpenRef.current) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []); // Empty deps - register once

  // Close on click outside
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="bottom-sheet-backdrop" onClick={handleBackdropClick}>
      <div className="bottom-sheet" ref={sheetRef}>
        <div className="bottom-sheet-handle" />
        {title && <div className="bottom-sheet-title">{title}</div>}
        <div className="bottom-sheet-content">
          {children}
        </div>
      </div>
    </div>
  );
}
