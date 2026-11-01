# Shared Sample Recording (Archived)

> **Status:** Archived from Roadmap Phase 27 on December 2025
> **Reason:** Deprioritized - focus on core features first
> **Restore:** If needed, this spec can be moved back to the roadmap

---

## Overview

Allow multiplayer users to share recorded samples in real-time.

> **iOS Compatibility Note:** Before shipping, fix `recorder.ts` to use `MediaRecorder.isTypeSupported()` for codec detection. iOS/Safari produces MP4/AAC, not WebM/Opus. See `specs/research/IOS-CHROME-COMPATIBILITY.md` for details.

---

## Implementation Plan

### 1. Recording in Multiplayer Context

- Any player can record a sample
- Recording is uploaded to R2 with session-scoped key
- All players receive notification of new sample

### 2. R2 Upload Flow

```typescript
// Client records audio → converts to WAV/WebM
const audioBlob = await recorder.stop();

// Upload to R2 via Worker
const response = await fetch(`/api/sessions/${sessionId}/samples`, {
  method: 'POST',
  body: audioBlob,
  headers: { 'Content-Type': 'audio/webm' }
});

// Get sample URL back
const { sampleId, url } = await response.json();
```

### 3. Sample Storage Structure

```
R2 Bucket: keyboardia-samples
└── sessions/
    └── {sessionId}/
        └── {sampleId}.webm
```

### 4. Sync Recorded Samples

```typescript
// Durable Object broadcasts new sample to all clients
{ type: "sample_added", sampleId: "xxx", url: "...", addedBy: "player-1" }

// Clients fetch and decode the sample
const response = await fetch(url);
const buffer = await response.arrayBuffer();
const audioBuffer = await audioContext.decodeAudioData(buffer);
```

### 5. Sample Lifecycle

- Samples stored in R2 permanently (tied to session)
- Remixing a session copies sample references (not duplicates)
- Future: cleanup orphaned samples not referenced by any session

### 6. UI Considerations

- Show recording indicator when any player is recording
- Display who added each custom sample
- Loading state while samples sync

---

## Dependencies

| Dependency | Status |
|------------|--------|
| R2 bucket setup | Not started |
| Recorder.ts iOS fix | Not started |
| Durable Object sample sync | Not started |

---

## Outcome (When Implemented)

Multiple players can contribute custom recordings to a shared session. All players can use any recorded sample as an instrument.

---

## Related Documents

- `specs/research/IOS-CHROME-COMPATIBILITY.md` — iOS codec detection
- `app/src/audio/recorder.ts` — Current recording implementation (local only)
