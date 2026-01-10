/**
 * TrackNameEditor - Inline track name display and editor
 *
 * Extracted from TrackRow.tsx to reduce component complexity (NEW-002b).
 * Handles click-to-preview, double-click-to-rename interaction pattern.
 *
 * Features:
 * - Single click triggers preview callback (after 200ms delay)
 * - Double-click enters edit mode (cancels preview)
 * - Enter saves, Escape cancels
 * - Auto-focus and select-all on edit start
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface TrackNameEditorProps {
  /** Current track name */
  name: string;
  /** Original instrument name (for tooltip) */
  instrumentName: string;
  /** Sample ID for debug tooltip */
  sampleId: string;
  /** Whether rename functionality is enabled */
  canRename: boolean;
  /** Callback when name is saved */
  onSave: (name: string) => void;
  /** Callback for single-click preview (fires after 200ms delay) */
  onPreview: () => void;
}

/**
 * Inline track name with edit-on-double-click behavior.
 *
 * @example
 * ```tsx
 * <TrackNameEditor
 *   name={track.name}
 *   instrumentName={getInstrumentName(track.sampleId)}
 *   sampleId={track.sampleId}
 *   canRename={!!onSetName}
 *   onSave={handleNameSave}
 *   onPreview={handlePreview}
 * />
 * ```
 */
export function TrackNameEditor({
  name,
  instrumentName,
  sampleId,
  canRename,
  onSave,
  onPreview,
}: TrackNameEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingValue, setEditingValue] = useState('');
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and select all when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  // Handle single click - preview after delay
  const handleClick = useCallback(() => {
    // Clear any pending timer
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    // 200ms delay to distinguish from double-click
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onPreview();
    }, 200);
  }, [onPreview]);

  // Handle double-click - enter edit mode
  const handleDoubleClick = useCallback(() => {
    // Cancel preview timer
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    if (!canRename) return;

    // Start editing
    setEditingValue(name);
    setIsEditing(true);
  }, [canRename, name]);

  // Save the new name
  const handleSave = useCallback(() => {
    const trimmed = editingValue.trim();
    if (trimmed) {
      onSave(trimmed);
    }
    setIsEditing(false);
    setEditingValue('');
  }, [editingValue, onSave]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditingValue('');
    }
  }, [handleSave]);

  // Build tooltip
  const tooltip = (() => {
    const isRenamed = name !== instrumentName;
    const debugInfo = `ID: ${sampleId}`;
    return isRenamed
      ? `Instrument: ${instrumentName}\n${debugInfo}\nDouble-click to rename`
      : `${debugInfo}\nDouble-click to rename`;
  })();

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="track-name-input"
        value={editingValue}
        onChange={(e) => setEditingValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        maxLength={32}
      />
    );
  }

  return (
    <span
      className="track-name"
      title={tooltip}
      onClick={handleClick}
      onDoubleClick={canRename ? handleDoubleClick : undefined}
      role="button"
      tabIndex={0}
    >
      {name}
    </span>
  );
}
