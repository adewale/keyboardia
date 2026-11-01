# Keyboardia redistributable sample-source search — 2026-07-10

## Bottom line

This search found a large **license-eligible candidate pool**, but not every permissively labelled repository—or every audio file inside one—is safe to bundle. Repository eligibility is not final file-level clearance. The strongest new results are:

1. **TinySOL 6.0 (CC BY 4.0)** for alto sax, French horn, bowed strings, flute, oboe, clarinet, bassoon, brass, and accordion. It is the cleanest orchestral intake source found: 2,913 isolated 16-bit/44.1 kHz mono WAV notes, explicit dataset-wide audio licensing, MIDI/pitch/dynamic metadata, and generally three dynamics per chromatic pitch.
2. **FreePats MuldjordKit (CC BY 4.0)** for a compact but deep acoustic kit: 19 mapped roots, up to 14 velocity layers and five round robins in a 161 MiB repository/release class.
3. **Karoryfer Meatbass pizzicato (CC0)** for upright bass, plus a compact **Discord GM Killer Bass subset** that has a pinned CC0 instrument declaration but only medium-confidence underlying-rights evidence. Meatbass has native four-layer/four-RR pizzicato. Killer Bass is 22.5 MB of WAV data with nine roots × five velocity layers, but its creator/source chain must remain attached to intake evidence.
4. **Headroom Piano (CC BY 4.0)** for a practical piano rebuild: Yamaha C3, 300 samples, five velocity layers, two microphone positions, 156 MB FLAC according to its primary README.
5. **FreePats World Percussion, Glasses, Timpani, Tubular Bells, and Hang (CC0)** for small, deep additions. World Percussion alone maps 24 roots, up to two layers and 16 RRs in about 6.8 MiB.
6. **jLearman Steel Drum (Unlicense)** for a direct improvement path: 24 roots, up to five layers and 18 RRs versus Keyboardia’s current eight roots/three layers.
7. **PublicSamples Modular Hits and Synth Hits (public-domain dedication)** plus **Supercontinent (CC0)** for textures/effects and synth one-shots.

A critical negative result is equally important: **no conventional real choir library cleared both the license/provenance gate and the quality/depth gate**. FreePats has a usable synthetic choir pad; 272 Merry Orks is a niche female death-metal vocal set. The seemingly excellent Hadzi-Fia vocal repository is held because its 517 checked-in samples are identified with a library now sold commercially despite the tutorial repository’s CC0 file.

“Eligible” below means the retrieved source-level evidence appears to permit raw redistribution under the requested policy. Every promoted subset still needs file-level provenance, license-scope, and authority verification. It does **not** mean the timbre has passed blind review. No subjective quality score was manufactured.

## Search scope and evidence

The search was performed from scratch against primary repositories, primary project pages, and archival metadata. Repository SPDX labels were used only for discovery; actual license files, README scope, source provenance, mappings, and payloads were inspected.

Measured coverage:

- **282** deduplicated GitHub repositories from broad CC0/CC-BY/Unlicense and instrument-specific queries.
- **76** repositories enumerated in the official `sfzinstruments` organization.
- **50** metadata-eligible `sfzinstruments` repositories cloned sparsely and checked at exact commits; all had root license evidence. Two were non-audio repositories and one vocal source was held for a provenance conflict. The remaining 26 organization repositories were also classified: 2 eligible after reading actual CC BY 3.0 evidence, 1 split-license-only, 1 held, and 22 rejected (including CC-BY-SA). A root license is catalog evidence, not automatic proof that a contributor controlled every imported recording.
- **44** FreePats GitHub repositories enumerated; **40** CC0/CC-BY instrument repositories cloned and inspected at exact commits. The other four were classified: documentation, two tool repositories, and the GPL-2.0 Colombo Drumkit (rejected for copyleft sample content).
- **37** FreePats primary website pages scraped into **54** instrument records: 50 CC0, one CC BY 4.0, two CC BY 3.0, and one unlicensed aggregate GM set rejected.
- **3,173 SFZ files** parsed for roots, sample references, velocity layers, round robins, includes, and inheritance. Macro/include-heavy instruments are also described from their primary README because parser maxima can undercount those designs.
- Full Git trees measured for VCSL and VSCO 2 CE.
- Zenodo records inspected for license scope, descriptions, file checksums, and payloads.
- Six selected FreePats archives downloaded, extracted, and SHA-256 hashed.

Machine-readable full registry: [`sample-source-registry-2026-07-10.json`](./sample-source-registry-2026-07-10.json). The larger retrieved/raw evidence corpus remains local at `/tmp/keyboardia-exhaustive-sample-search-2026-07-10/{raw,evidence}` and is intentionally not committed.

## Intake policy applied

Accepted:

- CC0 1.0, CC BY 3.0/4.0, Unlicense/public-domain dedication.
- An explicit public-domain-equivalent grant when the primary page clearly permits unrestricted project use, with a preserved evidence snapshot.
- A split-license collection only for the exact instrument whose audio scope is evidenced.

Rejected or held:

- NC, ND, SA, GPL/copyleft applied to sample content, proprietary terms, or a ban on raw/sampler redistribution.
- A license covering code, presets, mappings, metadata, or examples but not the underlying audio.
- Aggregates with mixed or missing per-file provenance.
- Contradictory terms, even when GitHub reports a permissive SPDX identifier.
- Third-party audio where the repository licensor’s authority is not evidenced.

Fixable audio caveats—trim, onset, DC, headroom, encoding, loop work, or a curated subset—did not cause legal rejection. Wrong target identity or incompatible/ambiguous rights did.

## Current Keyboardia gaps the search can address

| Target | Current mapped depth | Best eligible intake evidence | Why it is material |
|---|---:|---|---|
| Alto sax | 6 roots × 2 layers | TinySOL: 33 chromatic pitches × pp/mf/ff; MTG: soprano/alto/tenor/baritone, 2–3 layers and three neighboring-note RRs | Much denser pitch/dynamic evidence; MTG adds alternate instances |
| French horn | 9 roots × 2 layers | TinySOL: 47 chromatic pitches, 134 files, mostly pp/mf/ff | Direct target match and full range |
| String section | 15 roots × 1 layer | VSCO 2 CE section recordings; TinySOL violin/viola/cello/contrabass with three dynamics | Adds dynamics; VSCO is the better section identity, TinySOL the cleaner solo mapping source |
| Grand piano | 7 roots × 3 layers | Headroom: 300 files, 5 layers, 2 mics; Salamander: 16 layers; Upright KW: 38 roots × 2 layers | Headroom is the best depth/size balance; Salamander is deepest but large |
| Finger bass | 6 roots × 1 layer | Meatbass pizz 4 layers × 4 RRs across 21 measured roots; Killer Bass 9 roots × 5 layers | Restores velocity identity and repeat variation |
| Clean guitar | 4 roots × 1 layer | FSBS 19 roots × 2 layers × up to 4 RRs; Black/Green 46 roots × 4 layers × 4 RRs | Major pitch and repetition improvement |
| Acoustic guitar | 15 roots × 1 layer | FreePats Spanish guitar 48 chromatic roots, ~6 MiB; Discord Martin HD28 instrument subset | Spanish source is compact but nylon, so it is not a blind steel-string replacement |
| Steel drums | 8 roots × 3 layers | jSteelDrum 24 roots × up to 5 layers × 18 RRs | Same target with much deeper native mapping |
| Acoustic drums | one root per piece, 3–4 variants/layers | Muldjord 19 roots, up to 14 layers and 5 RRs; World Percussion 24 roots/up to 16 RRs | True dynamic/repetition depth and broader kit identity |
| Choir | none | FreePats synthetic choir pad only; no cleared conventional real choir | Remains a documented acquisition gap |
| Textures/effects | vinyl crackle only | Supercontinent; PublicSamples Modular/Synth Hits; FreePats Goblins/Sci-Fi/Soundtrack | Broadens non-pitched and atmospheric palette under clear terms |
| Rhodes EP licensing | current manifest points to jRhodes3d | No raw-bundle-safe jRhodes source; Greg Sullivan CP80/Wurlitzer/Pianet and FreePats FM piano are different eligible identities | **Current `rhodes-ep` raw assets must be quarantined/replaced**; “CC0 for musicians making music” does not permit raw redistribution |

The current `clean-guitar` inventory also points to an old unpinned `github.com/karoryfer/black-and-green-guitars` URL. Any future intake record must use the maintained `sfzinstruments/karoryfer.black-and-green-guitars` repository and an exact commit. This report does not modify that instrument folder.

## Category findings

### 1. Drums and percussion

| Source | License and exact revision | Formats / payload | Measured or documented depth | Recommendation |
|---|---|---|---|---|
| [FreePats MuldjordKit](https://github.com/freepats/muldjordkit) | CC BY 4.0, `719fe72bc6693b94f1229674e202881145ab44ed` | SFZ + FLAC/WAV/SF2; ~161 MiB repository class | 240 references, 19 roots, up to 14 layers, 5 RRs | **First acoustic-kit import**; preserve attribution and native layer relationships |
| [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) | CC0, `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc` | SFZ + WAV/FLAC; ~1.14 GiB | Six mic positions; detailed kick/snare/tom/cymbal/aux articulations; parser sees up to 11 RRs in modules | Excellent but costly; curate one dry/close mix and selected articulations |
| [Naked Drums](https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums) | CC BY 4.0, `407732a548606ac715ad8f3fbac63d9f4df77c0d` | SFZ + FLAC; ~1.19 GiB | README: 10 RRs, up to 5 layers, 16 mic channels | Hold behind Muldjord due payload and mixing complexity |
| [DRSKit SFZ](https://github.com/sfzinstruments/DrumGizmo.DRSKit) | CC BY 4.0, `b01448990a31f722542f1812e56159a97a6a2a82` | SFZ + FLAC; ~719 MiB | 13 microphone channels with bleed; jazz-to-rock kit | Good specialist source, not first web bundle |
| [World Percussion](https://github.com/freepats/world-percussion) | CC0, `e54eb2912a0d6d4444ab205d52f778e27da0fc96` | SFZ + FLAC; 6.8 MiB archive | 231 references, 24 roots, up to 2 layers, 16 RRs | **Very high value per byte**; import cajón, bongos, shaker, tambourine, claves, conga, etc. |
| [Body Percussion](https://github.com/sfzinstruments/body_percussion) | CC0, `4ac9d8966679c648b62fa10a188179e186b97f24` | 24-bit/44.1 kHz stereo WAV + SFZ; ~37 MiB | README: 4–6 RRs, sometimes 2 layers; parser sees 12-step synchronized sequences | Strong clap/stomp/body kit source |
| [BillieDrum](https://github.com/EwonRael/BillieDrum) | CC0, `48fadc01204d09039cccf83388ef4b0e68f2ec08` | 44.1 kHz samples + SFZ; ~5.6 MiB | 49 files, 25 roots, up to 6 RRs | Compact 1980s/acoustic-digital flavor; audition source provenance/timbre |
| [BushDrum](https://github.com/EwonRael/BushDrum) | CC0, `7667887b63465208b80dc7ea208cdc40f8c361cf` | 44.1 kHz samples + SFZ; ~3.7 MiB | 24 roots, one sample each | Compact LinnDrum-style option; shallow but useful |
| [PublicSamples Synth Hits](https://github.com/publicsamples/Synth-Hits) | public-domain content dedication, `373f3dc4e7a8c0199cd9d5e77b20fc48de824efe` | 1,659 checked-in WAV/AIF; 321.8 MB tree bytes | Unmapped one-shots from named drum/synth hardware | Curate only after objective and blind listening review |

### 2. Bass

| Source | License and revision | Depth | Suitability |
|---|---|---:|---|
| [Karoryfer Meatbass](https://github.com/sfzinstruments/karoryfer.meatbass) | CC0, `ac9e859564bda286ab5ec672d00ff1aa2fef2895` | Pizzicato: 4 native velocity layers × 4 RRs; 21 measured roots; arco variants also present | **Best complete pizzicato evaluation**; upright rather than electric finger-bass identity |
| [Discord Killer Bass subset](https://github.com/sfzinstruments/Discord-SFZ-GM-Bank/blob/7a9c478fe331f94f246d33332f0adedb25bbbe27/Discord%20GM/Melodic/034-Electric%20Bass%20%28finger%29.sfz) | CC0 declaration in pinned instrument SFZ, bank commit `7a9c478…`; medium confidence | 45 WAVs: 9 roots from MIDI 24–69 × 5 layers; 22,493,274 bytes | Best compact electric-bass **evaluation candidate**, but preserve the exact 45-file list, “Killer Bass by Karoryfer” creator statement, and evidence that the declarant had authority before promotion |
| [Black and Blue Basses](https://github.com/sfzinstruments/karoryfer.black-and-blue-basses) | CC0, `6e7d674cdb41be7a54dbccb15472401ad01099b9` | Up to 47 roots, 7 layers, 8 RRs, many articulations; ~962 MiB repo class | Deepest electric-bass source; too large without an articulation/root subset |
| [D. Smolken Double Bass](https://github.com/sfzinstruments/dsmolken.double-bass) | CC0, `c2985eb647109d2a8f30a70071e3e163339d7396` | 41 roots, up to 9 layers and 5 RRs across arco/pizz maps | Excellent orchestral/upright expansion |
| [PBF](https://github.com/chickenpickin/PBF) | CC0, `b81da85db41c3b027af64bc105387a7a1f777d4b` | 37 chromatic roots, one layer; ~94 MiB | Great pitch coverage, weak dynamics/repetition |
| [FreePats Bass YR](https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html#BassYR) | CC0, release 2019-09-30 | Pick and finger variants; finger has 12 roots/one layer; 3.1 MiB FLAC archive | Tiny fallback; not a depth upgrade except pitch coverage |

### 3. Guitars and plucked strings

| Source | License and revision | Depth | Suitability |
|---|---|---:|---|
| [Black and Green Guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars) | CC0, `b3b3249d37dc977a1a297bd2dc053e6d9b6b805c` | 46 roots, up to 4 layers and 4 RRs; multiple Gretsch/Hofner articulations | Deepest clean-electric option; curate aggressively from ~444 MiB |
| [FreePats FSBS clean/direct/jazz](https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html#FSBS_Clean) | CC0, clean repo `afdffc528fb22f225b7ce37cf0ccfb6b401710db` | Each variant: 120 references, 19 roots, 2 layers, up to 4 RRs | **Best balance for a clean-guitar rebuild**; direct version allows Keyboardia-side amp processing |
| [Emilyguitar](https://github.com/sfzinstruments/karoryfer.emilyguitar) | CC0, `b4920dc662fd9cad6dcaccdeecffdd91c8725d8c` | README: 4 layers × 3 RRs plus release/noise samples; 24 roots in parser | Strong but distinct flatwound electric identity |
| [Shinyguitar](https://github.com/sfzinstruments/karoryfer.shinyguitar) | CC0, `57243cca85277dbcc120ce17c6178032f93c80f3` | Up to 30 roots, 5 layers, 5 RRs; mic/pickup blends | Strong archtop option |
| [FreePats Spanish Classical Guitar](https://freepats.zenvoid.org/Guitar/acoustic-guitar.html#SpanishClassicalGuitar) | CC0, release 2019-06-18 | 48 chromatic roots, one layer; ~6 MiB | Extremely compact nylon guitar; **do not treat as a steel-string replacement** |
| [Discord Martin HD28 subset](https://github.com/sfzinstruments/Discord-SFZ-GM-Bank/blob/7a9c478fe331f94f246d33332f0adedb25bbbe27/Discord%20GM/Melodic/026-Acoustic%20Guitar%20%28steel%29.sfz) | CC0 in pinned instrument SFZ | Steel-string mappings and loops | Relevant to current acoustic-guitar work; instrument-specific evidence only |
| [Cithara Barbarica](https://github.com/sfzinstruments/cithara-barbarica) / [Hungarian Zither](https://github.com/sfzinstruments/hungarian_zither) / [Ganjo](https://github.com/sfzinstruments/ganjo) | CC0 at pinned repository commits | Respectively up to 28 roots/2 layers/4 RRs; 30 roots/4 RRs; 26 roots/11 RRs | Good net-new plucked instruments, not substitutes for existing guitar IDs |

### 4. Keys and electric pianos

| Source | License and revision | Formats / size | Depth and decision |
|---|---|---|---|
| [Headroom Piano](https://github.com/sfzinstruments/BengtNilsson.HeadroomPiano) | CC BY 4.0, `2a7df3f7252227a3484202c1d61bc1bfe352a971` | SFZ/FLAC; README says 156 MB FLAC | Yamaha C3, 300 samples, 5 layers, 2 mics. **Best piano depth/size compromise.** |
| [Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3) | CC BY 3.0 on original Archive.org item | 488,713,261-byte 16/44.1 archive or 1,448,107,335-byte 24/48 archive | 16 layers in minor thirds, 88-key map plus releases/resonance. Best depth, largest intake. |
| [Osiris Piano](https://github.com/sfzinstruments/Osiris_Piano) | CC0, `18c6afccb60cff458edbf7c394571783e074e1e9` | SFZ/FLAC; 483,175,513 audio-tree bytes | 1,242 files, 51 mapped roots, two primary velocity layers, three mics, sustain/soft/noise/transposed variants. Rich but complex. |
| [FreePats Upright KW](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW) | CC0, `570f6c60ed2eff67accad3b85d5b452e57a3ad28` | SFZ/FLAC; ~35 MiB | 38 roots × 2 layers. **Best small acoustic-piano intake.** |
| [FreePats Old Piano FB](https://github.com/freepats/old-piano-FB) | CC0, `9707673c65d8a52d7b374af807384005564a89f2` | SFZ/FLAC; ~39 MiB | 78 chromatic roots, one layer; excellent honky-tonk identity rather than general grand |
| [Greg Sullivan E-Pianos](https://github.com/sfzinstruments/GregSullivan.E-Pianos) | CC BY 3.0, `8c3e581acda3594b553948ff0222d4f84a698376` | SFZ/FLAC; ~18 MiB | CP80 23 roots/up to 4 layers; Wurlitzer 20 roots/up to 4; Pianet 18 roots/up to 2. Strong legal replacement direction for Rhodes-like keys, but not a Rhodes. |
| [FreePats FM Piano 1](https://freepats.zenvoid.org/ElectricPiano/synthesized-piano.html#FM_Piano1) | CC0, release 2019-09-16 | SFZ/FLAC, ~24 MiB | 12 roots × 3 layers; DX7-style identity |
| [Euterpea Harmonium](https://github.com/evanyerburgh/euterpea-harmonium) | underlying Freesound recording and repo are CC0; `b1c07dc79d7116e3a752444af13e5341bea92b19` | 42 WAV roots + DecentSampler; ~106 MB tree | Chromatic C1–F4, neighboring-note variation and drones; strong net-new instrument |

**Rhodes warning:** `jRhodes3c` and `jRhodes3d` explicitly license raw sample redistribution as CC BY-NC (3c also describes SA). Their CC0 language applies only to control files, examples, and music made with the instrument. They are not bundle-safe and should not be used to justify the current `rhodes-ep` assets.

**Current piano evidence caveat:** the University of Iowa primary page says its recordings may be “downloaded and used for any projects, without restrictions” and explicitly names application developers, but it does not use an SPDX license or say “raw sampler redistribution.” Preserve the retrieved page snapshot and obtain explicit confirmation or legal review before treating Iowa-derived raw assets as fully cleared. This is medium-confidence public-domain-equivalent evidence, not the same confidence as CC0.

### 5. Mallets and chromatic percussion

| Source | License / revision | Depth | Recommendation |
|---|---|---:|---|
| [jSteelDrum](https://github.com/sfzinstruments/jlearman.SteelDrum) | Unlicense, `e429428dd65dc645e4c9b1f134da4d2e40c400c6` | 24 roots, up to 5 layers, 18 RRs; ~38 MiB | **Direct steel-drums upgrade source** |
| [FreePats Glasses](https://freepats.zenvoid.org/ChromaticPercussion/glass.html#Glass1) | CC0, 2019-12-27 | 20 roots, up to 9 RRs; 11 MiB FLAC | Excellent distinctive mallet-like addition |
| [FreePats Hang D minor](https://freepats.zenvoid.org/ChromaticPercussion/hang.html#HangDminor) | CC0, 2022-03-30 | 9 native roots, up to 7 RRs; 13 MiB FLAC | Preserve native scale; do not force chromatic pitch shifting |
| [FreePats Tubular Bells](https://freepats.zenvoid.org/ChromaticPercussion/tubular-bells.html#TB1) | CC0, 2024-11-30 | 10 roots, 2 RRs; 2.1 MiB small FLAC or 13 MiB full | Very low-cost addition |
| [FreePats Timpani](https://freepats.zenvoid.org/Percussion/orchestral-percussion.html#Timpani) | CC0, 2024-08-10 | 11 root zones, 2 RRs, one source dynamic | Useful, but not a multi-dynamic timpani replacement |
| [FreePats Xylophone](https://freepats.zenvoid.org/ChromaticPercussion/xylophone.html#Xylophone1) | CC0, 2020-07-06 | SFZ/FLAC; 2.3 MiB | Compact VCSL-derived candidate |
| [VCSL](https://github.com/sgossner/VCSL) | CC0, `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e` | 803 idiophone files among 4,231 total | Broad source for marimba, metals, bells, and unusual percussion; curate per instrument |

### 6. Orchestral strings, brass, woodwinds, and saxophones

#### TinySOL is the primary recommendation

[TinySOL 6.0](https://zenodo.org/records/3685367) has the strongest license-to-mapping signal. Zenodo record `3685367`, DOI `10.5281/zenodo.3685367`, explicitly applies CC BY 4.0 to the audio. The archive is 1,026,917,185 bytes with Zenodo MD5 `36030a7fe389da86c3419e5ee48e3b7f`.

| Instrument | Files | Unique pitches / MIDI range | Dynamics |
|---|---:|---:|---|
| Alto saxophone | 99 | 33 / 49–81 | 33 each pp, mf, ff |
| French horn | 134 | 47 / 31–77 | mostly pp, mf, ff |
| Bass tuba | 108 | 36 / 30–65 | 36 each pp, mf, ff |
| Trombone | 117 | 39 / 34–72 | 39 each pp, mf, ff |
| Trumpet in C | 96 | 33 / 54–86 | pp/mf/ff |
| Bassoon | 126 | 42 / 34–75 | 42 each pp, mf, ff |
| Clarinet in Bb | 126 | 42 / 50–91 | 42 each pp, mf, ff |
| Flute | 118 | 40 / 59–98 | pp/mf/ff with two `p` labels |
| Oboe | 107 | 36 / 58–93 | pp/mf/ff |
| Violin | 284 | 46 / 55–100 | pp/mf/ff, up to four string instances |
| Viola | 309 | 49 / 48–96 | pp/mf/ff, up to four string instances |
| Cello | 291 | 49 / 36–84 | pp/mf/ff, up to four string instances |
| Contrabass | 309 | 45 / 28–72 | pp/mf/ff, up to four string instances |
| Accordion | 689 | 82 / 28–109 | mostly pp/mf/ff with multiple instances |

Caveat: TinySOL metadata flags roughly 1% resampled missing pitches and 640/2,913 retuned files (~22%). Retuning is instrument-dependent: Bass Tuba 55/108 (~51%), Trumpet 43/96 (~45%), Flute 45/118 (~38%), Clarinet 40/126 (~32%), and Contrabass 95/309 (~31%). Prefer files marked neither resampled nor retuned for initial anchors, then admit corrected files only after blind review.

Other strong sources:

| Source | License / revision | Depth / identity | Use |
|---|---|---|---|
| [VSCO 2 CE](https://github.com/sgossner/VSCO-2-CE) | CC0, `440300901dfe9275fd84e0b7763af1f8443ae62e` | 3,168 WAV files / 3.178 GB tree bytes: 767 strings, 814 brass, 380 woodwinds, 836 percussion, 213 keys | Best section and articulation pool; curate from primary raw paths |
| [Karoryfer x Bigcat Cello](https://github.com/sfzinstruments/karoryfer-bigcat.cello) | CC0, `6fd75fbfc1dbb3109bf26220ba1adea46188a18b` | 24 roots, up to 7 layers/4 RRs; sustain, staccato, marcato, pizzicato | Deep solo cello |
| [War Tuba](https://github.com/sfzinstruments/karoryfer.war-tuba) | CC0, `5b62dd6ef6b00281bb734769e44a63f5e013018a` | 31 roots, up to 8 layers/10 RRs across articulations | Deep specialist brass source |
| [MTG Solo Sax](https://github.com/sfzinstruments/MTG.SoloSax) | CC BY 4.0, `b494d256549b3d088fdec176ce82867f8a1f58b2` | Soprano/alto/tenor mostly 2 layers, baritone 3; three neighboring-note RRs; 24/48 mono | Strong complete sax family; license covers the transformed pack |
| [Weresax](https://github.com/sfzinstruments/karoryfer.weresax) | CC0, `a4d756b21d2a573aca0d840cce7e71ba5effd4c6` | 31 roots, two mics/layers, two RRs; alto sax | Expressive alternative with complex vibrato controls |
| [Bear Sax](https://github.com/sfzinstruments/karoryfer.bear-sax) | CC0, `7abb3c652525a15dfac80e1b5dfbba9964ee568f` | 1926 Conn baritone; 38 roots, up to 5 layers/4 RRs, five articulations | Baritone sax, not an alto replacement |
| [Ixox Flute](https://github.com/sfzinstruments/Ixox.Flute) | CC BY 4.0, `0cc54468bb0d2d9b32921958585caad65ba8df21` | 69 references, 12 roots; normal/staccato/percussive and second-flute controls | Useful but less pitch-dense than TinySOL |
| [AliExpress Erhu](https://github.com/sfzinstruments/aliexpress-erhu) | CC0, `6615047b2fd06126877483e97b8bb4af9d00b080` | 19 roots, up to 4 RRs; long, short, sul tasto, marcato | Good net-new bowed ethnic string |

### 7. Choir and voice

| Source | License / status | Depth | Decision |
|---|---|---:|---|
| [FreePats Synth Pad Choir](https://freepats.zenvoid.org/Synthesizer/synth-pad.html#Choir) | CC0, release 2020-05-16 | 12 looped roots from MIDI 36–102; one layer; 6.7 MiB | Safe synthetic choir pad; not a real choir |
| [272 Merry Orks](https://github.com/sfzinstruments/karoryfer.272-merry-orks) | CC0, `a437e2c02014e02710a104a6692193eab8672d0a` | 202 samples, 64 mapped roots, up to 8 RRs | Niche female death-metal vocals / monster FX |
| [Legato vocal tutorial / Hadzi-Fia subset](https://github.com/sfzinstruments/legato_vocal_tutorial) | repository CC0 at `fac6461ee4c7f498b23246eced644616fa58d2ec`, **held** | 517 audio files, 24 measured roots, multiple vowels/syllables and transitions | Do not bundle until Karoryfer confirms raw-subset authorization; parent product is currently commercial |
| ESMUC Choir Dataset | CC BY 4.0 metadata/record | ~2.34 GB continuous dataset | Not an isolated-note sampler library; unsuitable without derivative segmentation and identity review |

Result: conventional real choir remains unresolved. Commissioning a CC0/CC-BY session may be more reliable than searching further aggregates.

### 8. Textures, effects, and electronic material

| Source | License / revision | Payload / structure | Decision |
|---|---|---|---|
| [Supercontinent](https://github.com/dktr0/supercontinent) | CC0, `9c9d2c5392164d323a28c1d2730b04174f5e6f97` | ~464 MiB; per-folder creator/instrument notes; pads, glitches, drones, synthetic effects | Strong CC0 texture pool; unmapped, so curate manually |
| [PublicSamples Modular Hits](https://github.com/publicsamples/Modular-Hits) | public-domain **content** dedication, `a62671fc5f0ca1234e7cf03e592c7a1a002643d0` | 474 checked-in WAV/AIF, 52.7 MB tree bytes | Strong one-shot/FX pool |
| [PublicSamples Synth Hits](https://github.com/publicsamples/Synth-Hits) | public-domain **content** dedication, `373f3dc4e7a8c0199cd9d5e77b20fc48de824efe` | 1,659 checked-in WAV/AIF, 321.8 MB tree bytes | Strong hardware drum/synth-hit pool |
| FreePats Goblins, Sci-Fi, Soundtrack, Crystal, Sweep, New Age, Bowed Pad | CC0 at exact FreePats commits in registry | 11–32 roots per patch, generally one layer, SFZ/FLAC | Compact mapped texture palette |
| [VCSL](https://github.com/sgossner/VCSL) | CC0, `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e` | 4,231 WAV / 6,148,871,260 tree bytes; includes instrumental FX | Curate only small, source-named subsets |
| [NSynth](https://magenta.tensorflow.org/datasets/nsynth) | CC BY 4.0 dataset-wide | 305,979 four-second mono notes, 1,006 instruments, up to five velocities | License-eligible, but 16 kHz is below flagship acoustic quality; texture/ML use only |
| PublicSamples release-only Modular FX/Pad/Loops/etc. | root Unlicense but audio is detached release assets | 42 MB to >3 GB per archive | **Hold**: root text says “software” and does not expressly identify release audio; request scope confirmation |

## Explicit legal/provenance rejections

| Source | Reason |
|---|---|
| OrchideaSOL | Zenodo CC BY 4.0 covers metadata; audio remains under restrictive IRCAM Forum terms. |
| Zenodo “Drum and Percussion Kits” | Mostly SampleSwap-derived material without per-sample license/provenance. |
| Philharmonia Sound Samples | Primary page prohibits making samples available “as is” or as a sampler instrument. |
| jRhodes3c / jRhodes3d | Raw redistribution is CC BY-NC (3c also describes SA); CC0 does not cover samples. |
| GTown Church Sampling | Noncommercial restriction on the instrument/sample redistribution. |
| Project16 | Explicitly forbids distributing sounds alone or in another sound library. |
| Starbirth Kudu Shofar | Forbids selling samples or including them in a sample compilation. |
| Casio CTK-660L GitHub library | CC BY file conflicts with README prohibition on implementing samples in personal soundfonts. |
| Bigga Giggas John Rekevics sax SFZPack | CC0 covers mappings; original GIG samples are absent and unlicensed by the repository. |
| The Metal Kick Drum SFZ repo | Unlicense covers mappings; external audio is not covered. |
| FreePats Colombo Drumkit | GPL-2.0 applies to the sample instrument; copyleft sample content is outside the allowlist. |
| PublicSamples Drones / Single-Cycle Waveforms | No explicit license for the raw payload; adapted-source provenance is incomplete. |
| Splendid Grand Piano | Secondary claim that AKAI released samples to public domain, but no primary AKAI evidence was found. |
| Maestro Concert Grand and most old Giga conversions | Copyright/attribution text without a raw redistribution grant. |
| Sonatina Symphonic Orchestra | Sampling Plus is not raw-redistribution-equivalent and restricts standalone offering. |
| Pianobook, Spitfire LABS, Sonniss/MusicRadar-style “royalty free” packs | Music-production grants are not raw sample redistribution rights. |
| Freesound or Discord GM as whole collections | Mixed file/instrument licenses; only pinned CC0/CC-BY items can pass. |
| foodforfaeries Ambience SFX | Conflicting credit/CC0 messaging and undocumented rights to render proprietary synth presets as a redistributed sample pack. |
| plopgrizzly/plopsnd | Aggregate public-domain assertion without file-level creator/provenance chain. |

The complete rejection list and URLs are in `sample-source-registry-2026-07-10.json`.

## Downloaded archive integrity

These release archives were actually downloaded and hashed in this search:

```text
09e79458e42a435df93a554c90f61082270bb3baf5df7051f4dcaf09aaac9b9a  Glass-SFZ+FLAC-20191227.7z
b07b1a62418572f27cd1771de1d33b109f1c1b0fc718a30b09bafcc5778c6e40  TubularBells-small-SFZ+FLAC-20241130.7z
36f87ec9eb086ef25050312522aacf71213c582f46989e0c5a12681304596587  FingerBassYR-SFZ+FLAC-20190930.7z
c883b0db915232b4815418e9c6b18c5b4ed73f9f7d84de3ec25785f18b8dab85  Timpani-SFZ+FLAC-20240810.7z
6e103538dc729a52122911d9ed1006a7e156e62cc12f916a91fe18e5b891d2f6  WorldPercussion-SFZ+FLAC-20200905.7z
703ef30fad4861f85b319f8d549fbeeb0af0860929165c7066410dcbb03da0a3  SynthPadChoir-SFZ+FLAC-20200516.7z
```

Previously pinned during the same workflow:

```text
903916921a21662d2237ade7f0e98e55de93cb7b86da219e4e10f4ad385b8f5e  SpanishClassicalGuitar-SFZ+FLAC-20190618.7z
fa308cead617211b29f500db2f962f34e18c9cd55a94ae9176e1d63babeab083  FM-Piano1-SFZ+FLAC-20190916.7z
```

## Recommended evaluation/import order

1. **Killer Bass rights packet, then compact evaluation**: first preserve the pinned SFZ declaration, exact 45 referenced WAV paths, creator identity, and authority evidence. Only then import low/mid/high roots at low/mid/high native velocities, preserving all five layers’ relative loudness. It is small enough for complete objective/browser audit.
2. **Meatbass pizzicato**: evaluate three roots spanning at least an octave, all four native velocities, at least three of four RRs. Compare as an upright-bass identity, not blindly against electric bass.
3. **TinySOL alto sax and French horn**: obtain the immutable Zenodo archive once; select low/mid/high chromatic anchors at pp/mf/ff and initially prefer metadata rows marked neither digitally resampled nor retuned.
4. **MuldjordKit**: choose one coherent mic/render path and a curated GM subset. Keep at least three native velocity bands and multiple RRs per main piece; never normalize each layer to the same loudness.
5. **Headroom vs Upright KW piano**: Headroom for flagship depth, Upright KW for size. Blind-review both before deciding. Salamander is a later high-depth option.
6. **jSteelDrum and World Percussion**: both are direct, license-clean, small enough for full-set audit, and materially broaden existing coverage.
7. **FSBS direct/clean guitar** only after the current selected guitar work is resolved; do not mix this tooling/research change with sample-asset changes.
8. **VSCO 2 CE/VCSL sections and effects**: derive narrow subsets only after exact file-level mapping and source attribution are pinned.
9. **Choir**: do not promote Hadzi-Fia tutorial files without written source confirmation. Prefer commissioning a small CC0/CC-BY vowel session if a conventional choir is required.

Promotion remains gated by: compatible license scope, pinned evidence and revision/hash, at least three distinct pitch-matched anchors spanning an octave, zero hard objective/browser defects, full-set audit for the intended subset, and blind human listening. One-note smoke previews remain insufficient.

## Artifact index

- `specs/research/sample-source-registry-2026-07-10.json` — complete machine-readable source, revision, license, mapping, payload, and rejection registry, including all 26 non-allowlisted `sfzinstruments` repositories and all four non-allowlisted FreePats repositories.
- `raw/sfzinstruments-inspected.tsv` — 50 exact checked revisions and license/readme files.
- `raw/freepats-inspected.tsv` — 40 exact checked revisions and license/readme files.
- `raw/freepats-site-catalog.json` — 54 primary FreePats instrument records and archive URLs.
- `raw/all-cloned-sfz-inventory.json` — 3,173 parsed SFZ reports.
- `raw/sfzinstruments-mapping-summary.json` — repository-level mapping maxima.
- `raw/tinysol-inventory.json` — exact per-instrument counts/ranges/dynamics from primary CSV metadata.
- `raw/sgossner__VCSL-tree.json`, `raw/sgossner__VSCO-2-CE-tree.json` — complete Git trees and raw payload sizes.
- `raw/publicsamples-selected-summary.tsv` — exact commits, checked-in audio counts, and release-asset sizes.
- `raw/freepats-selected-sha256.txt` — downloaded archive hashes.
- `raw/SCHEMAS.md` — column definitions and payload-measurement caveats for headerless TSV artifacts.
- `evidence/university-iowa-MIS.html` — retrieved custom-license evidence, SHA-256 `231fe88…`.
- `evidence/salamander-archive-metadata.json` — original Archive.org CC BY 3.0 metadata and checksums.
- `evidence/TinySOL_metadata.csv` — primary TinySOL mapping metadata.
