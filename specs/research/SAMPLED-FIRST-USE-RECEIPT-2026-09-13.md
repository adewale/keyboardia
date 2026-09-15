# Sampled first-use scheduling receipt — 2026-09-13

## Claim and scope

This receipt tests one narrow claim: a real-time first note from the
priority-loaded `sampled:slap-bass` fixture reaches the sampled source path with
the same 3 ms de-click envelope as its four subsequent hits. It does not test
sample loading, other instrument engines, other sampled libraries, listener
preference, or physical devices.

The production correction is:

```text
real-time sampled-note lead = max(3 ms, 513 / sampleRate seconds)
```

`513` is four 128-frame Web Audio render quanta plus one frame. At 48 kHz the
floor is 10.6875 ms; at 44.1 kHz it is 11.6327 ms. The floor applies only when
a real-time sampled note is requested with less lead than that. A sufficiently
future-scheduled sampled event keeps its requested time, offline sampled renders
pass a zero floor, and the native, Tone, and advanced engines are unchanged.

This is therefore a deliberate latency-for-envelope-integrity tradeoff on the
late/near-deadline real-time sampled path, not a general startup optimization.

## Counterexample

The negative control temporarily changed `realtimeNoteLeadTime()` from the
formula above to zero, then ran the same browser fixture in 12 fresh Chromium
contexts using the normal two-worker configuration. The production source-tap
gate was expected to fail in at least one context.

- Result: **2 of 12 failed as expected**.
- Selected failure: pre-compressor RMS spread **0.268313 dB** against the
  **0.01 dB** gate; heard-output RMS spread **0.350137 dB**.
- The five onset offsets relative to the first hit were
  `0, -256, -256, -257, -256` frames.
- In the retained first-256-frame source window, frames 0–142 differed and
  frames 143–255 were exactly equal. The failed first attack fits an effective
  16-frame ramp instead of the expected 144-frame ramp—one 128-frame render
  quantum lost—with maximum model residual `1.32e-7`.

This counterexample distinguishes the defect from sample loading and master-bus
dynamics: it is already present at the pre-compressor sampled-source tap, it is
confined to the attack in the retained window, and the peak over the full
analysis window is unchanged.

## Guarded control

After restoring the 513-frame floor, the same fixture ran in 13 fresh Chromium
contexts:

| Metric | Observed range | Gate |
|---|---:|---:|
| DOM click to first audible sample | 38.708–54.708 ms | ≤500 ms |
| maximum absolute later-hit offset from first-hit grid | 513–769 frames | ≤960 frames (20 ms) |
| pre-compressor peak spread | 0 dB | ≤0.01 dB |
| pre-compressor RMS spread | 0.0000000009–0.000001144 dB | ≤0.01 dB |
| heard-output peak spread, diagnostic | 0.003110–0.009021 dB | not gated |
| heard-output RMS spread, diagnostic | 0.002890–0.004705 dB | not gated |

All 13 passed. In the selected guarded trial, the first and steady first-256
source frames were byte-identical. Later hits can appear 513–769 frames earlier
than the first hit's derived half-second grid because the already-late first
event receives the floor while later events that arrive with enough scheduler
lookahead keep their intended time. The test reports and bounds this cost; it
does not mislabel it as jitter or hide it inside the level assertion.

## Retained raw data

[`SAMPLED-FIRST-USE-COUNTEREXAMPLE-2026-09-13.json`](./SAMPLED-FIRST-USE-COUNTEREXAMPLE-2026-09-13.json)
contains:

- exact little-endian Float32 source frames for the failed first and steady
  attacks, base64-encoded with SHA-256 hashes;
- the 12-context negative-control result and mutation;
- all seven reported metrics for each of the 13 guarded trials; and
- hashes proving equality of the selected guarded first/steady prefix.

The E2E writes its schema-v3 report before asserting, so future CI failures
retain the same causal source prefix as well as the final-output diagnostic.
