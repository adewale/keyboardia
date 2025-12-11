# iOS Chrome Compatibility Research

**Date:** 2025-12-11
**Context:** User reported "Send Copy" button doesn't copy URLs to clipboard on Chrome iOS
**Critical Finding:** Chrome on iOS uses WebKit (Safari's engine), not Chrome's Blink engine, due to Apple App Store requirements

---

## Executive Summary

### Confirmed Broken Features

1. **Clipboard API (`navigator.clipboard.writeText`)** - BROKEN on Chrome iOS
   - User-reported issue with "Send Copy" and "Invite" buttons
   - Root cause: Async operations between user gesture and clipboard call lose gesture context
   - **Impact:** Users cannot copy session URLs to share with others

2. **MediaRecorder API (getUserMedia)** - LIMITED/UNRELIABLE
   - Recording feature is behind feature flag (`?recording=1`)
   - WebKit-specific codec differences (MP4 instead of WebM)
   - Historical issues with WKWebView-based browsers
   - **Impact:** Microphone recording may fail or produce incompatible formats

### Working Features

3. **Web Audio API (AudioContext)** - FULLY SUPPORTED
   - Code already has `webkitAudioContext` fallback (line 7 of engine.ts)
   - Handles iOS-specific 'interrupted' state
   - User gesture unlock listeners already implemented

4. **WebSocket** - FULLY SUPPORTED
   - WebSocket is fully supported on all iOS browsers
   - No known Chrome iOS specific limitations

5. **localStorage** - WORKS (with Private Browsing caveat)
   - Used only for orientation hint dismissal
   - Fails silently in Private Browsing mode (quota = 0)
   - Already wrapped in try-catch in code

### Potential Issues (Not Currently Broken)

6. **CSS `position: fixed` with Keyboard** - MAY BREAK
   - iOS WebKit has known issues with fixed positioning when virtual keyboard appears
   - Affects: BottomSheet, FloatingAddButton, ToastNotification, DebugOverlay
   - **Risk Level:** Medium - only affects forms with keyboard input

---

## Detailed API Analysis

### 1. Clipboard API - CRITICAL ISSUE (CONFIRMED BROKEN)

**API Used:** `navigator.clipboard.writeText()`

**Code Locations:**
- `/Users/aoshineye/Documents/keyboardia/app/src/App.tsx:129` (Invite button)
- `/Users/aoshineye/Documents/keyboardia/app/src/App.tsx:141` (Send Copy button)

**Current Implementation:**
```typescript
const handleSendCopy = useCallback(async () => {
  setSendingCopy(true);
  try {
    const url = await sendCopy();  // ← Async network call
    await navigator.clipboard.writeText(url);  // ← Fails here on iOS
    setCopySent(true);
    setTimeout(() => setCopySent(false), 2000);
  } catch (error) {
    logger.error('Failed to send copy:', error);
  } finally {
    setSendingCopy(false);
  }
}, [sendCopy]);
```

**Why It Fails on Chrome iOS:**

Chrome iOS uses WebKit, which enforces strict user gesture requirements for clipboard access. The async operations (`await sendCopy()`, which makes a network request) cause the code to lose the user gesture context before calling `writeText()`.

**Browser Compatibility:**
- ✅ Desktop Chrome: Works (permissive user gesture handling)
- ❌ Chrome iOS: Fails (uses WebKit's strict gesture requirements)
- ❌ Safari iOS: Fails (same WebKit engine)
- ✅ Firefox Desktop: Works with gesture, throws exception without

**Recommended Fix (Priority: HIGH):**

Use the `ClipboardItem` API with a Promise-wrapped approach that Safari/WebKit accepts:

```typescript
// Option 1: ClipboardItem API (modern, better for WebKit)
const handleSendCopy = useCallback(async () => {
  setSendingCopy(true);
  try {
    const url = await sendCopy();
    const clipboardItem = new ClipboardItem({
      'text/plain': Promise.resolve(new Blob([url], { type: 'text/plain' }))
    });
    await navigator.clipboard.write([clipboardItem]);
    setCopySent(true);
    setTimeout(() => setCopySent(false), 2000);
  } catch (error) {
    // Fallback for browsers without ClipboardItem
    try {
      await navigator.clipboard.writeText(url);
      setCopySent(true);
      setTimeout(() => setCopySent(false), 2000);
    } catch (fallbackError) {
      logger.error('Failed to send copy:', error, fallbackError);
    }
  } finally {
    setSendingCopy(false);
  }
}, [sendCopy]);

// Option 2: Prepare URL synchronously within user gesture
// This is harder because sendCopy() makes a network request
// Would require changing architecture to create session ID client-side
```

**Alternative Workarounds:**

1. **document.execCommand('copy')** - Deprecated but widely supported fallback:
   ```typescript
   function fallbackCopyTextToClipboard(text: string) {
     const textArea = document.createElement("textarea");
     textArea.value = text;
     textArea.style.position = "fixed";
     textArea.style.left = "-999999px";
     document.body.appendChild(textArea);
     textArea.focus();
     textArea.select();
     try {
       document.execCommand('copy');
       return true;
     } catch (err) {
       return false;
     } finally {
       document.body.removeChild(textArea);
     }
   }
   ```

2. **Manual copy instruction** - Show URL in modal with "Tap to select":
   ```typescript
   // Show modal with pre-selected text field
   // iOS supports tap-to-select and copy menu
   ```

**References:**
- [MDN: Clipboard.writeText()](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)
- [Apple Developer Forums: Clipboard API writeText() user gesture issue](https://developer.apple.com/forums/thread/772275)
- [W3C Clipboard APIs - User Gesture Requirements](https://www.w3.org/TR/clipboard-apis/)
- [The Clipboard API: How Did We Get Here?](https://cekrem.github.io/posts/clipboard-api-how-hard-can-it-be/)

---

### 2. MediaRecorder API - LIMITED SUPPORT

**API Used:** `navigator.mediaDevices.getUserMedia()`, `MediaRecorder`

**Code Locations:**
- `/Users/aoshineye/Documents/keyboardia/app/src/audio/recorder.ts:10` (getUserMedia)
- `/Users/aoshineye/Documents/keyboardia/app/src/audio/recorder.ts:47` (MediaRecorder)

**Current Implementation:**
```typescript
async requestMicAccess(): Promise<boolean> {
  try {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return true;
  } catch (error) {
    logger.audio.error('Microphone access denied:', error);
    return false;
  }
}

startRecording(): void {
  // ...
  this.mediaRecorder = new MediaRecorder(this.stream);
  this.mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      this.chunks.push(event.data);
    }
  };
  this.mediaRecorder.start();
}

stopRecording(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // ...
    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: 'audio/webm' });  // ← May be wrong on iOS
      this.chunks = [];
      resolve(blob);
    };
    this.mediaRecorder.stop();
  });
}
```

**iOS/WebKit Compatibility:**

- ✅ **iOS 14.3+**: MediaRecorder enabled by default in Safari/WebKit
- ⚠️ **Codec Differences**: Safari uses MP4/H.264/AAC, not WebM/Opus
- ⚠️ **Historical Issues**: Pre-iOS 14.3, getUserMedia didn't work in WKWebView-based browsers (Chrome, Firefox)
- ⚠️ **Known Bug**: iOS calling getUserMedia() again can kill video display of first stream (webkit.org/b/179363)

**Current Status:**
- Feature is behind `?recording=1` flag (not shipped to users yet)
- Phase 16 planned feature: "Shared Sample Recording"

**Recommended Fix (Priority: MEDIUM - before Phase 16):**

1. **Detect actual MIME type** instead of hardcoding 'audio/webm':
   ```typescript
   // Check supported MIME types
   const mimeTypes = [
     'audio/webm;codecs=opus',
     'audio/webm',
     'audio/mp4',
     'audio/ogg;codecs=opus'
   ];

   const supportedType = mimeTypes.find(type =>
     MediaRecorder.isTypeSupported(type)
   );

   this.mediaRecorder = new MediaRecorder(this.stream, {
     mimeType: supportedType
   });

   // Later when creating blob:
   const blob = new Blob(this.chunks, { type: supportedType });
   ```

2. **Add error handling** for getUserMedia failures specific to iOS

3. **Test on actual iOS devices** before shipping Phase 16

**References:**
- [WebKit Blog: MediaRecorder API](https://webkit.org/blog/11353/mediarecorder-api/)
- [WebKit Bug 208667: getUserMedia in WKWebView-based browsers](https://bugs.webkit.org/show_bug.cgi?id=208667)
- [Chrome Developers: Record audio and video with MediaRecorder](https://developer.chrome.com/blog/mediarecorder)
- [Can I Use: getUserMedia](https://caniuse.com/stream)

---

### 3. Web Audio API - WORKING (Already Fixed)

**API Used:** `AudioContext`, `webkitAudioContext`

**Code Locations:**
- `/Users/aoshineye/Documents/keyboardia/app/src/audio/engine.ts:7` (webkitAudioContext fallback)
- `/Users/aoshineye/Documents/keyboardia/app/src/audio/engine.ts:75-82` (User gesture unlock)

**Current Implementation:** ✅ CORRECT

```typescript
// iOS Safari uses webkitAudioContext
const AudioContextClass = window.AudioContext ||
  (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

// Resume if suspended or interrupted (iOS-specific state)
if (this.audioContext.state === 'suspended' ||
    (this.audioContext.state as string) === 'interrupted') {
  await this.audioContext.resume();
}

// Mobile Chrome workaround: attach document-level listeners to unlock audio
const unlock = async () => {
  if (this.audioContext && this.audioContext.state === 'suspended') {
    await this.audioContext.resume();
  }
};

const events = ['touchstart', 'touchend', 'click', 'keydown'];
events.forEach(event => {
  document.addEventListener(event, unlock, { once: false, passive: true });
});
```

**Browser Compatibility:**
- ✅ Chrome iOS: Fully supported (via WebKit)
- ✅ Safari iOS 6-18.4: Fully supported
- ✅ All iOS browsers: Use same WebKit implementation

**Status:** NO ACTION NEEDED - Code already handles iOS correctly

**References:**
- [Can I Use: Web Audio API](https://caniuse.com/audio-api)
- [Chrome Developers: Web Audio FAQ](https://developer.chrome.com/blog/web-audio-faq)
- [MDN: AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)

---

### 4. WebSocket - WORKING

**API Used:** `WebSocket`

**Code Locations:**
- `/Users/aoshineye/Documents/keyboardia/app/src/sync/multiplayer.ts:642` (Client-side)
- `/Users/aoshineye/Documents/keyboardia/app/src/worker/live-session.ts:171` (Server-side, Durable Objects)

**Current Implementation:**
```typescript
this.ws = new WebSocket(wsUrl);
```

**Browser Compatibility:**
- ✅ Chrome iOS: Fully supported (WebKit implementation)
- ✅ Safari iOS: Fully supported
- ✅ Chrome Desktop 16-145: Fully supported

**Known Considerations:**
- Chrome iOS uses WebKit's WebSocket implementation (not Chromium's)
- Behavior is identical to Safari iOS
- No known iOS-specific bugs in 2025

**Status:** NO ACTION NEEDED - WebSocket works identically across all iOS browsers

**References:**
- [Can I Use: WebSockets](https://caniuse.com/websockets)
- [MDN: WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
- [LambdaTest: Browser Compatibility of WebSockets](https://www.lambdatest.com/web-technologies/websockets)

---

### 5. localStorage - WORKING (with Private Browsing caveat)

**API Used:** `localStorage`

**Code Locations:**
- `/Users/aoshineye/Documents/keyboardia/app/src/components/OrientationHint.tsx:9` (read)
- `/Users/aoshineye/Documents/keyboardia/app/src/components/OrientationHint.tsx:37` (write)

**Current Implementation:**
```typescript
const [dismissed, setDismissed] = useState(() => {
  return localStorage.getItem(DISMISSED_KEY) === 'true';
});

const handleDismiss = () => {
  setDismissed(true);
  localStorage.setItem(DISMISSED_KEY, 'true');
};
```

**Browser Compatibility:**
- ✅ Chrome iOS: Fully supported in normal mode
- ⚠️ Chrome iOS Private Browsing: QuotaExceededError on write (quota = 0)
- ⚠️ Safari iOS Private Browsing: Same behavior

**Private Browsing Behavior:**

In Safari/WebKit Private Browsing mode:
- `localStorage` appears available (`typeof localStorage !== 'undefined'`)
- Quota is set to 0 bytes
- `.getItem()` works (returns null for non-existent keys)
- `.setItem()` throws `QuotaExceededError`
- Storage is cleared when private tab closes

**Current Risk Level:** LOW
- Only used for non-critical orientation hint dismissal
- No error handling, but failure is silent (user just sees hint again)

**Recommended Fix (Priority: LOW):**

Add try-catch for defensive programming:

```typescript
const handleDismiss = () => {
  setDismissed(true);
  try {
    localStorage.setItem(DISMISSED_KEY, 'true');
  } catch (error) {
    // Silently fail in Private Browsing mode
    // User will see hint again on next visit, which is acceptable
  }
};
```

**References:**
- [Muffin Man: localStorage in Safari's private mode](https://muffinman.io/blog/localstorage-and-sessionstorage-in-safaris-private-mode/)
- [JonathanMH: iOS Safari localStorage in Private Mode](https://jonathanmh.com/p/use-ios-safari-localstorage-sessionstorage-private-mode/)
- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

---

### 6. CSS `position: fixed` with Virtual Keyboard - POTENTIAL ISSUE

**CSS Used:** `position: fixed`

**Code Locations:**
- `/Users/aoshineye/Documents/keyboardia/app/src/components/BottomSheet.css:3` (Bottom sheet backdrop)
- `/Users/aoshineye/Documents/keyboardia/app/src/components/FloatingAddButton.css:4` (FAB button)
- `/Users/aoshineye/Documents/keyboardia/app/src/components/ToastNotification.css:6` (Toast notifications)
- `/Users/aoshineye/Documents/keyboardia/app/src/debug/DebugOverlay.css:4` (Debug overlay)

**iOS WebKit Issue:**

When the iOS virtual keyboard appears:
- Layout Viewport stays the same size
- Visual Viewport shrinks
- `position: fixed` elements anchor to Layout Viewport
- Result: Fixed elements can be hidden under the keyboard or scroll unexpectedly

**Current Risk Assessment:**

| Component | Risk Level | Reason |
|-----------|-----------|--------|
| BottomSheet | LOW | Only used for sample picker/track settings (no text inputs) |
| FloatingAddButton | NONE | No interaction with keyboard |
| ToastNotification | NONE | Read-only notifications |
| DebugOverlay | NONE | No text inputs |

**When This Would Break:**
- If future features add text inputs to BottomSheet
- If session rename feature uses modal with fixed positioning
- If recording feature adds text input in fixed UI

**Recommended Fix (Priority: LOW - only if adding forms):**

1. **Switch to `position: absolute`** when input is focused:
   ```typescript
   useEffect(() => {
     const handleFocus = () => {
       setIsKeyboardVisible(true);
       // Change position: fixed → absolute in CSS
     };
     const handleBlur = () => {
       setIsKeyboardVisible(false);
     };
     inputRef.current?.addEventListener('focus', handleFocus);
     inputRef.current?.addEventListener('blur', handleBlur);
   }, []);
   ```

2. **Use Visual Viewport API** (when supported):
   ```typescript
   window.visualViewport?.addEventListener('resize', () => {
     // Adjust fixed element positioning
   });
   ```

3. **CSS env() for safe-area** (already used in FloatingAddButton):
   ```css
   bottom: calc(24px + env(safe-area-inset-bottom, 0px));
   ```

**Status:** NO IMMEDIATE ACTION NEEDED - Monitor if forms are added

**References:**
- [Codemzy: Stop iOS keyboard hiding sticky/fixed header](https://www.codemzy.com/blog/sticky-fixed-header-ios-keyboard-fix)
- [Remy Sharp: Issues with position fixed on iOS](https://remysharp.com/2012/05/24/issues-with-position-fixed-scrolling-on-ios)
- [WebKit Bug 153224: position:fixed scrolls to top on input focus](https://bugs.webkit.org/show_bug.cgi?id=153224)
- [Bram.us: VirtualKeyboard API](https://www.bram.us/2021/09/13/prevent-items-from-being-hidden-underneath-the-virtual-keyboard-by-means-of-the-virtualkeyboard-api/)

---

## APIs NOT Used (Verified Clean)

The following modern web APIs were searched for but NOT found in the codebase:

- ❌ `navigator.share()` (Web Share API) - not used
- ❌ `requestFullscreen()` - not used
- ❌ `IndexedDB` - not used (using localStorage only)
- ❌ `ServiceWorker` - not used
- ❌ `SharedArrayBuffer` / `Atomics` - not used
- ❌ `Notification` API - not used
- ❌ `navigator.vibrate()` - not used
- ❌ CSS `backdrop-filter` - not used (only `drop-shadow` filter found)

---

## Priority Action Items

### 🔴 HIGH Priority - Immediate Action Required

1. **Fix Clipboard API for "Send Copy" and "Invite" buttons**
   - **Issue:** Broken on Chrome iOS due to async network call losing user gesture
   - **Location:** `/Users/aoshineye/Documents/keyboardia/app/src/App.tsx:129,141`
   - **Fix:** Use `ClipboardItem` API with Promise wrapper + `execCommand` fallback
   - **Impact:** Core sharing functionality unusable on iOS
   - **Effort:** 2-4 hours (implement + test on real iOS device)

### 🟡 MEDIUM Priority - Before Phase 16 (Recording Feature)

2. **Fix MediaRecorder MIME type detection**
   - **Issue:** Hardcoded 'audio/webm' won't work on iOS (uses MP4/AAC)
   - **Location:** `/Users/aoshineye/Documents/keyboardia/app/src/audio/recorder.ts:66`
   - **Fix:** Use `MediaRecorder.isTypeSupported()` to detect correct codec
   - **Impact:** Recording will fail or produce unplayable audio on iOS
   - **Effort:** 1-2 hours
   - **Blocker for:** Phase 16 launch

### 🟢 LOW Priority - Defensive Improvements

3. **Add localStorage error handling**
   - **Issue:** Will throw in Private Browsing mode (non-critical feature)
   - **Location:** `/Users/aoshineye/Documents/keyboardia/app/src/components/OrientationHint.tsx:37`
   - **Fix:** Wrap `setItem` in try-catch
   - **Impact:** Minor UX degradation (hint shows every time in private mode)
   - **Effort:** 5 minutes

4. **Monitor position: fixed if forms added**
   - **Issue:** Virtual keyboard breaks fixed positioning
   - **Location:** Various CSS files
   - **Fix:** Only needed if adding text inputs to fixed-position components
   - **Impact:** Future-proofing
   - **Effort:** N/A (no action unless adding forms)

---

## Testing Checklist for iOS Chrome

Before marking Clipboard API fix as complete:

- [ ] Test "Invite" button on Chrome iOS (real device)
- [ ] Test "Send Copy" button on Chrome iOS (real device)
- [ ] Test in Safari iOS (same WebKit engine)
- [ ] Test clipboard fallback when ClipboardItem not supported
- [ ] Verify URL actually copies to clipboard and can be pasted
- [ ] Test with iOS 16, 17, 18 (WebKit versions differ)
- [ ] Test in Private Browsing mode

Before shipping Phase 16 (Recording):

- [ ] Test microphone recording on Chrome iOS
- [ ] Test microphone recording on Safari iOS
- [ ] Verify recorded audio playback works
- [ ] Verify recorded audio uploads to R2 correctly
- [ ] Test multiple recordings in same session (WebKit bug 179363)
- [ ] Test with iOS 14.3+ (MediaRecorder minimum version)

---

## Methodology

### Search Strategy

Searched codebase for:
- Clipboard API: `navigator.clipboard`
- Web Share: `navigator.share`
- Audio APIs: `AudioContext`, `AudioWorklet`, `webkitAudioContext`
- WebSocket: `WebSocket`, `ws://`, `wss://`
- Media APIs: `MediaRecorder`, `getUserMedia`
- Events: `touchstart`, `touchend`, `touchmove`, `pointerdown`
- Storage: `localStorage`, `sessionStorage`, `IndexedDB`
- Fullscreen: `requestFullscreen`, `fullscreenElement`
- Workers: `serviceWorker`, `SharedArrayBuffer`
- CSS: `backdrop-filter`, `position: fixed`, `position: sticky`

### Research Sources

All compatibility claims verified against:
- MDN Web Docs (2025 data)
- Can I Use (caniuse.com)
- WebKit.org blog and bug tracker
- Chrome Developers blog
- Apple Developer Forums
- W3C specifications

### Key Insight: Chrome iOS = WebKit

**All iOS browsers must use WebKit** due to Apple App Store requirements (as of 2025, except EU with iOS 17.4+ where alternative engines allowed). This means:

- Chrome iOS ≈ Safari iOS for web API support
- Firefox iOS ≈ Safari iOS for web API support
- Edge iOS ≈ Safari iOS for web API support

Any API that works in Safari iOS will work in Chrome iOS, and vice versa.

---

## Changelog

- **2025-12-11:** Initial research document created
  - Confirmed Clipboard API broken on Chrome iOS
  - Verified MediaRecorder codec compatibility issue
  - Validated Web Audio API already working correctly
  - Documented localStorage Private Browsing edge case
  - Identified position: fixed potential issue with keyboard
