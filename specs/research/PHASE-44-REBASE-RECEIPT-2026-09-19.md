# Phase 44 rebase receipt — 2026-09-19

This receipt records the evidence rerun after PR #98 was rebased onto the
shared audio-time, readiness, and graph-ownership stack at `origin/main`
`fdb50459`. It supersedes the old Keyboardia startup numbers for the merge
candidate; it does not rewrite the frozen Tone Nets receipt.

## Architecture reconciliation

- `AudioGraphOwner` remains the sole terminal owner. PR #98 does not install a
  second mobile route in `AudioEngine`.
- `AudioEngine.resumeAllAudioContexts` remains the sole clock-liveness owner.
  The rebased duplicate `clock-liveness.ts` was removed.
- `AudioRuntimeReadiness.prepareForPlayback` remains the preparation boundary.
  The startup observer arms at that boundary, not inside Tone/preload details.
- `note-dispatcher.ts` remains the sole timestamp-policy owner. A measured
  40 ms lead is applied centrally only to events inside the render deadline;
  renderers do not add their own lead.
- `useTrackPrewarm` remembers the stopped snapshot so the first `isPlaying`
  render does not immediately drive `ready → preparing` a second time.

## Environment and commands

- Node: v26.0.0
- Platform: darwin-arm64
- Browser: Chromium 143.0.7499.4
- Audio sample rate: 48 kHz

```bash
USE_MOCK_API=1 E2E_FUNCTIONAL_ONLY=1 CI=true E2E_PORT=5176 \
  npx playwright test e2e/capture-session.spec.ts \
  --project=chromium --workers=1 --retries=0

USE_MOCK_API=1 E2E_FUNCTIONAL_ONLY=1 CI=true E2E_PORT=5176 \
  SAMPLED_FIRST_USE_RECEIPT_TAG=rebase-central-policy \
  npx playwright test e2e/capture-session.spec.ts \
  --project=chromium --workers=1 --retries=0 \
  --grep 'captures sampled first-use' --repeat-each=5
```

The complete PCM file passed 6/6 in 54.6 seconds. The repeated first-use run
passed 5/5 in 31.9 seconds.

## Cold startup (five fresh contexts per path)

| Path | Min | Median | Observed max / p95 at n=5 | Readiness median |
|---|---:|---:|---:|---:|
| Whole engine + native `synth:lead` | 256.2 ms | 261.2 ms | 274.6 ms | 181.1 ms |
| Cold Tone `tone:fm-epiano` | 258.3 ms | 261.5 ms | 266.8 ms | 178.4 ms |
| Cold advanced `advanced:supersaw` | 297.0 ms | 307.0 ms | 344.1 ms | 221.4 ms |

The observer retained the audio-render frame while the main thread was blocked
for more than 700 ms. At five trials, “p95” is the observed maximum and not a
population estimate.

Against the frozen Tone Nets median of 1,215.9 ms, these Keyboardia medians are
74.7–78.5% lower under the documented asymmetric first-contact workloads.

## Sampled first use (five fresh contexts)

- DOM action to first PCM: 79.4–84.7 ms.
- First-versus-steady pre-compressor peak spread: 0.000 dB in every run.
- First-versus-steady pre-compressor RMS spread: 0.027–0.032 dB.
- Heard-output peak spread: at most 0.0082 dB.
- Heard-output RMS spread: at most 0.0312 dB.

Calibration runs on the rebased architecture showed why the old renderer-local
fix could not simply be retained: a 12 ms central lead still left the first
peak 1.35 dB low, and 20 ms left 0.177 dB RMS spread. The retained 40 ms policy
keeps peak identity and bounds integrated energy difference below 0.05 dB while
preserving timestamps that are already safely ahead.

## Room and capacity

The final six-test run measured:

- legacy-vs-explicit-dry residual: −54.11 dB, against a −54.04 dB repeat null;
- default-room full-band tail rise: +20.51 dB;
- default-room low-band body change: −0.049 dB;
- default-room loudness change: −0.014 LU;
- pumping delta: 0.000 dB;
- 16-track heard-output true peak: −0.921 dBTP.

## Velocity-filter calibration

The full repository validator initially rejected the rebased candidate because
the checked-in acoustic-guitar anchors produced a 21.1–35.4% per-note centroid
range despite the documented 26–35% contract. The production solver was rerun
for both supported sample rates and only that stale instrument table was
updated. `npm run validate:velocity-filter` now measures all 281 playable notes:

- 44.1 kHz: 29.4–30.7% v40-versus-v127 centroid reduction;
- 48 kHz: 29.5–30.4%;
- all six instruments remain inside the 26–35% release gate.

The sample-pipeline provenance assertion was also updated to follow an older
mapping-calibration hash through any explicit remediation receipt to the
current manifest. This preserves history without treating the oldest receipt
as the current owner.

## Separate known limitation

The ringer-off route passed the physical iPhone check. Background beat delivery
on iOS browsers and macOS Safari is a different contract and is tracked in
[issue #115](https://github.com/adewale/keyboardia/issues/115).
