# LRU Sample Cache with Reference Counting

## Overview

This specification describes an LRU (Least Recently Used) cache with reference counting for managing AudioBuffer samples in Keyboardia. The cache optimizes memory usage while ensuring that frequently-used samples remain available for immediate playback.

## Problem Statement

### Memory Constraints

A full sampled piano instrument (e.g., Salamander Grand) can have:
- 16 velocity layers x 88 notes = 1,408 samples
- Average sample size: ~200KB
- Total uncompressed: ~280MB

Loading all samples at once is impractical for:
- Mobile devices with limited memory
- Initial page load performance
- Multiple sampled instruments in a session

### Usage Patterns

1. **Localized playing**: Users typically play within a 2-3 octave range
2. **Track-based usage**: Each track uses one instrument at a time
3. **Session transitions**: When tracks change instruments, old samples may no longer be needed
4. **Playback vs live**: During playback, all notes in patterns need samples

## Design Goals

1. **Memory bounded**: Stay within configurable memory limits
2. **Fast access**: O(1) lookup for cached samples
3. **Smart eviction**: Reference counting prevents evicting in-use samples
4. **Predictable**: Clear behavior for cache hits, misses, and evictions
5. **Observable**: Metrics for debugging and optimization

## Architecture

### Data Structures

```
┌─────────────────────────────────────────────────────────────────┐
│                        LRUSampleCache                            │
├─────────────────────────────────────────────────────────────────┤
│  cache: Map<string, CacheEntry>     // Key → Entry lookup       │
│  lruList: DoublyLinkedList          // LRU ordering             │
│  refCounts: Map<string, number>     // Key → reference count    │
│  currentSize: number                // Current memory usage     │
│  maxSize: number                    // Maximum memory limit     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        CacheEntry                                │
├─────────────────────────────────────────────────────────────────┤
│  key: string                        // "piano:C4:v100"          │
│  buffer: AudioBuffer                // The actual audio data    │
│  size: number                       // Memory size in bytes     │
│  node: ListNode                     // Position in LRU list     │
│  createdAt: number                  // Timestamp                │
│  lastAccessedAt: number             // For metrics              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Format

Sample keys follow the pattern: `{instrument}:{note}:{velocity}`

Examples:
- `piano:C4:v100` - Piano, middle C, velocity 100
- `piano:A4:v64` - Piano, A440, medium velocity
- `strings:D3:v127` - Strings, D3, full velocity

### Operations

#### `get(key: string): AudioBuffer | null`

1. Look up key in cache map → O(1)
2. If found:
   - Move entry to head of LRU list → O(1)
   - Update lastAccessedAt
   - Return buffer
3. If not found:
   - Return null (caller responsible for loading)

#### `set(key: string, buffer: AudioBuffer): void`

1. Calculate buffer size (channels × length × 4 bytes)
2. If key exists, update and move to head
3. If new:
   - Evict if necessary (see Eviction)
   - Create new entry at head of LRU list
   - Update currentSize

#### `acquire(key: string): void`

Increment reference count for a key. Called when:
- A track starts using an instrument
- Playback begins with notes that need this sample

#### `release(key: string): void`

Decrement reference count. Called when:
- A track changes instruments
- Playback stops
- Track is deleted

### Eviction Strategy

When `currentSize + newEntrySize > maxSize`:

1. Start from tail of LRU list (least recently used)
2. For each candidate entry:
   - Skip if `refCounts.get(key) > 0` (in use)
   - Otherwise, evict:
     - Remove from cache map
     - Remove from LRU list
     - Subtract from currentSize
3. Repeat until enough space or no more evictable entries

**Critical invariant**: Never evict entries with refCount > 0

### Reference Counting Protocol

```typescript
// When a track uses an instrument:
cache.acquire("piano:C4:v100");
cache.acquire("piano:D4:v100");
// ... acquire all notes the track might play

// When track changes instrument:
cache.release("piano:C4:v100");
cache.release("piano:D4:v100");
// ... release all previous notes
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxSize` | 64MB | Maximum cache size in bytes |
| `defaultMaxSize` | 64MB | Default for most devices |
| `mobileMaxSize` | 32MB | Reduced for mobile |

### Size Calculation

```typescript
function getBufferSize(buffer: AudioBuffer): number {
  // 4 bytes per Float32 sample
  return buffer.numberOfChannels * buffer.length * 4;
}
```

## Integration Points

### 1. SampledInstrument

```typescript
class SampledInstrument {
  private cache: LRUSampleCache;

  async loadNote(note: string, velocity: number): Promise<AudioBuffer> {
    const key = `${this.id}:${note}:v${velocity}`;

    // Try cache first
    let buffer = this.cache.get(key);
    if (buffer) return buffer;

    // Load from network
    buffer = await this.fetchAndDecode(note, velocity);
    this.cache.set(key, buffer);
    return buffer;
  }

  // Called when track starts using this instrument
  async preloadRange(startNote: string, endNote: string): Promise<void> {
    // Acquire references for range
    for (const note of this.notesInRange(startNote, endNote)) {
      const key = `${this.id}:${note}:v64`;
      this.cache.acquire(key);
      await this.loadNote(note, 64); // Default velocity
    }
  }
}
```

### 2. Track Lifecycle

```typescript
// When track instrument changes
function handleInstrumentChange(track: Track, newInstrumentId: string): void {
  const oldInstrument = getInstrument(track.instrumentId);
  const newInstrument = getInstrument(newInstrumentId);

  // Release old instrument's samples
  if (oldInstrument instanceof SampledInstrument) {
    oldInstrument.releaseAllReferences();
  }

  // Acquire new instrument's samples
  if (newInstrument instanceof SampledInstrument) {
    newInstrument.preloadRange('C3', 'C5'); // Default range
  }
}
```

### 3. Playback Preparation

```typescript
// Before playback starts
async function preparePlayback(tracks: Track[]): Promise<void> {
  for (const track of tracks) {
    if (isSampledInstrument(track.instrumentId)) {
      const notes = extractNotesFromPattern(track);
      for (const note of notes) {
        cache.acquire(note.key);
        await loadIfNeeded(note.key);
      }
    }
  }
}
```

## Metrics and Observability

The cache exposes metrics for monitoring:

```typescript
interface CacheMetrics {
  hits: number;           // Successful cache lookups
  misses: number;         // Cache misses requiring load
  evictions: number;      // Items evicted
  currentSize: number;    // Current memory usage
  entryCount: number;     // Number of cached entries
  refCountedEntries: number; // Entries with refCount > 0
}
```

## Edge Cases

### 1. Cache Full, All Referenced

If all entries have refCount > 0 and cache is full:
- Log warning
- Allow temporary overage (up to 1.5x maxSize)
- Apply backpressure on new loads

### 2. Orphaned References

Track deletion should release references:
```typescript
function deleteTrack(trackId: string): void {
  const track = getTrack(trackId);
  releaseTrackReferences(track);
  // ... delete track
}
```

### 3. Rapid Instrument Switching

Debounce instrument changes to avoid thrashing:
```typescript
const debouncedInstrumentChange = debounce(
  handleInstrumentChange,
  300 // ms
);
```

## Testing Strategy

1. **Unit tests**: Cache operations, LRU ordering, eviction
2. **Integration tests**: With SampledInstrument
3. **Memory tests**: Verify size limits are respected
4. **Stress tests**: Rapid add/remove, concurrent access

## Implementation Checklist

- [ ] LRUSampleCache class
- [ ] CacheEntry type
- [ ] DoublyLinkedList for LRU ordering
- [ ] Reference counting methods
- [ ] Size-based eviction
- [ ] Metrics collection
- [ ] Integration with SampledInstrument
- [ ] Unit tests
- [ ] Integration tests

## References

- [Web Audio API AudioBuffer](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer)
- [LRU Cache Implementation Patterns](https://www.interviewcake.com/concept/java/lru-cache)
- [Memory Management in Web Audio](https://developer.chrome.com/blog/audio-scheduling/)
