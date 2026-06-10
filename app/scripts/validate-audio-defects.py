#!/usr/bin/env python3
"""
Audio defect validator for sampled instruments.

Catches the delivery-format defect classes found in the June 2026 audit
(several of which had shipped silently):

  decoded true peak > 0 dBFS   The Web Audio graph is float, but anything
                               over full scale clips at the destination.
                               128k MP3 overshoots bright content by up
                               to ~2.6dB past the pre-encode peak, so
                               files must be encoded with headroom
                               (EBU R128 s1 recommends <= -1 dBTP for
                               lossy delivery; we encode at <= -2.5).
  flat-top clipping            Runs of >= 4 consecutive samples pinned at
                               the file max = clipping baked into the
                               source or an earlier conversion.
  DC offset > 1%               Wastes headroom and thumps on hard cuts.
  leading silence > 25 ms      Delays the onset past the ~10ms timing
                               JND and defeats the scheduler (P1).
  loop seam mismatch           For loop-flagged samples, the 5ms
                               windows before loopEnd and loopStart
                               must match within 10% of signal RMS
                               after an ~5.5kHz lowpass (8-sample box):
                               seam clicks are broadband transients,
                               while 128k MP3 re-quantizes high
                               harmonics differently per frame, which
                               reads as mismatch but is masked noise.
  range overextension > 6 st   playableRange reaching further than 6
                               semitones beyond the outermost sample
                               guarantees audible munchkinisation
                               (best practice is <= 2-3 st; see
                               compare-sample-quality.py).

Known, deliberate exceptions are listed with reasons. Requires ffmpeg +
numpy (dev tool, like validate-acoustic-pitch.py — not run in CI).

Usage:
    python3 scripts/validate-audio-defects.py            # all instruments
    python3 scripts/validate-audio-defects.py piano      # one instrument
"""
import json
import os
import subprocess
import sys

import numpy as np

SR = 44100
INSTRUMENTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'instruments')

# (instrument, check) -> reason
KNOWN_EXCEPTIONS = {
    ('slap-bass', 'range'):
        'samples E2-C4 with range 28-72; no CC0 slap articulation exists '
        'at the extremes (growlybass has none) and shrinking the range '
        'would silence existing sessions. Documented limitation.',
    ('vinyl-crackle', 'range'):
        'atonal noise bed; pitch-shift distance is irrelevant.',
}


def decode(path):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'quiet', '-i', path, '-f', 'f32le', '-ac', '1',
         '-ar', str(SR), '-'], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def file_defects(path):
    x = decode(path)
    if len(x) == 0:
        return ['decode failed']
    ax = np.abs(x)
    peak = float(ax.max())
    out = []
    if peak > 1.0:
        out.append(f'true peak {20*np.log10(peak):+.1f} dBFS over full scale')
    if peak > 0.97:
        hot = (ax >= 0.985 * peak).view(np.int8)
        d = np.diff(np.concatenate([[0], hot, [0]]))
        runs = np.nonzero(d == 1)[0]
        ends = np.nonzero(d == -1)[0]
        flat = int(np.sum((ends - runs) >= 4))
        if flat > 3:
            out.append(f'{flat} flat-top clipping runs')
    dc = float(np.mean(x))
    if abs(dc) > 0.01:
        out.append(f'DC offset {dc:+.3f}')
    on = np.nonzero(ax > 10 ** (-50 / 20))[0]
    lead = (on[0] / SR * 1000) if len(on) else 0.0
    if lead > 25:
        out.append(f'{lead:.0f}ms leading silence')
    return out


def validate(instruments):
    failures = 0
    for inst in instruments:
        mp = os.path.join(INSTRUMENTS_DIR, inst, 'manifest.json')
        if not os.path.isfile(mp):
            continue
        manifest = json.load(open(mp))
        bad = []
        for s in manifest['samples']:
            f = s.get('file')
            if not f:
                continue
            for d in file_defects(os.path.join(INSTRUMENTS_DIR, inst, f)):
                bad.append((f, d))
        for s_ in manifest['samples']:
            if s_.get('loop') and s_.get('loopStart') is not None:
                x = decode(os.path.join(INSTRUMENTS_DIR, inst, s_['file']))
                a = int(s_['loopStart'] * SR)
                b = int(s_['loopEnd'] * SR)
                w = int(0.005 * SR)
                if b <= len(x) and a >= w:
                    k = np.ones(8) / 8  # ~5.5kHz box lowpass
                    wa = np.convolve(x[a - w:a], k, 'valid')
                    wb = np.convolve(x[b - w:b], k, 'valid')
                    d = float(np.sqrt(np.mean((wb - wa) ** 2)))
                    rms = float(np.sqrt(np.mean(np.convolve(x[a:b], k, 'valid') ** 2))) + 1e-12
                    if d / rms > 0.10:
                        bad.append((s_['file'],
                                    f'loop seam mismatch {d/rms*100:.0f}% of RMS'))
        pr = manifest.get('playableRange')
        if pr and manifest.get('playbackNote') is None:
            notes = sorted({s['note'] for s in manifest['samples']})
            over = max(notes[0] - pr['min'], pr['max'] - notes[-1], 0)
            if over > 6 and (inst, 'range') not in KNOWN_EXCEPTIONS:
                bad.append(('manifest', f'range extends {over} st past outermost sample'))
        if bad:
            print(f'XX {inst}')
            for f, d in bad:
                print(f'     {f}: {d}')
            failures += len(bad)
        else:
            print(f'OK {inst}')
    print(f'\n{failures} defects')
    return failures


def main():
    if len(sys.argv) > 1:
        instruments = sys.argv[1:]
    else:
        instruments = sorted(
            d for d in os.listdir(INSTRUMENTS_DIR)
            if os.path.isdir(os.path.join(INSTRUMENTS_DIR, d)))
    sys.exit(1 if validate(instruments) else 0)


if __name__ == '__main__':
    main()
