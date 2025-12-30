import { memo, useState, useMemo } from 'react';
import type { ScaleState } from '../types';
import { SCALES, getScaleNotes, type NoteName, type ScaleId } from '../music/music-theory';
import './ScaleSidebar.css';

interface ScaleSidebarProps {
  scale?: ScaleState;
}

/**
 * Phase 29E: Scale Sidebar (Visualization)
 *
 * A vertical display showing which notes are in the current scale.
 * - Collapsed: Shows just the scale name
 * - Expanded: Shows all scale notes with root/fifth emphasis
 *
 * Per the Key Assistant spec:
 * > "A vertical key scale that expands out to the right of the tracks
 * >  could be a cool way to visualize the pitches + keys."
 *
 * @see docs/research/key-assistant.md
 */
export const ScaleSidebar = memo(function ScaleSidebar({ scale }: ScaleSidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Get the scale definition and notes
  const scaleInfo = useMemo(() => {
    if (!scale) return null;

    const root = scale.root as NoteName;
    const scaleId = scale.scaleId as ScaleId;
    const definition = SCALES[scaleId];

    if (!definition) return null;

    const notes = getScaleNotes(root, scaleId);

    // Calculate the fifth note (7 semitones above root)
    const noteNames: NoteName[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const rootIndex = noteNames.indexOf(root);
    const fifthIndex = (rootIndex + 7) % 12;
    const fifth = noteNames[fifthIndex];

    return {
      root,
      notes,
      definition,
      fifth,
      displayName: `${root} ${definition.shortName}`,
    };
  }, [scale]);

  if (!scaleInfo) {
    return null;
  }

  const { root, notes, definition, fifth, displayName } = scaleInfo;

  return (
    <div className={`scale-sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className="scale-sidebar-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Collapse scale sidebar' : 'Expand scale sidebar'}
      >
        <span className="scale-name">{displayName}</span>
        <span className="toggle-icon">{isExpanded ? '▲' : '▼'}</span>
      </button>

      {isExpanded && (
        <div className="scale-notes">
          {notes.map((note) => {
            const isRoot = note === root;
            const isFifth = note === fifth;

            return (
              <div
                key={note}
                className={[
                  'scale-note',
                  isRoot && 'root',
                  isFifth && 'fifth',
                ].filter(Boolean).join(' ')}
              >
                <span className="note-name">{note}</span>
                {isRoot && <span className="note-label">root</span>}
                {isFifth && <span className="note-label">5th</span>}
              </div>
            );
          })}

          <div className="scale-info">
            <span className="scale-category">{definition.category}</span>
            <span className="scale-full-name">{definition.name}</span>
          </div>
        </div>
      )}
    </div>
  );
});
