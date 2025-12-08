import './FloatingAddButton.css';

interface FloatingAddButtonProps {
  onClick: () => void;
}

/**
 * Floating Action Button for adding tracks on mobile
 *
 * LESSON FOR DESKTOP: Clear, always-visible primary actions
 * reduce cognitive load. The desktop "Add Track" in sample picker
 * could be more prominent.
 */
export function FloatingAddButton({ onClick }: FloatingAddButtonProps) {
  return (
    <button
      className="floating-add-btn"
      onClick={onClick}
      aria-label="Add track"
    >
      <span className="fab-icon">+</span>
    </button>
  );
}
