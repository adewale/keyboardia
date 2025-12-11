import { useRef, useEffect } from 'react';
import './InlineDrawer.css';

interface InlineDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * InlineDrawer - Expands below its parent element instead of opening a modal.
 * Key insight: Keeps controls in context with the thing being edited.
 * This is better than bottom sheets for frequent operations.
 *
 * LESSON FOR DESKTOP: This pattern could replace the p-lock inline editor
 * with a more consistent "expand to edit" paradigm across all controls.
 */
export function InlineDrawer({ isOpen, onClose, children }: InlineDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        // Check if click is on the parent track row or mobile edit panel (allow toggle)
        const target = e.target as HTMLElement;
        if (!target.closest('.track-row') && !target.closest('.mobile-edit-panel')) {
          onClose();
        }
      }
    };

    // Delay to prevent immediate close on the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="inline-drawer" ref={drawerRef}>
      <div className="inline-drawer-content">
        {children}
      </div>
    </div>
  );
}
