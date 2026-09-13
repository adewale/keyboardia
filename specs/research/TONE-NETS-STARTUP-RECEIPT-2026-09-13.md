# Keyboardia / Tone Nets cold-start receipt — 2026-09-13

This is the compact, checked-in receipt for the final paired batch reported in
[`TONE-NETS-COMPARISON-2026-08.md`](./TONE-NETS-COMPARISON-2026-08.md). Values
are milliseconds from the named user action. They are raw retained trials, not
an estimate from the summary table.

Both runs used macOS arm64, Node 26.0.0, Chromium 143.0.7499.4, 48 kHz, one
warm local server/browser process, and a fresh browser context/audio engine per
trial. Keyboardia was measured at `2026-09-13T20:32:30.190Z`. Tone Nets was
measured at `2026-09-13T20:38:30.774Z` from source commit
`d6e9ba837f2e408971458c5ca6f6b63d0c909d76`; the runner verified all ten
frozen asset hashes before launching Chromium.

## Raw Keyboardia trials

`Observer ready` is AudioWorklet readiness. `Boundary` is release of the
awaited preload hook immediately before `scheduler.start()`. The test refuses
to release that boundary before observer readiness, and the conservative wait
is included in first-PCM latency.

| Path | Trial | Observer ready | Boundary | First master PCM |
|---|---:|---:|---:|---:|
| whole engine + native | 1 | 239.200000 | 240.400002 | 270.090167 |
| whole engine + native | 2 | 210.400000 | 211.100000 | 243.029499 |
| whole engine + native | 3 | 207.700001 | 209.400000 | 244.724500 |
| whole engine + native | 4 | 209.700001 | 212.800001 | 244.521501 |
| whole engine + native | 5 | 206.299999 | 207.000000 | 243.955833 |
| cold Tone | 1 | 210.500000 | 210.599998 | 350.491832 |
| cold Tone | 2 | 234.800001 | 235.200001 | 375.283833 |
| cold Tone | 3 | 212.199999 | 212.600000 | 354.484832 |
| cold Tone | 4 | 206.100000 | 209.000000 | 345.857500 |
| cold Tone | 5 | 209.799999 | 211.200001 | 354.582833 |
| cold advanced | 1 | 251.700001 | 255.300001 | 396.746667 |
| cold advanced | 2 | 236.100000 | 239.800001 | 371.808833 |
| cold advanced | 3 | 243.900000 | 247.500000 | 383.623333 |
| cold advanced | 4 | 233.099998 | 237.199999 | 369.998832 |
| cold advanced | 5 | 258.799999 | 261.200001 | 398.539166 |

## Raw Tone Nets trials

`Boundary` is Tone Nets' first upstream source-to-master connection. The
observer must be ready before that connection; Tone Nets subsequently awaits
synth readiness, SoundFont installation, warm-up, and playback finalization.

| Trial | Observer ready | Boundary | First master PCM |
|---:|---:|---:|---:|
| 1 | 105.099998 | 665.000000 | 1223.791332 |
| 2 | 120.699999 | 653.199999 | 1243.830666 |
| 3 | 99.500000 | 654.700001 | 1195.210668 |
| 4 | 103.099998 | 651.199999 | 1215.915667 |
| 5 | 100.000000 | 654.100000 | 1206.335668 |

## Oracle controls

| Control | Keyboardia harness | Tone Nets harness |
|---|---:|---:|
| Scheduled onset | 100 ms | 100 ms |
| Audio-thread-retained onset | 100 ms | 100 ms |
| Main-thread block | 742.2 ms | 706.6 ms |
| Retained-frame error | 0 ms | 0 ms |
| Late pulsed observer silent prefix | 8,641 frames | 8,129 frames |
| Late observer onset error | 400.021 ms | 400.021 ms |
| Late observer crossed boundary before readiness | yes; rejected | yes; rejected |

The late pulsed control is deliberately important: it misses the first pulse,
then accumulates silence and reports the next pulse. A positive silent prefix
therefore cannot prove timely attachment. The application-boundary ordering is
the acceptance condition; the silent-frame count is diagnostic only.

## Reproduction

```bash
cd app
USE_MOCK_API=1 npx playwright test e2e/capture-session.spec.ts \
  --project=chromium --workers=1 --retries=0 -g "measures cold Tone"

# With the hash-matched Tone Nets production preview on port 4175:
npm run measure:tone-nets-startup -- \
  --url http://127.0.0.1:4175/ --trials 5
```

The commands regenerate the full gitignored JSON reports in
`app/test-results/audio-capture/`, including all milestones, peaks, frame
counts, environment metadata, and probe-control fields.
