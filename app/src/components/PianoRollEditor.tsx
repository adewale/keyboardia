/**
 * Piano roll dock: the Notes pane's roll.
 *
 * Draws one track as note bars (ties merged, velocity as brightness) on a
 * C2..C6 pitch grid that sits on the rows' step geometry (39px pitch, 8px
 * page gap after every 16 steps; step-geometry.ts), with a proportioned
 * keyboard and a best-range rail in the left column, ghost notes from other
 * melodic tracks, and a single hit layer that turns pointer coordinates into
 * {step, midi} for placing, painting, re-pitching, resizing and removing.
 *
 * Every edit is an existing mutation: toggle step and set parameter lock.
 *
 * @see specs/PIANO-ROLL-DOCK.md (Visual Representation, Interaction Design)
 * @see specs/mocks/piano-roll-dock.html (renderDock, drawNotes, drawGhosts, bindHit)
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Track, ParameterLock, ScaleState, LoopRegion } from '../types';
import { HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { previewInstrument, signalMusicIntent } from '../audio/audioTriggers';
import { getInstrumentRange } from '../audio/instrument-ranges';
import {
  MIDI_MAX,
  MIDI_MIN,
  ROW_COUNT,
  ROW_H,
  barAt,
  computeBars,
  ghostBars,
  isBlackKey,
  keyGeometry,
  noteName,
  pitchLockFor,
  rowClasses,
  rowOf,
  snapToScale,
  isPitchInScale,
  trackLength,
  velocityColor,
  velocityGlow,
  type NoteBar,
} from './piano-roll-bars';
import {
  DESKTOP_STEP_GEOMETRY,
  cellWidth,
  gridWidth as stepsWidth,
  spanWidth,
  stepToX,
  xToStep,
} from './step-geometry';
import './PianoRollEditor.css';

export interface PianoRollEditorProps {
  track: Track;                       // the docked track
  ghostTracks?: Array<{ track: Track; color: string; visible: boolean }>; // other melodic tracks
  currentStep: number;                // -1 when stopped
  anySoloed: boolean;
  scale?: ScaleState;
  loopRegion?: LoopRegion | null;
  detent?: 'compact' | 'tall';        // grid viewport height 252px / 432px
  readOnly?: boolean;
  selectedStep?: number | null;       // highlights that step's column
  onToggleStep?: (step: number) => void;
  onSetParameterLock: (step: number, lock: ParameterLock | null) => void;
  onSelectStep?: (step: number) => void;   // Shift+click or long-press on a bar/cell
}

/** Audition length for keys and edits, in seconds. */
const AUDITION_SECONDS = 0.18;
/** A pointer this close to a bar's right edge resizes instead of moving. */
const RESIZE_ZONE_PX = 9;
/** Touch hold that discloses the Step pane, matching useLongPress. */
const LONG_PRESS_MS = 400;
/** How long a clicked key shows as pressed. */
const KEY_PRESS_MS = 160;

const GRID_HEIGHT = ROW_COUNT * ROW_H;

/** The roll's 36px cells sit on the desktop rows' geometry. */
const GEOMETRY = DESKTOP_STEP_GEOMETRY;
const CELL_W = cellWidth(GEOMETRY);
/** Left edge of a step's column in the grid, in px. */
const xOf = (step: number): number => stepToX(step, GEOMETRY);

type LineWeight = 'bar' | 'beat' | 'step';

/**
 * The grid's vertical lines, one at each cell's left edge, and a band over
 * each page gap. Explicit elements rather than a repeating gradient, because
 * the page gap makes the step pitch non-uniform.
 */
function columnLines(length: number) {
  const lines: Array<{ step: number; left: number; weight: LineWeight }> = [];
  const pageGaps: Array<{ step: number; left: number }> = [];
  for (let step = 0; step < length; step++) {
    const left = xOf(step);
    const weight: LineWeight = step % GEOMETRY.stepsPerPage === 0 ? 'bar' : step % 4 === 0 ? 'beat' : 'step';
    lines.push({ step, left, weight });
    if (step > 0 && step % GEOMETRY.stepsPerPage === 0) {
      // The page gap sits just before the boundary's bar line.
      pageGaps.push({ step, left: left - GEOMETRY.pageGap });
    }
  }
  return { lines, pageGaps };
}

const ALL_MIDI: number[] = Array.from({ length: ROW_COUNT }, (_, i) => MIDI_MAX - i);
// White keys first so black keys, drawn later, sit above them.
const KEY_ORDER: number[] = [...ALL_MIDI].sort(
  (a, b) => Number(isBlackKey(a)) - Number(isBlackKey(b)),
);

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Copy of `lock` with its pitch set; 0 is stored as no pitch, as the previous roll did. */
function withPitch(lock: ParameterLock | null | undefined, pitch: number): ParameterLock | null {
  const next: ParameterLock = { ...(lock ?? {}) };
  if (pitch === 0) delete next.pitch;
  else next.pitch = pitch;
  return Object.keys(next).length > 0 ? next : null;
}

interface HoverState {
  step: number;
  midi: number;
  nearEdge: boolean;
}

type DragState =
  | { kind: 'paint'; pointerId: number; lastStep: number; midi: number; placed: Map<number, number> }
  | { kind: 'move'; pointerId: number; bar: NoteBar; midi: number; moved: boolean; locks: (ParameterLock | null)[] }
  | { kind: 'resize'; pointerId: number; bar: NoteBar; len: number; changed: boolean; on: Map<number, boolean> };

type DragKind = DragState['kind'];

export const PianoRollEditor = memo(function PianoRollEditor({
  track,
  ghostTracks,
  currentStep,
  anySoloed,
  scale,
  loopRegion,
  detent = 'compact',
  readOnly = false,
  selectedStep,
  onToggleStep,
  onSetParameterLock,
  onSelectStep,
}: PianoRollEditorProps) {
  const length = trackLength(track);
  const gridWidth = stepsWidth(length, GEOMETRY);
  const columns = useMemo(() => columnLines(length), [length]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const keycolRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const centredTrackRef = useRef<string | null>(null);

  const [hover, setHover] = useState<HoverState | null>(null);
  const [pressedKey, setPressedKey] = useState<number | null>(null);
  const [dragging, setDragging] = useState<{ kind: DragKind; start: number } | null>(null);

  const bars = useMemo(() => computeBars(track, length), [track, length]);
  const range = useMemo(() => getInstrumentRange(track.sampleId), [track.sampleId]);

  const rowClassList = useMemo(
    () => new Map(ALL_MIDI.map(midi => [midi, rowClasses(midi, track.sampleId, scale).join(' ')])),
    [track.sampleId, scale],
  );

  // Playhead visibility follows the previous roll: hidden on silent tracks.
  const isAudible = anySoloed ? track.soloed : !track.muted;
  const playingStep = currentStep >= 0 ? currentStep % length : -1;
  const showPlayhead = playingStep >= 0 && (!HIDE_PLAYHEAD_ON_SILENT_TRACKS || isAudible);

  const ghosts = useMemo(() => (ghostTracks ?? [])
    .filter(g => g.visible && g.track.id !== track.id)
    .map(g => ({ id: g.track.id, name: g.track.name, color: g.color, bars: ghostBars(g.track, length) })),
  [ghostTracks, track.id, length]);

  // ---------------------------------------------------------------------------
  // Vertical scroll: keys and rail follow the grid; centre on the notes.
  // ---------------------------------------------------------------------------

  const syncKeyboard = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const transform = `translateY(${-scroller.scrollTop}px)`;
    if (railRef.current) railRef.current.style.transform = transform;
    if (keycolRef.current) keycolRef.current.style.transform = transform;
  }, []);

  const centreMidi = useMemo(() => {
    if (bars.length > 0) {
      const mids = bars.map(b => b.midi);
      return (Math.min(...mids) + Math.max(...mids)) / 2;
    }
    const lo = range.optimalMin ?? range.minMidi;
    const hi = range.optimalMax ?? range.maxMidi;
    return Math.min(MIDI_MAX, Math.max(MIDI_MIN, (lo + hi) / 2));
  }, [bars, range]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || centredTrackRef.current === track.id) return;
    const firstMount = centredTrackRef.current === null;
    centredTrackRef.current = track.id;
    const top = Math.max(0, rowOf(centreMidi) * ROW_H - scroller.clientHeight / 2);
    if (!firstMount && !prefersReducedMotion() && typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top, behavior: 'smooth' });
    } else {
      scroller.style.scrollBehavior = 'auto';
      scroller.scrollTop = top;
      scroller.style.scrollBehavior = '';
    }
    syncKeyboard();
  }, [track.id, centreMidi, syncKeyboard]);

  // Touch: the hit layer takes every gesture on the grid (touch-action: none)
  // for placing and dragging notes, so the grid cannot be swiped to another
  // octave. A vertical swipe on the keyboard column scrolls it instead; on a
  // phone in landscape there is no other way to reach the rows out of view.
  const keySwipeRef = useRef<{ pointerId: number; startY: number; startTop: number } | null>(null);

  const handleKeysPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const scroller = scrollRef.current;
    if (e.pointerType !== 'touch' || !scroller) return;
    keySwipeRef.current = { pointerId: e.pointerId, startY: e.clientY, startTop: scroller.scrollTop };
    // Follow the finger, not the smooth-scroll animation.
    scroller.style.scrollBehavior = 'auto';
  }, []);

  const handleKeysPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const swipe = keySwipeRef.current;
    const scroller = scrollRef.current;
    if (!swipe || swipe.pointerId !== e.pointerId || !scroller) return;
    scroller.scrollTop = swipe.startTop - (e.clientY - swipe.startY);
  }, []);

  const handleKeysPointerEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (keySwipeRef.current?.pointerId !== e.pointerId) return;
    keySwipeRef.current = null;
    if (scrollRef.current) scrollRef.current.style.scrollBehavior = '';
  }, []);

  useEffect(() => () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    if (keyPressTimerRef.current) clearTimeout(keyPressTimerRef.current);
  }, []);

  // ---------------------------------------------------------------------------
  // Audio
  // ---------------------------------------------------------------------------

  const audition = useCallback((midi: number) => {
    void previewInstrument('preview_pitch', {
      sampleId: track.sampleId,
      previewId: `preview-${track.id}`,
      pitch: midi - 60,
      duration: AUDITION_SECONDS,
    });
  }, [track.sampleId, track.id]);

  const handleKeyDown = useCallback((midi: number) => {
    void signalMusicIntent('chromatic_click');
    audition(midi);
    setPressedKey(midi);
    if (keyPressTimerRef.current) clearTimeout(keyPressTimerRef.current);
    keyPressTimerRef.current = setTimeout(() => setPressedKey(null), KEY_PRESS_MS);
  }, [audition]);

  // ---------------------------------------------------------------------------
  // Hit layer
  // ---------------------------------------------------------------------------

  const pointerToCell = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - rect.left), gridWidth - 1);
    const y = Math.min(Math.max(0, e.clientY - rect.top), GRID_HEIGHT - 1);
    const step = Math.min(length - 1, Math.max(0, xToStep(x, GEOMETRY)));
    return { x, step, midi: MIDI_MAX - Math.floor(y / ROW_H) };
  };

  const nearRightEdge = (x: number, bar: NoteBar) =>
    x > xOf(bar.start) + spanWidth(bar.start, bar.len, GEOMETRY) - RESIZE_ZONE_PX;

  const updateHover = (step: number, midi: number, x: number) => {
    const bar = barAt(bars, step, midi);
    const nearEdge = !!bar && nearRightEdge(x, bar);
    setHover(prev => (prev && prev.step === step && prev.midi === midi && prev.nearEdge === nearEdge)
      ? prev
      : { step, midi, nearEdge });
  };

  const cancelLongPress = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const endDrag = (target: HTMLElement, pointerId: number) => {
    dragRef.current = null;
    setDragging(null);
    cancelLongPress();
    try {
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
    } catch {
      // Capture already gone.
    }
  };

  /** Turn a step on at `midi`, writing a fresh pitch lock (clears stale ties). */
  const placeStep = (step: number, midi: number, alreadyOn: boolean) => {
    const pitch = pitchLockFor(track, midi);
    if (!alreadyOn) onToggleStep?.(step);
    if (pitch !== 0 || track.parameterLocks[step] || alreadyOn) {
      onSetParameterLock(step, pitch === 0 ? null : { pitch });
    }
  };

  const removeBar = (bar: NoteBar) => {
    for (let s = bar.start; s < bar.start + bar.len; s++) {
      if (track.steps[s]) onToggleStep?.(s);
      // A tie on a silent step would silently join a future note to its neighbour.
      if (s > bar.start && track.parameterLocks[s]?.tie) onSetParameterLock(s, null);
    }
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly || e.button !== 0) return;
    // One drag at a time: a second finger landing mid-drag must not replace
    // the drag the first finger owns.
    if (dragRef.current && dragRef.current.pointerId !== e.pointerId) return;
    const p = pointerToCell(e);
    const bar = barAt(bars, p.step, p.midi);

    if (e.shiftKey) {
      e.preventDefault();
      onSelectStep?.(bar ? bar.start : p.step);
      return;
    }
    if (!bar && !onToggleStep) return;

    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not every environment supports capture; the drag still works inside the layer.
    }
    void signalMusicIntent('chromatic_click');

    if (bar) {
      const resizing = nearRightEdge(p.x, bar);
      if (resizing) {
        dragRef.current = { kind: 'resize', pointerId: e.pointerId, bar, len: bar.len, changed: false, on: new Map() };
      } else {
        const locks = Array.from({ length: bar.len }, (_, i) => track.parameterLocks[bar.start + i] ?? null);
        dragRef.current = { kind: 'move', pointerId: e.pointerId, bar, midi: bar.midi, moved: false, locks };
      }
      setDragging({ kind: resizing ? 'resize' : 'move', start: bar.start });
      if (e.pointerType === 'touch' && onSelectStep) {
        const target = e.currentTarget;
        const pointerId = e.pointerId;
        longPressRef.current = setTimeout(() => {
          longPressRef.current = null;
          endDrag(target, pointerId);
          onSelectStep(bar.start);
        }, LONG_PRESS_MS);
      }
    } else {
      const midi = snapToScale(p.midi, scale);
      placeStep(p.step, midi, !!track.steps[p.step]);
      audition(midi);
      dragRef.current = { kind: 'paint', pointerId: e.pointerId, lastStep: p.step, midi, placed: new Map([[p.step, midi]]) };
      setDragging({ kind: 'paint', start: p.step });
    }
    updateHover(p.step, p.midi, p.x);
  };

  const dragTo = (drag: DragState, step: number, rawMidi: number) => {
    if (drag.kind === 'paint') {
      const midi = snapToScale(rawMidi, scale);
      if (step === drag.lastStep && midi === drag.midi) return;
      const from = Math.min(drag.lastStep, step);
      const to = Math.max(drag.lastStep, step);
      for (let s = from; s <= to; s++) {
        const placedAt = drag.placed.get(s);
        if (placedAt !== undefined) {
          if (placedAt !== midi) {
            placeStep(s, midi, true);
            drag.placed.set(s, midi);
          }
        } else if (!track.steps[s]) {
          // Paint fills empty steps only; it never overwrites another note.
          placeStep(s, midi, false);
          drag.placed.set(s, midi);
        }
      }
      if (midi !== drag.midi) audition(midi);
      drag.lastStep = step;
      drag.midi = midi;
    } else if (drag.kind === 'move') {
      const midi = snapToScale(rawMidi, scale);
      if (midi === drag.midi) return;
      const pitch = pitchLockFor(track, midi);
      drag.locks.forEach((lock, i) => onSetParameterLock(drag.bar.start + i, withPitch(lock, pitch)));
      drag.midi = midi;
      drag.moved = true;
      cancelLongPress();
      audition(midi);
    } else {
      const { bar } = drag;
      const newLen = Math.min(length - bar.start, Math.max(1, step - bar.start + 1));
      if (newLen === drag.len) return;
      const isOn = (s: number) => drag.on.get(s) ?? !!track.steps[s];
      const pitch = pitchLockFor(track, bar.midi);
      const startLock = track.parameterLocks[bar.start];
      for (let s = bar.start + drag.len; s < bar.start + newLen; s++) {
        if (!isOn(s)) onToggleStep?.(s);
        drag.on.set(s, true);
        const tied: ParameterLock = { tie: true };
        if (pitch !== 0) tied.pitch = pitch;
        if (startLock?.volume !== undefined) tied.volume = startLock.volume;
        onSetParameterLock(s, tied);
      }
      for (let s = bar.start + newLen; s < bar.start + drag.len; s++) {
        if (isOn(s)) onToggleStep?.(s);
        drag.on.set(s, false);
        onSetParameterLock(s, null);
      }
      drag.len = newLen;
      drag.changed = true;
      cancelLongPress();
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    // Another pointer moving during a drag neither edits nor moves the hover.
    if (drag && drag.pointerId !== e.pointerId) return;
    const p = pointerToCell(e);
    if (drag && !readOnly) {
      // A hold only counts while the finger stays on the bar it pressed.
      if (drag.kind !== 'paint' && (p.midi !== drag.bar.midi || p.step < drag.bar.start
        || p.step >= drag.bar.start + drag.bar.len)) {
        cancelLongPress();
      }
      dragTo(drag, p.step, p.midi);
    }
    updateHover(p.step, p.midi, p.x);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    endDrag(e.currentTarget, e.pointerId);
    // A long press that fired has already ended the drag, so an untouched
    // bar here is a tap: remove it.
    if ((drag.kind === 'move' && !drag.moved) || (drag.kind === 'resize' && !drag.changed)) {
      removeBar(drag.bar);
    }
    const p = pointerToCell(e);
    updateHover(p.step, p.midi, p.x);
  };

  // A cancelled or uncaptured pointer ends the drag without committing a tap,
  // but only when it is the pointer that owns the drag: another finger's
  // cancel must leave the first finger's drag (and its capture) alone.
  const handlePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId !== e.pointerId) return;
    if (drag) endDrag(e.currentTarget, drag.pointerId);
    setHover(null);
  };

  const handleLostPointerCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    endDrag(e.currentTarget, drag.pointerId);
  };

  const handlePointerLeave = () => {
    if (!dragRef.current) setHover(null);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hoverBar = hover ? barAt(bars, hover.step, hover.midi) : undefined;
  const hoverMidi = hover?.midi ?? null;
  const showHoverGhost = !!hover && !hoverBar && !readOnly && !dragging
    && isPitchInScale(hover.midi, scale);

  let cursor: CSSProperties['cursor'] = 'crosshair';
  if (readOnly) cursor = 'default';
  else if (hoverBar) cursor = hover?.nearEdge ? 'ew-resize' : 'grab';

  let tipText = '';
  if (hover) {
    const below = hover.midi < range.minMidi ? ' · below the instrument' : '';
    tipText = hoverBar
      ? ` · ${hoverBar.len} ${hoverBar.len === 1 ? 'step' : 'steps'} · vel ${Math.round(hoverBar.vel * 127)}${below}`
      : ` · step ${hover.step + 1}${below}`;
  }
  const tipName = hover ? noteName(hoverBar ? hoverBar.midi : hover.midi) : '';

  const optLo = Math.max(MIDI_MIN, range.optimalMin ?? range.minMidi);
  const optHi = Math.min(MIDI_MAX, range.optimalMax ?? range.maxMidi);
  const hasBracket = optLo <= optHi;

  const loopStart = loopRegion ? Math.max(0, Math.min(loopRegion.start, loopRegion.end)) : 0;
  const loopEnd = loopRegion ? Math.max(loopRegion.start, loopRegion.end) : 0;

  const showSelected = selectedStep != null && selectedStep >= 0 && selectedStep < length;

  const rootClass = [
    'piano-roll-editor',
    detent === 'tall' && 'piano-roll-editor--tall',
    readOnly && 'piano-roll-editor--readonly',
  ].filter(Boolean).join(' ');

  const gridClass = [
    'grid',
    hover && 'hovering',
    hover && !hoverBar && 'empty',
    loopRegion && 'has-loop',
    showPlayhead && 'playing',
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClass} role="group" aria-label={`Piano roll: ${track.name}`}>
      <div
        className="piano-roll-editor__left"
        onPointerDown={handleKeysPointerDown}
        onPointerMove={handleKeysPointerMove}
        onPointerUp={handleKeysPointerEnd}
        onPointerCancel={handleKeysPointerEnd}
      >
        <div className="range-rail" ref={railRef} style={{ height: GRID_HEIGHT }}>
          {hasBracket && (
            <div
              className="bracket"
              style={{ top: rowOf(optHi) * ROW_H + 2, height: (optHi - optLo + 1) * ROW_H - 4 }}
              title={`Best range for ${track.name}: ${noteName(optLo)} to ${noteName(optHi)}`}
            />
          )}
        </div>
        <div className="keycol" ref={keycolRef} style={{ height: GRID_HEIGHT }}>
          {KEY_ORDER.map(midi => {
            const { top, height } = keyGeometry(midi);
            const name = noteName(midi);
            const cls = [
              'key',
              rowClassList.get(midi),
              hoverMidi === midi && 'hover',
              pressedKey === midi && 'pressed',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={midi}
                type="button"
                tabIndex={-1}
                className={cls}
                style={{ top, height }}
                title={name}
                aria-label={`Play ${name}`}
                data-midi={midi}
                onPointerDown={() => handleKeyDown(midi)}
              >
                <span className="lbl">{name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="dock-scroll" ref={scrollRef} onScroll={syncKeyboard}>
        <div className={gridClass} style={{ width: gridWidth, height: GRID_HEIGHT }}>
          {ALL_MIDI.map((midi, i) => (
            <div key={midi} className={`row ${rowClassList.get(midi)}`} style={{ top: i * ROW_H, height: ROW_H }} />
          ))}
          <div className="lines">
            {columns.pageGaps.map(g => (
              <div key={`gap-${g.step}`} className="page-gap" data-step={g.step} style={{ left: g.left, width: GEOMETRY.pageGap }} />
            ))}
            {columns.lines.map(l => (
              <div key={l.step} className={`vline ${l.weight}`} data-step={l.step} style={{ left: l.left }} />
            ))}
          </div>
          {loopRegion && (
            <>
              <div className="loop-shade" style={{ left: 0, width: xOf(loopStart) }} />
              <div className="loop-shade" style={{ left: xOf(loopEnd) + CELL_W, right: 0 }} />
            </>
          )}
          {hover && (
            <>
              <div className="hl-row" style={{ top: rowOf(hover.midi) * ROW_H, height: ROW_H }} />
              <div className="hl-col" style={{ left: xOf(hover.step) }} />
            </>
          )}
          {showSelected && <div className="sel-col on" style={{ left: xOf(selectedStep) }} />}

          <div className="ghosts">
            {ghosts.map(g => g.bars.map((b, i) => (
              <div
                key={`${g.id}-${i}`}
                className={b.pass > 0 ? 'gnote repeat' : 'gnote'}
                data-ghost-track={g.id}
                title={`${g.name} · ${noteName(b.midi)}`}
                style={{
                  '--gc': g.color,
                  left: xOf(b.start),
                  width: spanWidth(b.start, b.len, GEOMETRY),
                  top: rowOf(b.midi) * ROW_H + 3,
                  height: ROW_H - 6,
                } as CSSProperties}
              />
            )))}
          </div>

          <div className="notes" key={track.id}>
            {bars.map(b => {
              const playing = showPlayhead && playingStep >= b.start && playingStep < b.start + b.len;
              const cls = [
                'note',
                playing && 'playing',
                dragging && dragging.kind !== 'paint' && dragging.start === b.start && 'dragging',
              ].filter(Boolean).join(' ');
              return (
                <div
                  key={b.start}
                  className={cls}
                  data-start={b.start}
                  data-len={b.len}
                  data-midi={b.midi}
                  style={{
                    '--glow': velocityGlow(b.vel),
                    left: xOf(b.start),
                    width: spanWidth(b.start, b.len, GEOMETRY),
                    top: rowOf(b.midi) * ROW_H + 2,
                    height: ROW_H - 4,
                    background: velocityColor(b.vel),
                  } as CSSProperties}
                >
                  {b.len >= 2 ? noteName(b.midi) : null}
                </div>
              );
            })}
          </div>

          {showHoverGhost && hover && (
            <div className="ghost" style={{ left: xOf(hover.step), top: rowOf(hover.midi) * ROW_H + 2 }} />
          )}

          {showPlayhead && (
            <>
              <div className="wash" style={{ left: xOf(playingStep) }} />
              <div className="playhead" style={{ left: xOf(playingStep) }} />
            </>
          )}

          <div
            className="hit"
            style={{ cursor }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handleLostPointerCapture}
            onPointerLeave={handlePointerLeave}
          />

          {hover && (
            <div className="tip" style={{ left: xOf(hover.step) + GEOMETRY.stepPitch / 2, top: rowOf(hover.midi) * ROW_H + ROW_H / 2 }}>
              <b>{tipName}</b>{tipText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
