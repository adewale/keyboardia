/**
 * Inline editable session name component
 * Click to edit, blur or Enter to save
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { logger } from '../utils/logger';
import { setSessionMeta } from '../utils/document-meta';

interface SessionNameProps {
  name: string | null;
  sessionId?: string;
  onRename: (name: string | null) => Promise<void>;
  disabled?: boolean;
}

export function SessionName({ name, sessionId, onRename, disabled = false }: SessionNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name || '');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync edit value when name prop changes
  useEffect(() => {
    if (!isEditing) {
      setEditValue(name || '');
    }
  }, [name, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Update document title and meta tags
  useEffect(() => {
    setSessionMeta(name, sessionId);
  }, [name, sessionId]);

  const handleClick = useCallback(() => {
    if (!disabled && !isSaving) {
      setIsEditing(true);
    }
  }, [disabled, isSaving]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;

    const trimmed = editValue.trim();
    const newName = trimmed || null;

    // Only save if changed
    if (newName !== name) {
      setIsSaving(true);
      try {
        await onRename(newName);
      } catch (error) {
        logger.error('Failed to rename session:', error);
        // Revert on error
        setEditValue(name || '');
      } finally {
        setIsSaving(false);
      }
    }

    setIsEditing(false);
  }, [editValue, name, onRename, isSaving]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(name || '');
      setIsEditing(false);
    }
  }, [handleSave, name]);

  const handleBlur = useCallback(() => {
    handleSave();
  }, [handleSave]);

  const displayName = name || 'Untitled Session';

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="session-name-input"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="Untitled Session"
        maxLength={100}
        disabled={isSaving}
        aria-label="Session name"
      />
    );
  }

  return (
    <button
      type="button"
      className={`session-name ${disabled ? 'session-name-disabled' : ''}`}
      onClick={handleClick}
      title={disabled ? displayName : 'Click to rename'}
      aria-label={`Session name: ${displayName}. ${disabled ? '' : 'Click to rename'}`}
    >
      {displayName}
      {isSaving && <span className="session-name-saving">...</span>}
    </button>
  );
}
