# Polyrhythm Research

Comprehensive research on polyrhythms for Keyboardia's step sequencer, covering musical theory, electronic music applications, hardware precedent, and implementation considerations.

---

## 1. Polyrhythm Fundamentals

### 1.1 Mathematical Definition

A **polyrhythm** is the simultaneous use of two or more conflicting rhythmic meters. Mathematically, a polyrhythm is expressed as a ratio **m:n** where:

- **m** = number of beats in the first rhythm
- **n** = number of beats in the second rhythm
- The pattern fully resolves after **LCM(m,n)** beats

**Examples:**
- **3:2** — Three beats against two beats, resolves after 6 beats (LCM)
- **5:4** — Five beats against four beats, resolves after 20 beats
- **3:4** — Three beats against four beats, resolves after 12 beats
- **5:8** — Five beats against eight beats, resolves after 40 beats

**Mathematical properties:**
- **Prime ratios** (3:2, 5:3, 7:5) create the most distinct rhythmic tension
- **Coprime ratios** (numbers sharing no common factors) create longer, more complex patterns
- **Non-coprime ratios** (6:4 = 3:2) resolve faster but feel less distinct

### 1.2 Polyrhythm vs Polymeter

**Critical distinction:**

| Aspect | Polyrhythm | Polymeter |
|--------|-----------|-----------|
| **Definition** | Different rhythmic subdivisions within same meter | Different time signatures playing simultaneously |
| **Bar alignment** | Bars align every cycle | Bars may not align |
| **Example** | 3:2 (triplets vs duplets) in 4/4 | 3/4 against 4/4 time |
| **Step sequencer** | Different pulse rates, same loop length | Different loop lengths entirely |
| **Feel** | Rhythmic "crosscurrent" | Metric "out of phase" |

**In step sequencer context:**

- **True polyrhythm:** Track A plays 3 notes per bar (steps 0, 5, 11 of 16), Track B plays 4 notes per bar (steps 0, 4, 8, 12 of 16)
- **Polymeter (what users call "polyrhythm"):** Track A has 12 steps, Track B has 16 steps — they drift in and out of phase

**Modern usage:** In electronic music production, the term "polyrhythm" colloquially includes polymeter. Hardware sequencers like Elektron and Eurorack use "polyrhythmic" to describe different loop lengths.

### 1.3 Common Polyrhythms in World Music

Polyrhythms are foundational to music traditions worldwide:

**African Music (Origin of modern polyrhythm):**
- **3:2** (Son clave, Rumba clave) — Foundation of Afro-Cuban music
- **6:4** (Bell patterns) — West African drumming
- **12:8** over **4:4** — Afrobeat, highlife

**Latin American:**
- **3:2** Son clave — Salsa, mambo, cha-cha-cha
- **2:3** Reverse clave — Rumba
- **Tresillo** (3+3+2 pattern) — Cuban music, foundation of reggaeton

**Indian Classical:**
- **3:4, 4:5, 5:6** — Konnakol (vocal percussion)
- **7:8, 5:7** — Complex tala cycles

**Jazz:**
- **3:2** — Swing feel, "two against three"
- **3:4** — Polyrhythmic comping
- **4:3** — "Hemiola" (used extensively in bebop)

**Turkish/Balkan:**
- **Asymmetric meters:** 7/8 (2+2+3), 9/8 (2+2+2+3), 11/8
- These aren't strictly polyrhythms but create similar tension

---

## 2. Polyrhythms in Electronic Music

### 2.1 Common Polyrhythms by Genre

**Techno:**
- **3:4** — Off-beat hi-hats against kick drum (most common)
- **6:8** — Percussion layers
- **3:2** — Syncopated percussion
- **Rarely used:** Complex ratios (5:7, 7:8) — too disorienting for dance floors

**Artists:** Jeff Mills (minimal techno polyrhythms), Richie Hawtin (subtle metric shifts), Paula Temple (industrial polyrhythmic textures)

**House:**
- **3:4** — Latin-influenced percussion
- **2:3** — Shuffle/swing variations
- **12:16** — Hi-hat subdivisions against kick/snare grid
- **Simpler ratios preferred** — House prioritizes groove over complexity

**Artists:** Kerri Chandler (deep house polyrhythmic hi-hats), Larry Heard (subtle metric layering)

**IDM (Intelligent Dance Music):**
- **5:4, 5:8, 7:8** — Complex mathematical patterns
- **11:8, 13:16** — Extreme experimentation
- **Prime number ratios** — Used for evolving, non-repeating patterns

**Artists:**
- **Autechre** — Extreme polyrhythmic complexity, patterns that resolve over minutes
- **Aphex Twin** — 5:4, 7:8 in tracks like "Polynomial-C"
- **Squarepusher** — Jazz-influenced polyrhythms (3:4, 5:4)
- **Venetian Snares** — 7/4 time signatures, polyrhythmic breakcore

**Drum & Bass / Breakbeat:**
- **3:2** — Amen break layering
- **6:4** — Percussion against 2-step kick pattern
- **Polyrhythmic breaks** over steady bass

**Artists:** Paradox, dBridge, Instra:mental

**Experimental / Glitch:**
- **Any ratio** — 11:13, 17:19, Fibonacci sequences
- Often use **irrational polyrhythms** (non-integer ratios)

**Artists:** Alva Noto, Ryoji Ikeda, Tim Hecker

### 2.2 How Producers Create Polyrhythmic Feels

**Method 1: Different Loop Lengths (Polymeter)**
- Most common in hardware sequencers
- Track A: 16 steps, Track B: 12 steps → 48-step cycle before realignment
- **Keyboardia's current approach**

**Method 2: Clock Dividers/Multipliers**
- Eurorack standard: Each track runs at different clock speeds
- Example: Kick at 1/4 notes, hi-hat at 1/16 notes, percussion at 1/6 notes (triplets)

**Method 3: Euclidean Rhythms**
- Algorithm distributes n hits across m steps as evenly as possible
- Example: E(5,8) creates 5 hits across 8 steps = "1-0-1-0-1-0-1-1"
- **Naturally creates polyrhythmic feels** when different E(m,n) patterns layer

**Method 4: Manual Step Placement (True Polyrhythm)**
- Place notes at mathematically calculated positions
- For 3:2 polyrhythm in 16 steps:
  - 3-note track: steps 0, 5, 11 (16÷3 ≈ 5.33 spacing)
  - 2-note track: steps 0, 8 (16÷2 = 8 spacing)

**Method 5: MIDI Note Length Tricks**
- One track with held notes spanning multiple steps
- Creates "virtual" longer loop lengths

**Method 6: Parameter Locks (Elektron-style)**
- Same step count, but pitch/filter changes create rhythmic variation
- **Keyboardia already supports this**

### 2.3 Famous Polyrhythmic Tracks/Artists

**Techno:**
- **Jeff Mills - "The Bells"** — 3:4 hi-hat patterns
- **Robert Hood - "Minus"** — Minimal polyrhythmic textures
- **Paula Temple - "Deathvox"** — Industrial 3:2 layers

**IDM:**
- **Autechre - "Gantz Graf"** — 7:8, 11:13 extreme complexity
- **Aphex Twin - "Polynomial-C"** — 5:4 polyrhythm
- **Squarepusher - "Iambic 9 Poetry"** — Jazz-influenced 5:4, 7:4

**House:**
- **Kerri Chandler - "Bar-A-Thym"** — Polyrhythmic percussion
- **Mr. Fingers (Larry Heard) - "Can You Feel It"** — Subtle 3:2 hi-hats

**Experimental:**
- **Steve Reich - "Music for 18 Musicians"** — Classical minimalism, foundational to electronic polyrhythm
- **Battles - "Atlas"** — Math rock, 5:4 and 7:8
- **Meshuggah - "Bleed"** — Metal, extreme polyrhythmic precision

**Modern Electronic:**
- **Four Tet - "Baby"** — Polyrhythmic percussion layers
- **Jon Hopkins - "Open Eye Signal"** — 3:4 melodic patterns
- **Floating Points - "King Bromeliad"** — Jazz-influenced polyrhythms

**Afrobeat/Afro-House:**
- **Fela Kuti - "Zombie"** — Classic 3:2, 6:4 layers
- **Black Coffee** — Contemporary Afro-house polyrhythms
- **Bonobo - "Cirrus"** — Electronic interpretation of West African patterns

---

## 3. Hardware Sequencer Approaches

### 3.1 Industry Survey

**Elektron (Digitakt, Digitone, Octatrack):**
- **Per-track step count:** 1-64 steps
- **Track length independent** of other tracks
- **LCM calculation:** Sequencer shows when all tracks realign
- **UI:** Small screen shows 1 page (16 steps) at a time, pagination
- **Pattern chaining** for longer structures
- **Verdict:** Industry gold standard for polyrhythmic workflow

**Roland TR-8S / TR-909:**
- **Fixed 16 steps** (classic approach)
- **No per-track polyrhythm support**
- Polyrhythms achieved through **manual step placement** or **external clock division**
- **Verdict:** Simpler, more immediate, but less flexible

**Arturia BeatStep Pro / KeyStep Pro:**
- **Per-track step count:** 1-64 steps
- **3 independent sequencer tracks**
- **Real-time MIDI recording** with quantization
- **Verdict:** Similar to Elektron, good polyrhythmic support

**Eurorack (Rene, Eloquencer, Metropolix):**
- **Modular approach:** Each sequencer is independent module
- **Clock dividers/multipliers** create polyrhythms
- Step counts often **prime numbers** (3, 5, 7, 11, 13) for non-repeating patterns
- **Verdict:** Maximum flexibility, requires deep knowledge

**Teenage Engineering OP-1 / OP-Z:**
- **OP-1:** 4 tracks, each with independent loop points (1-∞ steps)
- **OP-Z:** 16 tracks, per-track "step components" (multipliers)
- **Novel approach:** Visual representations of polyrhythmic alignment
- **Verdict:** Intuitive visual feedback, limited step resolution

**Polyend Tracker:**
- **Tracker paradigm:** Vertical scrolling, not grid-based
- **Per-pattern length:** Independent per track
- **No visual polyrhythm** — relies on musical knowledge
- **Verdict:** Powerful but requires different mental model

### 3.2 Most Useful Step Counts for Polyrhythmic Work

**Analysis based on:**
1. Musical utility (common time divisions)
2. LCM properties (pattern length before realignment)
3. Hardware precedent (what pros actually use)
4. Cognitive load (too many options = decision paralysis)

**Tier 1 — Essential (already in Keyboardia):**
- **4** — Pulse, minimal techno
- **8** — Half bar, standard beat
- **16** — Full bar (4/4), universal standard
- **32** — 2 bars, longer basslines
- **64** — 4 bars, full phrases

**Tier 2 — Triplet Support (already in Keyboardia):**
- **12** — 1 bar triplets (3/4 feel in 4/4 time)
- **24** — 2 bar triplets, trap hi-hats
- **96** — 6 bars triplet-friendly
- **128** — 8 bars, full verse/chorus

**Tier 3 — Prime Polyrhythms (RECOMMENDED TO ADD):**
- **3** — Minimal triplet pulse (very useful)
- **5** — Quintuplet, IDM staple
- **7** — Septuplet, experimental, used in prog/IDM
- **11** — Extreme polyrhythm, Autechre territory
- **13** — Rare but useful for evolving patterns

**Tier 4 — Composite Numbers (RECOMMENDED TO ADD):**
- **6** — Half of 12, useful 3:2 base
- **9** — Three triplets, jazz feel
- **10** — Half of 20, useful 5:4 base
- **15** — Three quintuplets, 5:3 base
- **18** — 1.5 bars triplets
- **20** — 5:4 polyrhythm base (5/4 time signature approximation)
- **21** — 7:3 polyrhythm base
- **27** — Three nonaplets
- **36** — 3 bars triplets
- **48** — 3 bars, divisible by 2,3,4,6,8,12,16

**Tier 5 — Rarely Used (SKIP THESE):**
- **17, 19, 23, 29, 31** — Large primes, too abstract
- **25** — Rare, awkward LCM properties
- **40, 50, 60** — Too close to existing options
- **80, 100, 120** — Visual overload

---

## 4. LCM Reference Tables

### 4.1 Quick Reference

| Step A | Step B | LCM | Bars @ 16 steps/bar |
|--------|--------|-----|---------------------|
| 3 | 4 | 12 | 0.75 bars |
| 3 | 5 | 15 | 0.94 bars |
| 3 | 8 | 24 | 1.5 bars |
| 4 | 5 | 20 | 1.25 bars |
| 4 | 6 | 12 | 0.75 bars |
| 5 | 6 | 30 | 1.875 bars |
| 5 | 7 | 35 | 2.19 bars |
| 5 | 8 | 40 | 2.5 bars |
| 5 | 12 | 60 | 3.75 bars |
| 5 | 16 | 80 | 5 bars |
| 7 | 8 | 56 | 3.5 bars |
| 7 | 11 | 77 | 4.8 bars |
| 7 | 16 | 112 | 7 bars |
| 11 | 13 | 143 | ~9 bars |
| 12 | 16 | 48 | 3 bars |

### 4.2 Genre-Specific Recommendations

| Genre | Essential Counts | Advanced Counts | Skip |
|-------|-----------------|-----------------|------|
| **Techno** | 4, 8, 16, 32 | 3, 6, 12, 24 | 11, 13, 17+ |
| **House** | 4, 8, 16, 32 | 3, 6, 12 | 7, 11, 13+ |
| **IDM** | 5, 7, 8, 16 | 11, 13, 15, 20 | None |
| **Drum & Bass** | 8, 16, 32 | 3, 6, 12, 24 | 11, 13+ |
| **Ambient** | 16, 32, 64, 96, 128 | Any | None |
| **Experimental** | Any | Any | None |
| **Afrobeat/World** | 3, 6, 12, 16 | 9, 18, 24 | 11, 13+ |

---

## 5. UI/UX Considerations

### 5.1 Beat Marker Display for Odd Step Counts

**Current standard (4/4 time, 16 steps):**
```
|----|----|----|----|
1    5    9    13
```
- Beat markers every 4 steps
- Downbeat emphasized

**Problem: How to mark beats for 5, 7, 11, 13 steps?**

**Approach 1: Fixed subdivision markers (recommended)**

For step counts divisible by 2,3,4:
- Show beat markers at **greatest common divisor** positions
- Example: 6 steps → markers at steps 0, 3, 6 (2 beats)
- Example: 9 steps → markers at steps 0, 3, 6, 9 (3 beats)

For prime numbers (5, 7, 11, 13):
- **Option A:** No beat markers — treat as single phrase
- **Option B:** Show all steps as beats (every step emphasized)
- **Option C:** Mark only downbeat (step 0)

**Recommendation:** Option C + visual grouping

```
5 steps:  |●○○○○|
7 steps:  |●○○○○○○|
11 steps: |●○○○○○○○○○○|
```

### 5.2 Understanding Loop Realignment

**Problem:** Users need to know when complex polyrhythms resolve.

**Solution 1: LCM Display (per-track)**

Show in track header:
```
Kick (16 steps)  — Loops: 1
HiHat (12 steps) — Loops: 1.33
Snare (5 steps)  — Loops: 3.2

Full pattern: 240 steps (15 bars)
```

**Solution 2: Realignment Indicator (global)**

Visual timeline showing when all tracks realign:
```
Pattern length: 240 steps
Kick:   [━━━━━━━━━━━━━━━━][━━━━━━━━━━━━━━━━] (15 loops)
HiHat:  [━━━━━━━━━━━━][━━━━━━━━━━━━][━━━━━━] (20 loops)
Snare:  [━━━━][━━━━][━━━━][━━━━][━━━━][━━━━] (48 loops)
         ↑                                    ↑
      Start                             Realign
```

**Solution 3: "Drift Indicator" (Elektron approach)**

Show how "out of sync" tracks are relative to 16-step grid:
- 12 steps: "In sync every 48 steps"
- 5 steps: "In sync every 80 steps"
- 7 steps: "In sync every 112 steps"

### 5.3 Visual Feedback Patterns from Other Sequencers

**Ableton Live (Session View):**
- **Clip length displayed** as bars/beats
- **Clip color** changes when looping
- **Follow actions** for automatic pattern changes
- **Verdict:** Clear but not polyrhythm-focused

**Elektron Digitakt:**
- **Small screen:** Shows 1 page (16 steps) at a time
- **Page indicator:** "Page 1/4" for 64-step patterns
- **Active step:** Bright LED, other steps dim
- **Pattern length:** Displayed as "LEN: 64"
- **Verdict:** Minimal but functional

**Teenage Engineering OP-Z:**
- **Circular visual:** Shows loop points as circles
- **Track length:** Diameter represents step count
- **Phase alignment:** Circles overlap when in sync
- **Verdict:** Novel but requires learning curve

**Recommendations for Keyboardia:**

1. **Multi-resolution grid display** — Odd step counts get proportionally sized cells
2. **Playhead sync visualization** — Show relative playhead positions for all tracks
3. **Pattern length calculator** — Tooltip showing LCM and duration
4. **Color-coded loop boundaries** — Subtle color shifts at loop points

---

## 6. Musical Terminology Reference

- **Polyrhythm:** Multiple rhythmic patterns with different subdivisions playing simultaneously
- **Polymeter:** Multiple time signatures playing simultaneously
- **LCM:** Least Common Multiple — when patterns realign
- **Hemiola:** 3:2 rhythmic feel (common in classical/jazz)
- **Clave:** 3:2 rhythmic pattern foundational to Latin music
- **Euclidean rhythm:** Mathematically optimal distribution of hits across steps
- **Clock division:** Dividing master clock to create slower rhythms
- **Phase:** Rhythmic offset between patterns
- **Tresillo:** 3+3+2 eighth-note pattern (basis of reggaeton, Afro-Cuban)
- **Quintuplet:** Five notes in the space of four
- **Septuplet:** Seven notes in the space of four or eight

---

## 7. Competitive Analysis

| Sequencer | Step Count Support | Polyrhythm Quality | LCM Display | Target Audience |
|-----------|-------------------|-------------------|-------------|-----------------|
| **Elektron Digitakt** | 1-64 (any integer) | Excellent | No | Professionals |
| **Ableton Push** | Fixed 16 (clip length varies) | Good | No | Producers |
| **Roland TR-8S** | Fixed 16 | None (manual only) | No | Live performers |
| **Eurorack** | Any (modular) | Excellent | N/A | Experimentalists |
| **Polyend Tracker** | Any | Excellent | No | Tracker users |
| **Keyboardia (current)** | 4,8,12,16,24,32,64,96,128 | Good | No | Multiplayer/web |
| **Keyboardia (proposed)** | 24 options including primes | Excellent | Planned | All levels |

**Keyboardia's unique position:**
- **Multiplayer polyrhythms** — No competitor has this
- **Web-based** — No installation, instant access
- **Visual clarity** — Potential for best-in-class polyrhythm visualization

---

## 8. Research Sources

### Academic
- Toussaint, Godfried. "The Euclidean Algorithm Generates Traditional Musical Rhythms" (2005)
- London, Justin. "Hearing in Time: Psychological Aspects of Musical Meter" (2012)

### Industry
- Elektron Digitakt manual — Per-track step count implementation
- Teenage Engineering OP-Z guide — Step components and polyrhythms
- Ableton Learning Music — Rhythm chapter

### Cultural
- Agawu, Kofi. "African Rhythm: A Northern Ewe Perspective" (1995)
- Pressing, Jeff. "Black Atlantic Rhythm: Its Computational and Transcultural Foundations" (2002)
