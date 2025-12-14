# Audio Engineering 101: Comprehensive Research Summary

## Executive Summary

This document presents comprehensive research on audio engineering fundamentals relevant to the Keyboardia web-based musical instrument application. The research covers sound physics, digital audio principles, signal processing, mixing techniques, and Web Audio API implementation considerations.

---

## 1. Core Audio Fundamentals

### 1.1 Sound Wave Physics

**Frequency**
- Definition: The number of cycles a sound wave completes per second, measured in Hertz (Hz)
- Human hearing range: 20 Hz to 20,000 Hz (20 kHz)
- Higher frequency = higher pitch; lower frequency = deeper sound
- Standard reference: A4 = 440 Hz

**Amplitude**
- Measures the height of waveform peaks and troughs
- Directly relates to perceived volume/loudness
- Measured in decibels (dB) for practical use
- Digital systems use dBFS (decibels Full Scale)

**Wavelength**
- Distance between successive wave crests
- Formula: `wavelength = speed of sound / frequency`
- At 20°C, speed of sound in air = 343 m/s
- Example: 1000 Hz has wavelength of ~34.3 cm
- Low frequencies have longer wavelengths (travel farther, pass through obstacles)
- High frequencies have shorter wavelengths (more directional, easily absorbed)

**Phase**
- Position of a wave in its cycle, measured in degrees (0-360°)
- In-phase (0°): Waves add together (constructive interference) = louder
- Out-of-phase (180°): Waves cancel (destructive interference) = silence at affected frequencies
- Critical consideration: phase alignment in multi-speaker systems and stereo mixing

### 1.2 Digital Audio Basics

**Nyquist-Shannon Sampling Theorem**
- A continuous signal can be accurately reconstructed if sampling rate is at least twice the highest frequency present
- Nyquist frequency = sample rate / 2
- Human hearing ceiling is 20 kHz, therefore minimum sample rate = 40 kHz
- This is why CD-quality is 44.1 kHz (provides headroom for anti-aliasing filter)

**Sample Rate Standards**

| Sample Rate | Use Case |
|-------------|----------|
| 44.1 kHz | CD-quality, music distribution |
| 48 kHz | Video/film standard, professional audio |
| 96 kHz | High-resolution audio, professional recording |
| 192 kHz | Archival, mastering (diminishing returns above 96k) |

**Aliasing**
- Distortion caused when sampling rate is below Nyquist rate
- Frequencies above Nyquist are "folded back" and misrepresented
- Prevention: Anti-aliasing filters (low-pass filters applied before ADC)

**Bit Depth**
- Number of bits used to represent each sample's amplitude
- Determines dynamic range and noise floor

| Bit Depth | Amplitude Steps | Dynamic Range | Use Case |
|-----------|-----------------|---------------|----------|
| 16-bit | 65,536 | ~96 dB | CD-quality |
| 24-bit | 16,777,216 | ~144 dB | Professional recording/mixing |
| 32-bit float | ~4.3 billion | ~1,528 dB | Processing headroom, DAW internal |

**Formula for Dynamic Range:**
```
Dynamic Range (dB) = 6.02 × bit_depth + 1.76
```

### 1.3 Decibels and Audio Measurement

**dB (Decibel) Basics**
- Logarithmic unit expressing ratio between two values
- Doubling power = +3 dB
- Doubling perceived loudness requires approximately +10 dB

**dBFS (Decibels Full Scale)**
- Digital audio standard
- 0 dBFS = maximum possible digital level (clipping point)
- All measurements are negative, approaching 0
- Typical target levels: -18 to -12 dBFS for average signal

**LUFS (Loudness Units Full Scale)**
- Measures perceived loudness over time
- Uses K-weighting filter to match human hearing sensitivity
- More accurate than peak or RMS measurements for perceived loudness

| Platform | Target LUFS |
|----------|-------------|
| Spotify | -14 LUFS |
| Apple Music | -16 LUFS |
| YouTube | -14 LUFS |
| Broadcast (EBU R128) | -23 LUFS |

**LUFS Measurement Types:**
- **Integrated LUFS**: Average over entire track
- **Short-term LUFS**: 3-second sliding window
- **Momentary LUFS**: 400ms sliding window

---

## 2. Signal Flow & Routing

### 2.1 Audio Signal Chain Concepts

Standard signal flow:
```
Source → Preamp/Gain → EQ → Dynamics → Effects → Master → Output
```

For web audio applications:
```
Source Node → Processing Nodes → Gain Node → Compressor → Destination
```

### 2.2 Gain Staging Principles

**Definition:** Managing volume levels throughout the signal chain to maintain clarity and avoid distortion.

**Target Levels:**
- Individual tracks: -18 to -12 dBFS average
- Master bus peaks: No higher than -6 dBFS before limiting
- Leave 6-12 dB of headroom for mastering

**Best Practices:**
1. Start with faders at unity gain (0 dB)
2. Adjust clip gain before processing
3. Maintain unity gain through plugins (input level = output level)
4. Check levels at each processing stage
5. Use visual meters (VU, peak meters) consistently

**Key Concept - Signal-to-Noise Ratio (SNR):**
- Higher SNR = cleaner signal
- Aim for signal level well above noise floor
- 24-bit depth provides excellent SNR (~144 dB)

**Common Mistakes:**
- Overloading input stage
- Not leaving headroom for mixing/mastering
- Accumulating gain through plugin chain
- Mixing at excessive monitoring levels (ear fatigue)

---

## 3. Audio Processing Essentials

### 3.1 Equalization (EQ)

**Purpose:** Shape the frequency content of audio signals

**Frequency Ranges:**

| Range | Frequencies | Character |
|-------|-------------|-----------|
| Sub-bass | 20-60 Hz | Feel more than hear, rumble |
| Bass | 60-250 Hz | Warmth, fullness, body |
| Low-mids | 250-500 Hz | Muddiness zone (often cut) |
| Midrange | 500-2000 Hz | Fundamental tones, presence |
| Upper-mids | 2-4 kHz | Clarity, vocal presence |
| Presence | 4-6 kHz | Attack, definition |
| Brilliance | 6-20 kHz | Air, sparkle, sibilance |

**Filter Types:**
- **Low-Pass Filter (LPF):** Passes frequencies below cutoff, removes highs
- **High-Pass Filter (HPF):** Passes frequencies above cutoff, removes lows
- **Band-Pass Filter:** Passes frequencies within a range
- **Shelving Filter:** Boosts/cuts all frequencies above or below a point
- **Parametric EQ:** Full control over frequency, gain, and Q (bandwidth)

**Key Parameters:**
- **Frequency:** Center frequency being affected
- **Gain:** Amount of boost (+) or cut (-) in dB
- **Q (Quality Factor):** Width of the affected frequency range
  - High Q = narrow (surgical)
  - Low Q = wide (musical)

**Filter Slopes:**
- -6 dB/octave: Gentle, musical
- -12 dB/octave: Standard
- -18 dB/octave: Steep
- -24 dB/octave: Very steep, precise

**Best Practices:**
1. Cut before boost (subtractive EQ first)
2. Use high-pass filters to remove unnecessary low frequencies
3. Narrow cuts for problems, wide boosts for character
4. Reference in mono to check for masking issues

### 3.2 Compression and Dynamics Processing

**Purpose:** Reduce dynamic range by attenuating loud parts

**Key Parameters:**

| Parameter | Function | Typical Range |
|-----------|----------|---------------|
| **Threshold** | Level where compression begins | -30 to 0 dBFS |
| **Ratio** | Amount of compression (input:output) | 1:1 to ∞:1 |
| **Attack** | Time to reach full compression | 0.1ms to 100ms |
| **Release** | Time to return to unity | 10ms to 1000ms |
| **Knee** | How gradually compression engages | 0 (hard) to 12+ dB (soft) |
| **Makeup Gain** | Compensate for level reduction | 0 to +20 dB |

**Ratio Guidelines:**
- 2:1 to 3:1: Light compression (vocals, bus compression)
- 4:1 to 6:1: Medium compression (instruments)
- 8:1 to 12:1: Heavy compression (parallel compression)
- 20:1 to ∞:1: Limiting (peaks only)

**Attack/Release Guidelines:**
- **Fast attack (< 10ms):** Controls transients, can reduce punch
- **Slow attack (> 30ms):** Preserves transients, adds punch
- **Fast release (< 100ms):** Responsive, can cause pumping
- **Slow release (> 300ms):** Smooth, glues mix together

**Starting Point Settings:**
```
Threshold: Achieve 3-6 dB of gain reduction
Ratio: 3:1 to 4:1
Attack: 10-30 ms
Release: 100-300 ms (or auto)
Knee: Soft (6-12 dB)
```

**Compressor Types:**
- **VCA:** Clean, precise (SSL)
- **Opto:** Smooth, musical (LA-2A)
- **FET:** Fast, punchy (1176)
- **Variable-mu:** Warm, gentle (Fairchild)

### 3.3 Reverb and Delay Effects

**Reverb - Key Parameters:**

| Parameter | Function |
|-----------|----------|
| **Pre-delay** | Time before reverb begins (20-100ms creates separation) |
| **Decay/RT60** | How long reverb lasts (0.5-5+ seconds) |
| **Size** | Perceived room size |
| **Damping** | High-frequency absorption (dark vs bright) |
| **Diffusion** | Density of reflections |
| **Mix/Wet-Dry** | Balance of effect vs. original |

**Reverb Types:**
- **Room:** Small spaces (0.2-0.5s decay)
- **Hall:** Concert halls (1-3s decay)
- **Plate:** Studio hardware emulation, smooth
- **Chamber:** Echo chambers, natural
- **Spring:** Guitar amps, lo-fi character
- **Convolution:** Uses impulse responses of real spaces

**Delay - Key Parameters:**

| Parameter | Function |
|-----------|----------|
| **Delay Time** | Time between repeats (1ms-2000ms) |
| **Feedback** | Number of repeats (0-100%) |
| **Mix** | Wet/dry balance |
| **Filter** | Darken/brighten repeats |

**Delay Types:**
- **Slapback:** Single short delay (50-150ms)
- **Ping-pong:** Alternates left/right channels
- **Tape delay:** Warm, degraded repeats
- **Digital delay:** Clean, precise repeats

**Best Practices:**
- Use pre-delay to prevent reverb from masking the source
- Sync delay times to tempo: `ms = 60000 / BPM / division`
- Place delay before reverb to maintain clarity
- Filter reverb/delay tails to avoid muddiness

### 3.4 Filtering Techniques

**High-Pass Filter (HPF) Applications:**
- Remove rumble from vocals (80-120 Hz)
- Clean up instrument recordings
- Create telephone effect (400-4000 Hz bandpass)
- Essential for headroom management

**Low-Pass Filter (LPF) Applications:**
- Soften harsh digital sounds
- Create distance/depth effect
- Tame sibilance
- Vintage/lo-fi character

**Cutoff Frequency (-3dB point):**
The frequency where the filter begins significantly attenuating the signal

---

## 4. Mixing Fundamentals

### 4.1 Stereo Field and Panning

**Pan Law:**
- Compensates for volume increase when sounds are panned center
- Common settings: -3 dB, -4.5 dB, -6 dB
- Ensures consistent perceived loudness across pan positions

**Frequency-Based Panning Guidelines:**
- **Low frequencies (< 150 Hz):** Keep centered (mono)
  - Sub-bass and kick drum should be mono
  - Prevents phase issues on different playback systems
- **Mid frequencies:** Pan strategically for separation
- **High frequencies:** Can be spread wide for airiness

**"Upside Triangle" Approach:**
- Bass and kick: Center (mono)
- Gradually widen as frequency increases
- High frequencies can be most spread out

**Common Panning Positions:**

| Element | Typical Position |
|---------|------------------|
| Kick, Bass, Lead Vocal | Center |
| Snare | Center or slightly off |
| Hi-hats | 30-50% left or right |
| Guitars (doubled) | Hard left/right |
| Keys/Synths | Varies, often off-center |
| Background vocals | Spread wide |

### 4.2 Volume Balancing

**Reference Levels:**
- Mix at conversation level (~78-83 dB SPL)
- Check at low and high volumes
- Use reference tracks for perspective

**Track Level Guidelines:**
- Individual tracks: Peak at -18 to -12 dBFS
- Master bus: Peak no higher than -6 dBFS before mastering
- Leave headroom for dynamics processing

**Mixing Order (suggested):**
1. Start with the most important element (drums, vocals)
2. Add elements in order of importance
3. Check balance in mono frequently
4. Use automation for dynamic sections

### 4.3 Frequency Spectrum Management

**Avoiding Frequency Masking:**
- Each element should occupy its own frequency space
- Use EQ to carve out space for competing elements
- Cut frequencies that don't contribute to an instrument's character
- Use spectrum analyzer to visualize conflicts

**Typical Frequency Homes:**

| Element | Primary Frequencies |
|---------|---------------------|
| Kick | 50-100 Hz (thump), 2-5 kHz (attack) |
| Bass | 60-200 Hz (body), 700-1000 Hz (note definition) |
| Snare | 200 Hz (body), 2-5 kHz (crack) |
| Vocals | 200-400 Hz (body), 2-5 kHz (presence) |
| Guitar | 100-300 Hz (body), 2-6 kHz (presence) |
| Piano | 100-300 Hz (warmth), 3-6 kHz (presence) |

### 4.4 Creating Depth and Space

**Three Dimensions of Mixing:**
1. **Width:** Panning (left-right)
2. **Height:** Frequency (low-high)
3. **Depth:** Volume, reverb, EQ (front-back)

**Depth Techniques:**
- **Volume:** Louder = closer
- **Reverb:** More reverb = farther back
- **EQ:** Less highs = farther away
- **Compression:** More compression = closer

### 4.5 Mono Compatibility

**Why It Matters:**
- Many playback systems sum to mono
- Phone speakers, PA systems, clubs
- Reveals phase cancellation issues

**Best Practices:**
- Check mix in mono regularly
- Fix elements that disappear in mono
- Keep low frequencies mono (< 150 Hz)
- Avoid excessive stereo widening

---

## 5. Audio Quality & Best Practices

### 5.1 Headroom Management

**Definition:** The margin between the highest peak level and 0 dBFS

**Recommendations:**
- Recording: Peak at -12 to -6 dBFS
- Mixing: Master bus peaks at -6 dBFS before limiting
- Mastering: Final output -1 to -0.3 dBFS (true peak)

**Why Headroom Matters:**
- Prevents clipping
- Allows for inter-sample peaks
- Provides room for processing
- Professional standard for file delivery

### 5.2 Avoiding Clipping and Distortion

**Digital Clipping:**
- Occurs when signal exceeds 0 dBFS
- Causes harsh, unpleasant distortion
- Cannot be fixed after recording
- Always keep peaks below 0 dBFS

**Prevention Strategies:**
1. **Proper gain staging:** Keep levels conservative at each stage
2. **Use limiters:** Set ceiling at -1 dBFS or lower
3. **Monitor consistently:** Watch meters throughout the chain
4. **32-bit float:** Provides virtually unlimited headroom during processing

**True Peak Limiting:**
- Set ceiling at -1 dBFS to prevent inter-sample peaks
- Inter-sample peaks occur during DA conversion
- Can exceed 0 dBFS even if digital meter shows no clipping

### 5.3 Latency Considerations

**Definition:** Time delay between input and output

**Latency Formula:**
```
Latency (ms) = Buffer Size / Sample Rate × 1000
```

**Example:**
- 256 samples at 44.1 kHz = 5.8 ms
- 128 samples at 48 kHz = 2.7 ms

**Acceptable Latency:**

| Use Case | Maximum Acceptable |
|----------|-------------------|
| Live monitoring | < 10 ms |
| Live performance | < 20 ms |
| Mixing/editing | Not critical |

**Human Perception:**
- < 3 ms: Imperceptible
- 3-10 ms: Noticeable but tolerable
- > 20 ms: Clearly delayed, problematic for live performance

### 5.4 Buffer Size Optimization

**Trade-off:**
- **Smaller buffer:** Lower latency, higher CPU usage
- **Larger buffer:** Higher latency, lower CPU usage

**Recommended Settings:**

| Task | Buffer Size | Notes |
|------|-------------|-------|
| Recording/Live | 64-256 | Low latency priority |
| Mixing | 512-2048 | Stability priority |
| Final render | Maximum | Quality priority |

**Optimization Tips:**
1. Use native/ASIO drivers (not generic OS drivers)
2. Close background applications
3. Disable Wi-Fi/Bluetooth audio
4. Use wired connections (USB, Thunderbolt)

---

## 6. Web Audio API Specific Considerations

### 6.1 Web Audio API Fundamentals

**AudioContext:**
- Central object for all Web Audio operations
- Manages audio graph and timing
- Only create one per document (expensive resource)
- Has states: `suspended`, `running`, `closed`

```javascript
const audioContext = new AudioContext();
// or for older iOS Safari:
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
```

**Key Properties:**
- `currentTime`: High-precision time (15 decimal places)
- `sampleRate`: Output sample rate (typically 44100 or 48000)
- `state`: Current context state
- `destination`: Final output node

### 6.2 Core Audio Nodes

**Source Nodes:**
- `OscillatorNode`: Generates waveforms (sine, square, sawtooth, triangle)
- `AudioBufferSourceNode`: Plays audio buffers (samples)
- `MediaElementAudioSourceNode`: Wraps HTML audio/video elements
- `MediaStreamAudioSourceNode`: Microphone/device input

**Processing Nodes:**

| Node | Purpose | Notes |
|------|---------|-------|
| `GainNode` | Volume control | Stateless, memory-efficient |
| `BiquadFilterNode` | EQ/Filtering | lowpass, highpass, bandpass, etc. |
| `DynamicsCompressorNode` | Compression/limiting | Built-in compressor |
| `ConvolverNode` | Convolution reverb | Expensive, uses impulse responses |
| `DelayNode` | Time delay | Max 3 minutes delay |
| `WaveShaperNode` | Distortion/saturation | Uses curve function |
| `StereoPannerNode` | Simple L/R panning | More efficient than PannerNode |
| `AnalyserNode` | FFT analysis | For visualizations |

**OscillatorNode Waveforms:**
- `sine`: Pure tone, no harmonics
- `square`: Odd harmonics, hollow sound
- `sawtooth`: All harmonics, rich/bright
- `triangle`: Odd harmonics (weaker), soft
- `custom`: Via PeriodicWave for complex timbres

### 6.3 Browser Limitations and Workarounds

**Autoplay Policy:**
- Audio cannot start without user gesture
- AudioContext starts in `suspended` state
- Must call `audioContext.resume()` from user interaction

**Solution Pattern:**
```javascript
document.addEventListener('click', async () => {
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
});
```

**iOS Safari Specifics:**
- Uses `webkitAudioContext` (older versions)
- Can enter `interrupted` state during calls/multitasking
- Requires touch event (not just click) on some versions
- Silent audio unlock may be needed

**Chrome Mobile:**
- Requires user gesture for audio
- PWAs can autoplay
- Context may re-suspend after inactivity

### 6.4 Real-Time Audio Processing in JavaScript

**ScriptProcessorNode (Deprecated):**
- Runs on main thread
- Blocks UI during processing
- Poor performance for complex operations
- Kept for legacy compatibility only

**AudioWorklet (Modern Solution):**
- Runs on dedicated audio thread
- Low latency processing
- Supports custom audio processing
- Uses `AudioWorkletProcessor` class

```javascript
// Register worklet
await audioContext.audioWorklet.addModule('processor.js');

// Create node
const workletNode = new AudioWorkletNode(audioContext, 'my-processor');
```

**Performance Best Practices for AudioWorklet:**
1. **Avoid memory allocation in process()**: Pre-allocate buffers
2. **No garbage collection**: Minimize object creation
3. **Deterministic timing**: Avoid branching/conditionals where possible
4. **Use TypedArrays**: Float32Array for audio data
5. **Consider WebAssembly**: For maximum performance

### 6.5 Timing and Scheduling

**AudioContext Time:**
- `audioContext.currentTime`: Seconds since context creation
- Extremely precise (microsecond accuracy)
- Use for scheduling, not real-time clock

**Scheduling Pattern:**
```javascript
const now = audioContext.currentTime;
oscillator.start(now);
oscillator.stop(now + 1.0); // Stop after 1 second
```

**Look-ahead Scheduling:**
```javascript
const LOOK_AHEAD = 0.1; // 100ms look-ahead
const SCHEDULE_AHEAD = 0.2; // Schedule 200ms ahead

function scheduler() {
  while (nextNoteTime < audioContext.currentTime + SCHEDULE_AHEAD) {
    scheduleNote(nextNoteTime);
    advanceNote();
  }
  setTimeout(scheduler, LOOK_AHEAD * 1000);
}
```

### 6.6 Memory Management

**Node Cleanup:**
- Disconnect nodes when finished
- Remove references to allow GC
- BufferSourceNodes are single-use (cannot restart)

```javascript
source.onended = () => {
  source.disconnect();
  gainNode.disconnect();
};
```

**Voice Limiting:**
- Set maximum simultaneous voices (e.g., 16-32)
- Implement voice stealing (oldest first)
- Prevents CPU overload on mobile devices

### 6.7 Keyboardia Implementation Alignment

Based on the existing Keyboardia codebase, these patterns are already implemented:

**Current Implementation Strengths:**
1. iOS Safari compatibility (`webkitAudioContext`)
2. Autoplay unlock listeners
3. Master compressor for preventing clipping
4. ADSR envelope with exponential ramps
5. Voice limiting (16 voices)
6. Node cleanup on playback end
7. Proper gain staging (0.85 peak envelope)

**Audio Constants (from existing code):**
```javascript
const FADE_TIME = 0.003;        // 3ms click prevention
const MAX_VOICES = 16;          // Voice limit
const MIN_GAIN_VALUE = 0.0001;  // For exponential ramps
const ENVELOPE_PEAK = 0.85;     // Below clipping
```

**Compressor Settings (from existing code):**
```javascript
threshold: -6 dB    // Start compressing
knee: 12 dB        // Soft knee
ratio: 4:1         // Moderate compression
attack: 3 ms       // Fast attack
release: 250 ms    // Medium release
```

---

## 7. Industry Standard Values Reference

### 7.1 Frequency Reference Points

| Frequency | Note | Description |
|-----------|------|-------------|
| 20 Hz | E0 | Lower limit of human hearing |
| 60 Hz | B1 | Sub-bass |
| 100 Hz | G2 | Bass guitar fundamental |
| 250 Hz | B3 | "Muddy" region |
| 440 Hz | A4 | Standard tuning reference |
| 1 kHz | C6 | Midrange reference |
| 3 kHz | F#7 | Presence, vocal clarity |
| 10 kHz | D#9 | Brilliance |
| 20 kHz | D#10 | Upper limit of human hearing |

### 7.2 MIDI Note to Frequency Formula

```javascript
frequency = 440 * Math.pow(2, (midiNote - 69) / 12)
```

### 7.3 Time Constants

| Value | Description |
|-------|-------------|
| 3 ms | Click prevention fade time |
| 10 ms | Perceptible latency threshold |
| 20 ms | Maximum acceptable live latency |
| 60000 / BPM | Quarter note duration in ms |

### 7.4 Level Guidelines Summary

| Measurement | Target Value |
|-------------|--------------|
| Recording peaks | -12 to -6 dBFS |
| Average level | -18 dBFS |
| Master bus headroom | -6 dBFS |
| Final limiter ceiling | -1 dBFS |
| Spotify loudness | -14 LUFS |

---

## Sources

### Sound Wave Physics & Digital Audio
- [Yamaha Acoustic Engineering Program - Sound Wave Basics](https://audioversity.yamaha.com/course/yaep2-sound-wave-basics)
- [Dark Horse Institute - Understanding Sound Waves](https://darkhorseinstitute.com/understanding-sound-waves-the-basics-of-audio-engineering/)
- [Tecnare - The Science Of Sound](https://www.tecnare.com/article/what-is-sound/)
- [Audio University - Audio Basics](https://audiouniversityonline.com/audio-basics-how-sound-works/)
- [iZotope - Digital Audio Basics](https://www.izotope.com/en/learn/digital-audio-basics-sample-rate-and-bit-depth)
- [PreSonus - Sample Rate and Bit Depth](https://legacy.presonus.com/learn/technical-articles/sample-rate-and-bit-depth)
- [TechTarget - Nyquist Theorem](https://www.techtarget.com/whatis/definition/Nyquist-Theorem)

### Gain Staging & Signal Flow
- [iZotope - Gain Staging](https://www.izotope.com/en/learn/gain-staging-what-it-is-and-how-to-do-it)
- [Hollyland - What is Gain Staging](https://www.hollyland.com/blog/tips/what-is-gain-staging)
- [LEWITT - Gain Staging](https://www.lewitt-audio.com/blog/what-is-gain-staging)
- [Audio University - Gain Staging Secrets](https://audiouniversityonline.com/gain-staging/)
- [Sound on Sound - Gain Staging in Your DAW](https://www.soundonsound.com/techniques/gain-staging-your-daw-software)

### EQ & Compression
- [Mixing Monster - Audio Equalization](https://mixingmonster.com/audio-equalization/)
- [iZotope - EQ Before or After Compression](https://www.izotope.com/en/learn/eq-before-or-after-compression.html)
- [LANDR - Dynamic EQ](https://blog.landr.com/dynamic-eq/)
- [Audio University - Compression Explained](https://audiouniversityonline.com/compression-explained/)
- [Universal Audio - Audio Compression Basics](https://www.uaudio.com/blogs/ua/audio-compression-basics)
- [iZotope - Audio Dynamics 101](https://www.izotope.com/en/learn/audio-dynamics-101-compressors-limiters-expanders-and-gates.html)

### Reverb & Delay
- [Audient - Reverb vs Delay](https://audient.com/tutorial/reverb-vs-delay-differences-and-how-to-use-them/)
- [iZotope - When to Use Reverb and Delay](https://www.izotope.com/en/learn/when-to-use-reverb-and-delay.html)
- [Sound on Sound - Using Reverb & Delay](https://www.soundonsound.com/techniques/using-reverb-delay)

### Filtering
- [EDMProd - Audio Filters Explained](https://www.edmprod.com/audio-filters/)
- [Icon Collective - Types of EQ](https://www.iconcollective.edu/types-of-eq)
- [Extron - About Filters and EQ](https://www.extron.com/product/files/helpfiles/dspconfig25/Content/Signal_Processing_Basics/About_Filters_and_EQ.htm)

### Mixing
- [Soundtrap - Panning in Music Mixing](https://blog.soundtrap.com/panning-in-music-mixing/)
- [MixElite - Mix Balancing](https://mixelite.com/blog/mix-balancing/)
- [eMastered - Balancing Levels](https://emastered.com/blog/balancing-levels)
- [iZotope - Stereo Imaging Tips](https://www.izotope.com/en/learn/6-tips-for-widening-the-stereo-image-of-a-mix.html)
- [Hyperbits - Stereo Imaging Guide](https://hyperbits.com/stereo-imaging/)

### Audio Quality
- [MasteringBox - What is Clipping](https://www.masteringbox.com/learn/what-is-clipping)
- [Boyamic - Digital Clipping Guide](https://www.boyamic.com/blogs/the-ultimate-guide-to-fixing-digital-clipping)
- [Gig Performer - Audio Latency Explained](https://gigperformer.com/audio-latency-buffer-size-and-sample-rate-explained)
- [Focusrite - Sample Rate and Buffer Size](https://support.focusrite.com/hc/en-gb/articles/115004120965-Sample-Rate-Bit-Depth-and-Buffer-Size-Explained)

### Loudness Measurement
- [iZotope - What Are LUFS](https://www.izotope.com/en/learn/what-are-lufs)
- [Produce Like A Pro - LUFS vs dB](https://producelikeapro.com/blog/lufs-vs-db-explained/)
- [Wikipedia - LUFS](https://en.wikipedia.org/wiki/LUFS)
- [Wikipedia - dBFS](https://en.wikipedia.org/wiki/DBFS)

### ADSR & Synthesis
- [Native Instruments - ADSR Explained](https://blog.native-instruments.com/adsr-explained/)
- [MasterClass - ADSR Envelopes](https://www.masterclass.com/articles/adsr-envelope-explained)
- [EDMProd - ADSR Envelopes](https://www.edmprod.com/adsr-envelopes/)
- [WolfSound - Envelopes in Sound Synthesis](https://thewolfsound.com/envelopes/)

### Web Audio API
- [MDN - Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MDN - OscillatorNode](https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode)
- [MDN - BiquadFilterNode](https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode)
- [MDN - Autoplay Guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [MDN - AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet)
- [MDN - Web Audio API Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [W3C - Web Audio API 1.1 Specification](https://www.w3.org/TR/webaudio-1.1/)
- [Mozilla Hacks - High Performance Web Audio with AudioWorklet](https://hacks.mozilla.org/2020/05/high-performance-web-audio-with-audioworklet-in-firefox/)
- [Boris Smus - Web Audio API Book](https://webaudioapi.com/book/Web_Audio_API_Boris_Smus_html/ch01.html)

---

*Research compiled for the Keyboardia web-based musical instrument application.*
