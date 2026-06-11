#!/usr/bin/env python3
"""
Instrument quality comparator: scores two instrument trees (e.g. the
git merge-base baseline vs the working tree) on perceptually-grounded
metrics, per instrument.

Metrics and the perception literature behind their thresholds:

  worst/mean pitch shift (st)   Resampling shifts formants with pitch
                                ("munchkinisation"). Best practice is
                                minor-third spacing so material is never
                                shifted more than ~1-2 st; reuse over
                                3-4 st is the accepted ceiling for
                                critical instruments (Sound on Sound,
                                "The Lost Art of Sampling"; Massie,
                                "Wavetable Sampling Synthesis" in Kahrs
                                & Brandenburg 1998).
  onset lead (ms)               Dead time before the -50dBFS onset adds
                                scheduling latency. Ensemble asynchrony
                                is detectable from ~10ms and common to
                                ~50ms (Rasch 1979; ACM JND-latency
                                studies) - leads >=10ms are flagged.
  tuning error (cents)          Pitch JND is ~5-10 cents for complex
                                tones (Moore, Intro. to the Psychology
                                of Hearing; Zwicker & Fastl).
  note-to-note level spread     Adjacent-sample loudness steps >3dB
                                read as an uneven keyboard (1dB is the
                                broadband level JND).
  velocity->brightness ratio    Timbre change across layers, measured
                                as centroid(top)/centroid(bottom) on a
                                noise-gated spectrum. A ratio far from
                                1.0 in EITHER direction means layers
                                differ in timbre (good); the direction
                                is instrument-dependent: jRhodes hard
                                hits grow fundamental mass faster than
                                overtones, so its ratio is correctly
                                < 1 (verified against the source FLACs)
                                while mallets/steel pans go > 1. Do not
                                treat <1 as inverted without checking
                                the source. Requires >=2 layers.
  decay truncation (dB)         Envelope level just before EOF relative
                                to file peak. ~> -35dB on a free decay
                                means an audible cut on held notes.
  clipping                      Inter-sample peaks aside, any run of
                                full-scale samples is a defect.

Usage: compare-sample-quality.py <old_instruments_dir> <new_instruments_dir>
Requires ffmpeg + numpy (dev tool, like validate-acoustic-pitch.py).
"""
import json
import os
import subprocess
import sys

import numpy as np

SR = 44100

UNPITCHED = {
    '808-kick', '808-snare', '808-hihat-closed', '808-hihat-open', '808-clap',
    'acoustic-kick', 'acoustic-snare', 'acoustic-hihat-closed',
    'acoustic-hihat-open', 'acoustic-ride', 'acoustic-crash', 'brushes-snare',
    'vinyl-crackle', 'steel-drums', 'kalimba', 'slap-bass', 'hammond-organ',
}


def decode(path):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'quiet', '-i', path, '-f', 'f32le', '-ac', '1',
         '-ar', str(SR), '-'], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def f0_cents(x, note):
    """Tuning error in cents vs the mapped MIDI note (autocorrelation)."""
    if len(x) < SR // 2:
        return None
    mid = x[len(x) // 4: len(x) // 4 + SR] if len(x) >= 2 * SR \
        else x[len(x) // 3: 2 * len(x) // 3]
    mid = mid - mid.mean()
    corr = np.correlate(mid, mid, 'full')[len(mid) - 1:]
    corr = corr / (corr[0] + 1e-12)
    lo, hi = SR // 2000, SR // 20
    peak = lo + int(np.argmax(corr[lo:hi]))
    half = peak // 2
    if half >= lo and corr[half] > 0.9 * corr[peak]:
        peak = half
    midi = 69 + 12 * np.log2((SR / peak) / 440)
    dev = (midi - note) * 100
    # octave/partial detector errors are not tuning errors; fold and gate
    dev = ((dev + 600) % 1200) - 600
    return dev if abs(dev) <= 90 else None


def file_metrics(path, note=None, pitched=False):
    x = decode(path)
    if len(x) == 0:
        return None
    ax = np.abs(x)
    peak = float(ax.max() + 1e-12)
    on = np.nonzero(ax > 10 ** (-50 / 20))[0]
    onset_ms = (on[0] / SR * 1000) if len(on) else 0.0
    o = on[0] if len(on) else 0
    seg = x[o:o + SR]
    rms_db = 20 * np.log10(float(np.sqrt(np.mean(seg ** 2))) + 1e-12)
    w = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    fr = np.fft.rfftfreq(len(seg), 1 / SR)
    # gate bins 60dB below the spectral peak: broadband noise floor in
    # quiet files otherwise drags the centroid up (made the old jRhodes
    # pp layers read 'brighter' than ff)
    g = w >= w.max() * 1e-3
    centroid = float(np.sum(fr[g] * w[g]) / (np.sum(w[g]) + 1e-12))
    tail = ax[-int(0.25 * SR):]
    trunc_db = 20 * np.log10(float(tail.max() + 1e-12) / peak)
    clip = int(np.sum(ax >= 0.999))
    cents = f0_cents(x, note) if (pitched and note is not None) else None
    return dict(onset_ms=onset_ms, rms_db=rms_db, centroid=centroid,
                trunc_db=trunc_db, clip=clip, cents=cents,
                dur=len(x) / SR)


def instrument_metrics(inst_dir):
    inst = os.path.basename(inst_dir)
    manifest = json.load(open(os.path.join(inst_dir, 'manifest.json')))
    pitched = inst not in UNPITCHED
    per_note = {}
    fm = {}
    for s in manifest['samples']:
        f = s.get('file')
        if not f:
            continue
        m = file_metrics(os.path.join(inst_dir, f), s['note'], pitched)
        if m is None:
            continue
        fm[f] = (s, m)
        per_note.setdefault(s['note'], []).append((s, m))

    notes = sorted(per_note)
    pr = manifest.get('playableRange', {})
    lo, hi = pr.get('min', min(notes)), pr.get('max', max(notes))
    if manifest.get('playbackNote') is not None:
        shifts = [0.0]
    else:
        shifts = [min(abs(n - sn) for sn in notes) for n in range(lo, hi + 1)]

    # loudness evenness: top velocity tier, adjacent sampled notes
    top = {}
    for n, group in per_note.items():
        s, m = max(group, key=lambda t: t[0].get('velocityMin', 0))
        top[n] = m['rms_db']
    steps = [abs(top[b] - top[a]) for a, b in zip(notes, notes[1:])]

    # velocity->brightness: centroid ratio top/bottom layer per note
    ratios = []
    for n, group in per_note.items():
        if len(group) >= 2:
            group = sorted(group, key=lambda t: t[0].get('velocityMin', 0))
            c_lo, c_hi = group[0][1]['centroid'], group[-1][1]['centroid']
            if c_lo > 0:
                ratios.append(c_hi / c_lo)

    cents = [m['cents'] for _, m in fm.values() if m['cents'] is not None]
    payload = sum(os.path.getsize(os.path.join(inst_dir, f)) for f in fm)
    return dict(
        files=len(fm), notes=len(notes),
        layers=max(len(g) for g in per_note.values()),
        payload_kb=payload / 1024,
        worst_shift=max(shifts), mean_shift=float(np.mean(shifts)),
        onset_worst=max(m['onset_ms'] for _, m in fm.values()),
        level_step_worst=max(steps) if steps else 0.0,
        bright_ratio=float(np.mean(ratios)) if ratios else None,
        tune_worst=max(abs(c) for c in cents) if cents else None,
        trunc_worst=max(m['trunc_db'] for _, m in fm.values()),
        clip=sum(m['clip'] for _, m in fm.values()),
        dur_med=float(np.median([m['dur'] for _, m in fm.values()])),
    )


def main(old_root, new_root):
    insts = sorted(d for d in os.listdir(new_root)
                   if os.path.isfile(os.path.join(new_root, d, 'manifest.json')))
    out = {}
    for inst in insts:
        row = {}
        for tag, root in (('old', old_root), ('new', new_root)):
            p = os.path.join(root, inst)
            if os.path.isfile(os.path.join(p, 'manifest.json')):
                row[tag] = instrument_metrics(p)
        out[inst] = row
        o, n = row.get('old'), row.get('new')
        def fmt(v, spec='%.1f'):
            return '--' if v is None else spec % v
        if o and n:
            print(f"== {inst}")
            for k, spec in [('worst_shift', '%.0f'), ('onset_worst', '%.1f'),
                            ('level_step_worst', '%.1f'),
                            ('bright_ratio', '%.2f'), ('tune_worst', '%.0f'),
                            ('trunc_worst', '%.0f'), ('clip', '%d'),
                            ('layers', '%d'), ('payload_kb', '%.0f'),
                            ('dur_med', '%.1f')]:
                print(f"   {k:<18} {fmt(o.get(k), spec):>8} -> "
                      f"{fmt(n.get(k), spec):>8}")
    json.dump(out, open('/tmp/quality-compare.json', 'w'), indent=1)
    print('\nwrote /tmp/quality-compare.json')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
