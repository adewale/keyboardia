import { memo, useState, useMemo } from 'react';
import type { ScaleState, Track } from '../types';
import { SCALES, getScaleNotes, type NoteName, type ScaleId } from '../music/music-theory';
import './ScaleSidebar.css';

interface ScaleSidebarProps {
  scale?: ScaleState;
  tracks?: Track[]; // Phase 31H: Active usage indicators - shows which notes are being used
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
 * @see specs/research/key-assistant.md
 */
// Helper to check if a track is melodic (supports pitch)
function isMelodicTrack(sampleId: string): boolean {
  if (sampleId.startsWith('synth:') && !sampleId.includes('noise')) return true;
  if (sampleId.startsWith('tone:')) return true;
  if (sampleId.startsWith('advanced:')) return true;
  if (sampleId.startsWith('sampled:')) return true;
  return false;
}

export const ScaleSidebar = memo(function ScaleSidebar({ scale, tracks }: ScaleSidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Note names for converting indices to display names
  const noteNames: NoteName[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Get the scale definition and notes
  const scaleInfo = useMemo(() => {
    if (!scale) return null;

    const root = scale.root as NoteName;
    const scaleId = scale.scaleId as ScaleId;
    const definition = SCALES[scaleId];

    if (!definition) return null;

    const rootIndex = noteNames.indexOf(root);

    // getScaleNotes returns numeric indices (0-11), convert to note names
    const noteIndices = getScaleNotes(rootIndex, scaleId);
    const notes = noteIndices.map(idx => noteNames[idx]);

    // Calculate the fifth note (7 semitones above root)
    const fifthIndex = (rootIndex + 7) % 12;
    const fifth = noteNames[fifthIndex];

    return {
      root,
      notes,
      definition,
      fifth,
      displayName: `${root} ${definition.shortName}`,
    };
  }, [scale, noteNames]);

  // Phase 31H: Calculate which notes are actively used in tracks
  const activeNotes = useMemo(() => {
    const used = new Set<NoteName>();
    if (!tracks) return used;

    for (const track of tracks) {
      // Only check melodic tracks
      if (!isMelodicTrack(track.sampleId)) continue;

      const trackTranspose = track.transpose ?? 0;

      for (let i = 0; i < track.steps.length; i++) {
        if (!track.steps[i]) continue;

        // Get pitch lock (p-lock) for this step, default 0
        const pitchLock = track.parameterLocks[i]?.pitch ?? 0;

        // Calculate final MIDI note relative to C4 (60)
        // Then normalize to 0-11 pitch class
        const totalOffset = trackTranspose + pitchLock;
        const pitchClass = ((totalOffset % 12) + 12) % 12;

        used.add(noteNames[pitchClass]);
      }
    }

    return used;
  }, [tracks, noteNames]);

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
            const isActive = activeNotes.has(note); // Phase 31H: Active usage indicator

            return (
              <div
                key={note}
                className={[
                  'scale-note',
                  isRoot && 'root',
                  isFifth && 'fifth',
                  isActive && 'active', // Phase 31H: Highlight notes in use
                ].filter(Boolean).join(' ')}
              >
                <span className="note-name">{note}</span>
                {isActive && <span className="usage-indicator" title="Note is being used in tracks" />}
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
