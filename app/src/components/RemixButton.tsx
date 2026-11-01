interface RemixButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isRemixing?: boolean;
  primary?: boolean;
  title?: string;
  ariaLabel?: string;
  tabIndex?: number;
}

/** Shared Remix action used for both published sessions and landing examples. */
export function RemixButton({
  onClick,
  disabled = false,
  isRemixing = false,
  primary = false,
  title = 'Create a copy for yourself',
  ariaLabel,
  tabIndex,
}: RemixButtonProps) {
  return (
    <button
      type="button"
      className={`session-btn remix-btn${primary ? ' primary-action' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-busy={isRemixing}
      tabIndex={tabIndex}
    >
      {isRemixing ? 'Remixing...' : 'Remix'}
    </button>
  );
}
