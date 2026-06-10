#!/usr/bin/env python3
"""
Acoustic pitch validator for sampled instruments.

Decodes every sample (via ffmpeg) and estimates its sounding pitch with
autocorrelation, then compares against the manifest's MIDI note mapping.

This tool found the June 2026 octave bugs: french-horn/alto-sax/marimba
mapped 12 semitones below their sounding pitch, clean-guitar 12 above,
rhodes-ep "C" files that actually contained E2/D3/D4/F4, and a
string-section whose files were a mix of correct cello and +12 viola.
Root cause in every case: sample-library file names follow per-library
octave conventions (written pitch, octave-below-sounding, etc.) and were
mapped at face value. Trust the audio, not the file name.

Usage:
    python3 scripts/validate-acoustic-pitch.py            # all instruments
    python3 scripts/validate-acoustic-pitch.py marimba    # one instrument

Requires: ffmpeg on PATH (dev tool — not part of CI, which has no ffmpeg).

Exit code 1 if any non-exempt sample's detected pitch disagrees with its
manifest note.

Autocorrelation has known failure modes; verified exceptions are listed
in KNOWN_EXCEPTIONS with the reason, and inharmonic instruments (steel
pan, kalimba, slap articulations, drawbar organ with 16' sub-octave,
unpitched drums) are skipped entirely. When this tool flags a file,
confirm with a spectral peak listing before concluding the mapping is
wrong: a clean harmonic series f0, 2f0, 3f0... in the spectrum is the
ground truth.
"""

import json
import os
import subprocess
import sys

import numpy as np

INSTRUMENTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'instruments')

# Instruments whose timbre defeats autocorrelation pitch estimation.
SKIP_INSTRUMENTS = {
    # unpitched / one-shot percussion
    '808-kick', '808-snare', '808-hihat-closed', '808-hihat-open', '808-clap',
    'acoustic-kick', 'acoustic-snare', 'acoustic-hihat-closed', 'acoustic-hihat-open',
    'acoustic-ride', 'acoustic-crash', 'brushes-snare', 'vinyl-crackle',
    # strongly inharmonic partials (strike tone != lowest partial)
    'steel-drums', 'kalimba',
    # percussive articulations too short/noisy for stable f0
    'slap-bass',
    # drawbar registration includes a 16' rank one octave below the played
    # key, so the detected fundamental is legitimately -12 from the mapping
    'hammond-organ',
}

# (instrument, file) -> reason. Spectrally verified despite detector flag.
KNOWN_EXCEPTIONS = {
    ('piano', 'F3-ff.mp3'):
        '2nd harmonic louder than fundamental on ff strike; series confirms F3',
    ('marimba', 'F2-pp.mp3'):
        'soft low strike: LF rumble beats fundamental; spectrum shows 88Hz = F2',
    ('marimba', 'F6-pp.mp3'):
        'soft strike: detector grabs partial; spectrum shows 1395Hz = F6',
    ('marimba', 'C7-pp.mp3'):
        'very soft top bar barely above noise floor; ff sibling confirms C7',
    ('marimba', 'C7-ff.mp3'):
        'top marimba bars are stretch-tuned; reads ~1 semitone flat (2094Hz = C7)',
    ('vibraphone', 'F3-mf.mp3'):
        'detector grabs the ~11x strike partial (1913Hz); spectrum shows 174Hz = F3',
    ('finger-bass', 'C1.mp3'):
        'fundamental 32.7Hz at detector floor; harmonic series confirms C1',
    ('finger-bass', 'Gb2.mp3'):
        'weak fundamental; series (2nd/3rd/5th harmonics) confirms F#2',
    ('finger-bass', 'Gb3.mp3'):
        'short sample; below detector minimum length',
}


def decode(path, sr=44100):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'quiet', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(sr), '-'],
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32), sr


def detect_midi(path):
    """Autocorrelation f0 estimate of the sustained portion; returns float MIDI or None."""
    x, sr = decode(path)
    if len(x) < sr // 2:
        return None
    mid = x[len(x) // 4: len(x) // 4 + sr] if len(x) >= sr * 2 else x[len(x) // 3: 2 * len(x) // 3]
    mid = mid - mid.mean()
    corr = np.correlate(mid, mid, 'full')[len(mid) - 1:]
    corr = corr / (corr[0] + 1e-12)
    lo, hi = sr // 2000, sr // 20  # 20Hz .. 2kHz
    peak = lo + int(np.argmax(corr[lo:hi]))
    # If the half lag (octave up) is nearly as strong, the true period is
    # probably the shorter one (autocorr's classic subharmonic error).
    half = peak // 2
    if half >= lo and corr[half] > 0.9 * corr[peak]:
        peak = half
    f0 = sr / peak
    return 69 + 12 * float(np.log2(f0 / 440))


def validate(instruments):
    failures = 0
    checked = 0
    for inst in instruments:
        manifest_path = os.path.join(INSTRUMENTS_DIR, inst, 'manifest.json')
        if not os.path.exists(manifest_path):
            continue
        if inst in SKIP_INSTRUMENTS:
            print(f'-- {inst}: skipped (inharmonic/unpitched)')
            continue
        manifest = json.load(open(manifest_path))
        bad = []
        for sample in manifest['samples']:
            fname = sample.get('file')
            if not fname:
                continue
            midi = detect_midi(os.path.join(INSTRUMENTS_DIR, inst, fname))
            checked += 1
            if midi is None:
                continue
            diff = round(midi) - sample['note']
            if diff != 0:
                if (inst, fname) in KNOWN_EXCEPTIONS:
                    continue
                bad.append((fname, sample['note'], round(midi), diff))
        if bad:
            print(f'XX {inst}: PITCH MISMATCH')
            for fname, mapped, detected, diff in bad:
                print(f'     {fname}: mapped={mapped} detected={detected} ({diff:+d} semitones)')
            failures += len(bad)
        else:
            print(f'OK {inst}')
    print(f'\n{checked} samples checked, {failures} mismatches')
    return failures


def main():
    if len(sys.argv) > 1:
        instruments = sys.argv[1:]
    else:
        instruments = sorted(
            d for d in os.listdir(INSTRUMENTS_DIR)
            if os.path.isdir(os.path.join(INSTRUMENTS_DIR, d))
        )
    sys.exit(1 if validate(instruments) else 0)


if __name__ == '__main__':
    main()
