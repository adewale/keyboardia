# Sample & Source Audit — 2026-06-29

> Follow-up audit after PR #47 and PR #49. Goal: identify current sample-library weaknesses and license-compatible sources for better samples.
>
> Scope: `app/public/instruments/*`, manifest metadata, existing sample validators, current playback/range tests, and targeted web/license checks.
>
> Note: the initial findings describe the baseline observed at audit time. A same-branch follow-up implementation then addressed the low-risk CC0 upgrades for `acoustic-guitar`, `alto-sax`, `finger-bass`, `french-horn`, and `slap-bass`; see “Follow-up implementation / investigation update” below. `rhodes-ep` and `clean-guitar` sample folders were intentionally left untouched.

## Executive summary

Current sample playback is much healthier than before PR #47: all 27 sampled instruments pass manifest/default-range validation, and the headless offline-render audit produced no source-created-but-silent notes. The best upgrade opportunities are now less about catastrophic silence and more about **license risk, source provenance, expressive velocity layers, and under-used source libraries**.

Highest-value work from the baseline audit:

1. **Resolve `rhodes-ep` licensing**. Current manifest points at jRhodes3d; its own license says redistributed samples are **CC BY-NC**, not CC0. That is incompatible with unrestricted app redistribution unless we get an explicit grant or replace it.
2. **Fix/expand `acoustic-guitar` from the same CC0 source**. Current manifest used only 4 notes from the Discord GM Martin HD28 set and included an unreachable `Ab5` sample outside playable range; this has now been addressed in the follow-up implementation.
3. **Add velocity/timbre layers to expressive single-layer instruments**: now addressed for `alto-sax`, `finger-bass`, `french-horn`, and `slap-bass`; `clean-guitar` was not modified by request; `string-section`/`kalimba` remain future work.
4. **Fix provenance and stale/dead source metadata**: `clean-guitar` source URL is a 404; `rhodes-ep` license wording in generated `LICENSE.md` is misleading. Both folders remain untouched pending owner decision.
5. **Harden local validators**. `validate:velocity` now fails closed without `ffmpeg`; Python validators still need dependency handling for `numpy`.

## Commands / checks run

```bash
cd app && npm run validate:manifests          # pass: 27/27
cd app && npm run validate:playable-ranges    # pass: 27/27
cd app && npm run validate:release-times      # 21 OK, 6 unknown recommendation classes
cd app && npm run analyze:velocity            # flags 5 high-priority single-layer instruments
cd app && npm run audit:range:render          # pass: offline render, no rendered-silent notes
cd app && npm run validate:velocity           # not reliable locally: ffmpeg absent => -100 dB for every file
cd app && python3 scripts/validate-audio-defects.py   # failed: missing numpy
cd app && npm run validate:acoustic-pitch             # failed: missing numpy
```

A supplemental Node decode pass using `node-web-audio-api` wrote `app/test-results/sample-audit/current-audio-metrics.json` (gitignored). It checked decoded peak, RMS, DC offset, leading silence, unreferenced MP3s, and manifest reachability.

## Current inventory snapshot

- 27 sampled instruments.
- ~16.1 MB referenced sample payload.
- 214 manifest sample entries, 129 unique pitched note slots.
- 12/27 instruments have velocity layers.
- 15/27 are single-layer.
- Hammond has loop metadata; most other sustained instruments do not.

Good current strengths:

- `piano`: 7 notes × 3 velocity layers, trimmed Iowa MIS set.
- `marimba`: 10 notes × 3 velocity layers from VCSL.
- `vibraphone`: 11 notes × 2 velocity layers from VCSL.
- `steel-drums`: 8 notes × 3 velocity layers from jSteelDrum2.
- Acoustic kit: 3–4 velocity layers from Virtuosity.
- Hammond: 13 looped notes, C2–C6 coverage.
- Offline render: no rendered-silent notes for in-range source-created samples.

## Findings

### F1 — `rhodes-ep` licensing is still the biggest blocker

Current manifest:

- Source: `jRhodes3d by J. Learman`
- URL: `https://github.com/sfzinstruments/jlearman.jRhodes3d`
- License string: `CC0 for musicians making music`

The upstream `LICENSE` says:

> `License for samples: CC BY-NC`
>
> `License for everything else: CC0`
>
> `License for musicians using this to make music: CC0`
>
> `To distribute the samples themselves, such as in an application, software instrument, or as a sample set, the jRhodes samples are licensed under CC BY-NC 4.0.`

That means browser redistribution of MP3 samples is **not** cleanly CC0. PR #47 noticed this, briefly replaced Rhodes with FreePats FM Piano 1, then reverted pending owner decision. This should be resolved before treating the sample library as license-clean.

Additional `rhodes-ep` issues:

- 4 unreferenced assets remain: `C2.mp3`, `C3.mp3`, `C4.mp3`, `C5.mp3` (~1.1 MB total).
- Velocity coverage is partial: E2/G3/F4 have pp/mf/ff; A2/D3/B3/D4/B4/E5 are single-layer.

Recommendation:

1. Ask the author for explicit redistribution/commercial app grant; or
2. Replace with a clean fallback and keep the `rhodes-ep` id for session compatibility.

Known fallback from branch history: commit `bee4809` used FreePats FM Piano 1 (DX7 E.Piano 1, CC0 1.0) as `rhodes-ep`, but the timbre is FM electric piano rather than Rhodes. Better true-Rhodes CC0 source was not found in this pass.

### F2 — `acoustic-guitar` underuses its CC0 source and has an unreachable sample

Current Keyboardia sample set:

- 4 files: E2, E3, E4, Ab5.
- Playable range: MIDI 34–70.
- `Ab5.mp3` is note 80, outside playable range, and is not selected by any in-range note.

The upstream Discord GM steel acoustic guitar SFZ explicitly says:

```text
// GM Acoustic Guitar
// 2017 Martin HD28 Vintage Series
// Author: Jeff Learman, for Kinwie's Discord SFZ GM
// License: Creative Commons CC0
```

It exposes many more notes than Keyboardia currently ships: E2, G2, Bb2, Db3, E3, G3, Bb3, Db4, E4, Ab4, B4, D5, F5, Ab5, B5.

Recommendation: low-risk, high-value same-source upgrade:

- Add intermediate notes from the same CC0 source to reduce pitch-shift distance.
- Decide whether to extend playable range upward or remove/replace unreachable Ab5.
- Add at least 2 velocity/timbre layers if available, otherwise keep single-layer but improve note density.

### F3 — Expressive single-layer instruments are now the main sonic weakness

`npm run analyze:velocity` flags high priority:

| Instrument | Current state | Why it matters | Candidate source path |
|---|---|---|---|
| `acoustic-guitar` | 4 notes, no velocity | Finger/strum/pick intensity changes attack/timbre | Same Discord GM Martin HD28 CC0 source; add notes first |
| `alto-sax` | 6 notes, no velocity | Breath pressure changes tone and noise | Karoryfer Weresax has piano/forte + dynamic/condenser maps, CC0 |
| `clean-guitar` | 4 notes, no velocity | Pick attack and pickup character matter | Replace/augment from Karoryfer Shinyguitar or Emilyguitar, CC0 |
| `finger-bass` | 6 notes, no velocity | Pluck intensity affects buzz/attack | Karoryfer Meatbass has pizz maps with velocity layers/round robins, CC0 |
| `french-horn` | 9 notes, no velocity | Embouchure/dynamic layers matter | VSCO/VCSL material is CC0; need source-folder pass for dynamics |

Medium priority:

- `slap-bass`: current Growlybass-derived set has 4 single-layer notes. Karoryfer Swagbass/Growlybass have CC0 velocity/round-robin material and noise articulations.
- `string-section`: 15 single-layer notes; likely needs loop/attack polish more than immediate replacement.
- `kalimba`: 10 single-layer notes; current tuning is good, velocity layers are nice-to-have.
- `hammond-organ`: velocity is less important, but drawbar/tonewheel variation might be better solved synthetically.

### F4 — `clean-guitar` source metadata is stale/dead

Current manifest URL:

```text
https://github.com/karoryfer/black-and-green-guitars
```

HTTP check returns 404. The samples may be valid, but the source URL in generated license docs is not verifiable as written.

Good CC0 replacement/augmentation candidates verified via GitHub license metadata/raw license:

- `https://github.com/sfzinstruments/karoryfer.shinyguitar` — CC0 1.0
- `https://github.com/sfzinstruments/karoryfer.emilyguitar` — CC0 1.0

Recommendation: update provenance if the actual source has moved; otherwise rebuild clean guitar from one of the verified CC0 Karoryfer guitar repos.

### F5 — String section still has measurable leading-silence outliers

Node decode pass found:

- `string-section/G2.mp3`: ~96.8 ms leading silence at -50 dB threshold.
- `string-section/A4.mp3`: ~29.1 ms leading silence.
- Smaller but noticeable: B5 ~22.5 ms, G5 ~20.2 ms, B2 ~18.9 ms.

PR #47 trimmed string-section silence, but at least one file still appears late enough to be audible/timing-relevant.

Recommendation: trim string-section onsets again or add manifest offset support if preservation of bow noise is intentional. If bow noise is musically useful, document threshold exceptions in the validator.

### F6 — Validators need fail-closed dependency handling

On this machine:

- `validate:velocity` reported all velocity layers correctly ordered, but every measured value was `-100.0 dB` because `ffmpeg` was unavailable.
- `validate-audio-defects.py` and `validate-acoustic-pitch.py` failed at import due missing `numpy` before they could check anything.

Recommendation:

- Make `validate-velocity-layers.ts` fail if `ffmpeg` is missing or if all measurements are sentinel values.
- Document Python validator prerequisites or provide a checked venv/requirements path.
- Consider moving key decode checks to `node-web-audio-api` so they run in the existing Node toolchain.

### F7 — Range and live-audio status are good

- Manifest validation: 27/27 pass.
- Playable-range validation: all instruments include default C4 path.
- Offline render: every source-created note produced audible output; all silent offsets were explained by `playableRange` null returns.
- PR #49’s all-instrument live browser test now covers scheduled sequencer output to track/master analysers.

## Source research and license notes

### Strong, license-clean sources to continue using

| Source | License evidence | Best use |
|---|---|---|
| VCSL — `sgossner/VCSL` | Raw `LICENSE`: CC0 1.0 Universal | mallets, kalimba, auxiliary instruments |
| VSCO 2 CE — `sgossner/VSCO-2-CE` | Raw `LICENSE`: CC0 1.0 Universal | orchestral strings/brass/percussion |
| Virtuosity Drums — `sfzinstruments/virtuosity_drums` | GitHub license: CC0 1.0 | acoustic kit and cymbals |
| sounds-tr808-fischer — `tidalcycles/sounds-tr808-fischer` | Raw `LICENSE`: CC0 1.0 Universal | 808 kit; keep current source |
| Karoryfer Weresax | GitHub/raw license: CC0 1.0 | alto sax velocity/dynamic expansion |
| Karoryfer Meatbass | GitHub/raw license: CC0 1.0 | finger bass velocity/round-robin expansion |
| Karoryfer Growlybass / Swagbass | GitHub/raw license: CC0 1.0 | slap/electric bass expansion |
| Karoryfer Shinyguitar / Emilyguitar | GitHub/raw license: CC0 1.0 | clean/electric guitar replacement/augmentation |
| jSteelDrum2 / `sfzinstruments/jlearman.SteelDrum` | GitHub license: Unlicense | steel drums; current source is good |

### Conditional sources

| Source | License / caveat | Recommendation |
|---|---|---|
| University of Iowa MIS | Current piano page reachable; manifest says “Free for any projects, without restrictions” | Keep but archive exact license text/screenshot in repo if possible |
| FreePats | Per-instrument licensing; Hammond page reachable | OK only per instrument after exact license capture |
| Salamander Grand Piano v3 | CC-BY 3.0, large | Consider only if attribution and payload increase are acceptable |
| SM Drums / Scott McLean | commonly CC-BY 3.0 | Consider only if attribution accepted and we want a richer acoustic kit |
| Freesound | per-file mixed licenses | Use only individual CC0 files with source URL/license captured |

### Sources to avoid for bundled samples

| Source | Reason |
|---|---|
| jRhodes3d as currently licensed | Samples are CC BY-NC for redistribution |
| Virtual Playing Orchestra as a direct bundle source | mixed Sampling+/BY-SA/CC0 licensing; not clean for unrestricted redistribution |
| Philharmonia / Pianobook / commercial “free” packs | usually allow music production but not raw sample redistribution, or require account-specific terms |
| DrumGizmo / AVL / Salamander Drumkit style kits | GPL/ShareAlike-style complications for bundled samples |

## Ranked next actions

### P0 — Legal/provenance cleanup

1. Resolve `rhodes-ep`: author grant or replace.
2. Fix `clean-guitar` source URL/provenance.
3. Add a license-evidence snapshot file or notes for non-GitHub/non-standard sources: Iowa MIS, FreePats Hammond, vinyl generator provenance.

### P1 — Low-risk sonic upgrades from already-cleared sources

1. Rebuild `acoustic-guitar` from the full Discord GM CC0 Martin HD28 map.
2. Expand `finger-bass` from Meatbass pizz velocity maps.
3. Expand `slap-bass` from Swagbass/Growlybass velocity/RR material.
4. Add Weresax dynamic layers to `alto-sax`.
5. Replace or expand `clean-guitar` from Shinyguitar/Emilyguitar.

### P2 — Sustained-instrument polish

1. Trim string-section leading-silence outliers.
2. Investigate loop points for `string-section`, `french-horn`, and `alto-sax` if held notes still die unnaturally.
3. Add release/noise layers only if they do not bloat payload excessively.

### P3 — Validator/tooling hardening

1. Fail closed when `ffmpeg`/`numpy` are missing.
2. Add a Node-based decode metrics script/test for peak, DC, leading silence, unused files, and manifest reachability.
3. Add checks for unreferenced MP3s and sample notes outside playable range unless explicitly documented.

## Follow-up implementation / investigation update

A first safe implementation pass was done under these constraints: **do not modify `rhodes-ep` or `clean-guitar` sample folders**; treat subjective timbre swaps as review-needed.

Selected for the update after A/B review:

- `acoustic-guitar`: rebuilt from the full Discord GM Martin HD28 steel-string map: E2, G2, Bb2, Db3, E3, G3, Bb3, Db4, E4, Ab4, B4, D5, F5, Ab5, B5. This removes the old unreachable-Ab5 problem by extending the playable max to B5 while preserving the old low range for session compatibility.
- `alto-sax`: added two Weresax dynamic layers (`*_p_rr1_cnd`, `*_f_rr1_cnd`) at the existing six anchor notes.
- `french-horn`: added VSCO F Horn sustain dynamic layers (`v1`, `v3`) through the low/mid range. The high D5/F5 source notes only had `v1`, so those remain single-layer rather than using duplicated fake dynamics.
- Validators: `validate:velocity` now decodes audio through `node-web-audio-api` and fails closed instead of silently returning `-100 dB` when `ffmpeg` is absent. `validate:manifests` now warns for unreferenced audio files and sample notes that no playable note can select.

Investigated but not selected for this update:

- `finger-bass`: Meatbass `vl2`/`vl4` layers are a viable future path, but the replacement was reverted pending a separate bass-focused A/B decision.
- `slap-bass`: Growlybass sustain dynamics changed the character substantially versus the old short slap transients, so the replacement was reverted pending a separate subjective review.

Follow-up validation run:

```bash
cd app && npm run validate:all
cd app && npm run test:unit
cd app && npm run build
cd app && USE_MOCK_API=1 npx playwright test e2e/instrument-range-session.spec.ts --project=chromium
```

`npm run lint` also completed with the repo's existing warnings in `CursorOverlay.tsx` and `PortraitGrid.tsx`, and no lint errors.

Explicitly not modified:

- `rhodes-ep`: still needs a license decision; current files and manifest were left untouched.
- `clean-guitar`: current source URL remains stale/404, but the folder was left untouched per request.

Additional improvement investigation:

| Instrument | Best next source/action | Risk / review note |
|---|---|---|
| `clean-guitar` | Prefer `sfzinstruments/karoryfer.shinyguitar` (`Samples/electric/*_vl1..vl4_rr*`) or `sfzinstruments/karoryfer.emilyguitar` (`notes/*_{p,mp,mf,f}_rr*`), both CC0. | Timbre will change materially; do A/B before replacing. Also first try to find the moved Black-and-Green URL if preserving current tone matters. |
| `string-section` | Stay with VSCO 2 CE; next pass should trim/offset known late starts (`G2`, `A4`) and then evaluate `Strings/{Cello,Viola,Violin} Section/susvib` loop points. | Bow attack is subjective: avoid hard trimming without listening; loop metadata needs held-note QA. |
| `kalimba` | Current VCSL Kenya map is reasonably good. VCSL has Kenya files (`Mbira6_Normal_MainSpirit_*_vl3_rr2`) and a broader Tanzania set (`MBira3_pluck_Main_*_50_100_rr2`) but not obvious true velocity layers. | Replacement changes the instrument identity/tuning. Prefer adding a few missing keys or round-robin-style alternates only after pitch verification. |
| `acoustic-guitar` | Future: A/B whether adding velocity layers from a different guitar source is worth the timbre change; current same-source density upgrade is the low-risk win. | Discord GM Martin set appears single-dynamic; cross-source velocity layers may sound inconsistent. |
| `alto-sax` | Future: consider Weresax round-robins or dynamic mic variants if repetition is obvious. | Payload grows quickly; current p/f layer pass is the main improvement. |
| `finger-bass` | Future: add round-robin selection support before bundling more Meatbass RR files. | App currently picks one file per velocity layer, so extra RR files would not be used without engine work. |
| `french-horn` | Future: add loop metadata/held-note QA; high notes need an alternate source if true dynamics are required. | Do not fake unavailable high-note dynamics with duplicates. |
| `slap-bass` | Future: decide whether the instrument should be short staccato slap or sustained Growlybass; Swagbass has richer CC0 velocity layers but is a different bass/tone. | Current pass improves dynamics but should get human A/B review because the old tiny staccato samples had a different transient character. |

## Proposed implementation sequence

1. **PR A: audit-tool hardening + metadata fixes**
   - fix `validate:velocity` dependency handling
   - add unreferenced-file and outside-range checks
   - fix clean-guitar source URL or mark unknown
   - remove unreferenced Rhodes files only after license decision

2. **PR B: Rhodes decision**
   - either explicit grant committed into docs, or replacement sample set
   - regenerate license docs and visual/audio checks

3. **PR C: acoustic-guitar expansion**
   - use same Discord GM CC0 source
   - fix unreachable Ab5/range
   - add before/after metrics and listening demo

4. **PR D: expressive single-layer batch**
   - finger bass, slap bass, alto sax, clean guitar
   - keep payload budget explicit (<2 MB target unless approved)

5. **PR E: sustained polish**
   - string trim / loops / horn/sax/string sustain QA

## Bottom line

PR #47 already solved the worst playback and sample-quality defects. The next “better samples” pass should be **targeted**, not a broad replacement spree: resolve Rhodes licensing, harvest more depth from already-cleared CC0 source repos, and harden validators so the audit remains trustworthy on developer machines and CI.
