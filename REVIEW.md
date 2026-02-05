# Deep Project Review: Keyboardia

**Date:** 2026-02-05
**Reviewer:** Claude (automated deep review)
**Project Version:** 0.2.0

---

## Executive Summary

Keyboardia is a multiplayer web-based step sequencer for collaborative music production. It is a well-architected, heavily-tested application with a sophisticated real-time sync layer, a rich audio engine, and a clear separation of concerns. The codebase demonstrates strong engineering practices overall, with specific areas for improvement in component decomposition, error handling completeness, and test coverage breadth.

**Overall Assessment: Strong project with solid foundations.**

| Area                  | Rating      | Notes                                        |
|-----------------------|-------------|----------------------------------------------|
| Architecture          | Excellent   | Clean separation, clear module boundaries    |
| Code Quality          | Good        | Well-typed, consistent conventions           |
| Testing               | Good        | 4,244 tests pass; some UI coverage gaps      |
| Security              | Good        | CSP headers, input validation, XSS protection|
| Build & Tooling       | Excellent   | Modern stack, fast builds, good DX           |
| Documentation         | Excellent   | 60+ spec files, thorough inline comments     |

---

## 1. Architecture

### Tech Stack

- **Frontend:** React 19 + TypeScript 5.9 + Vite 7.2
- **Audio:** Web Audio API + Tone.js 15 (16-voice polyphonic synths, 21 sampled instruments, effects chain)
- **Backend:** Cloudflare Workers + Durable Objects (real-time WebSocket sessions) + KV + R2
- **Testing:** Vitest (unit), Playwright (e2e), fast-check (property-based)

### Module Organization

The codebase is well-organized into clear domains:

| Module         | Files | Purpose                                          |
|----------------|-------|--------------------------------------------------|
| `audio/`       | 60+   | Synthesis, scheduling, effects, sample management|
| `components/`  | 85+   | React UI components                              |
| `sync/`        | 20    | Multiplayer WebSocket protocol                   |
| `worker/`      | 26    | Cloudflare Worker backend                        |
| `state/`       | 4     | Redux-style state management                     |
| `hooks/`       | 15    | Custom React hooks                               |
| `shared/`      | 13    | Types & validation shared between client/worker  |

### Architecture Strengths

- **Shared mutation logic:** Client and server apply mutations through `delegateToApplyMutation` in `state/grid.tsx`, ensuring identical state transitions on both sides.
- **Three-tier action classification:** Actions are explicitly categorized as SYNCED, LOCAL_ONLY, or INTERNAL, preventing accidental network traffic for UI-only state.
- **Durable Objects for sessions:** Each live session gets its own DO with WebSocket coordination, providing strong consistency guarantees without a database.
- **Lookahead audio scheduling:** The scheduler uses a 25ms timer with 100ms lookahead buffer (`audio/scheduler.ts`), preventing audio glitches even under UI load.

---

## 2. Code Quality

### Strengths

- **TypeScript usage is rigorous.** Discriminated unions for all action types (`types.ts:123-180`), comprehensive interfaces for audio/sync state, and strict compiler options.
- **Consistent naming conventions.** Hooks use `use*`, handlers use `handle*`, booleans use `is*/has*`, with phase numbers in comments tracking architectural evolution.
- **Performance awareness.** Strategic `React.memo`, `useMemo`, and `useCallback` throughout. Manual chunk splitting for Tone.js (340KB gzipped) and React vendor bundles.
- **Defensive coding in sync layer.** Exponential backoff with jitter for reconnection, mutation tracking with delivery confirmation, canonical hash verification for state consistency.

### Issues

#### 2.1 Oversized Components

`components/TrackRow.tsx` is 1,097 lines. It handles pattern tools, velocity editing, parameter locks, drag-to-paint, pitch contours, and mobile editing. This makes it harder to test and reason about in isolation.

**Recommendation:** Extract focused sub-components (`TrackSteps`, `VelocityLane`, `PatternToolsRow`).

#### 2.2 Handler Callback Duplication (TrackRow.tsx:240-409)

Three nearly identical `useMemo` blocks generate per-step handler arrays with the same structure:

```typescript
const stepClickHandlers = useMemo(() => {
  const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
  return Array.from({ length: trackStepCount }, (_, i) => () => onToggleStep(i));
}, [track.stepCount, onToggleStep]);

// Same pattern repeated for stepSelectHandlers, stepPaintStartHandlers
```

**Recommendation:** Create a shared `createStepHandlers(count, callback)` factory.

#### 2.3 Lint Warning - setState in Effect

`components/PortraitGrid.tsx:71` calls `setActivePage` synchronously inside a `useEffect`, which triggers the `react-hooks/set-state-in-effect` lint warning. This causes cascading renders.

**Recommendation:** Derive `activePage` from `currentStep` and `isPlaying` instead of syncing via effect.

#### 2.4 Missing User-Facing Error Feedback

In `App.tsx:211-226`, the `handleShare` catch block logs the error but shows no toast to the user. Similar gaps exist in `handleRemix` and `handlePublish`. Compare with the fallback path on line 222 which correctly shows a toast.

**Recommendation:** Add user-facing error toasts in all async operation catch blocks.

#### 2.5 Build Warning - Large Chunk

The main `index` chunk is 566KB (166KB gzipped), exceeding Vite's 500KB warning threshold. The audio engine, state management, and sync code are bundled together.

**Recommendation:** Consider lazy-loading the audio engine and sync modules since they're not needed until a session loads.

---

## 3. Testing

### Current State

- **111 test files, 4,244 tests -- all passing**
- **Unit tests:** Comprehensive for audio, state, sync, validation, and worker modules
- **Property-based tests:** fast-check used for scheduler timing, canonical hashing, sync convergence
- **E2E tests:** 28 Playwright specs covering core flows, multiplayer, mobile, and visual regression
- **Integration tests:** Worker/Durable Object contract testing with mock WebSocket

### Test Quality Highlights

- `audio/scheduler.test.ts` -- thorough polyrhythm edge cases with clear test helpers
- `sync/multiplayer.test.ts` -- exponential backoff and reconnection tested with mocked timers
- `worker/session-api.test.ts` -- detailed request/response validation
- Chaos testing (`test/chaos/chaos.test.ts`) and connection storm tests (`e2e/connection-storm.spec.ts`)

### Coverage Gaps

**25 UI components lack unit tests**, including several critical ones:

| Component              | Risk   | Reason                              |
|------------------------|--------|-------------------------------------|
| `Transport.tsx`        | High   | Core playback controls              |
| `LandingPage.tsx`      | High   | First user-facing page              |
| `MixerPanel.tsx`       | Medium | Audio mixing interface              |
| `ParameterLockEditor`  | Medium | Advanced feature, complex UI state  |
| `PianoRoll.tsx`        | Medium | Musical interface                   |
| `ErrorBoundary.tsx`    | Medium | Error recovery behavior             |
| `Recorder.tsx`         | Medium | Microphone recording                |

**Recommendation:** Prioritize tests for `Transport.tsx` and `LandingPage.tsx` as they are high-traffic components. E2E tests partially cover these, but unit tests would catch regressions faster.

---

## 4. Security

### Strengths

- **Content Security Policy** is well-configured in `worker/index.ts:90-97`. Restricts scripts, connections, and frames appropriately. `blob:` is correctly allowed for Tone.js AudioWorklets.
- **Input validation** is thorough. `worker/validation.ts` validates session state, track data, effects, and session names with XSS pattern detection.
- **HTML escaping** in `worker/social-preview.ts:35-41` for Open Graph metadata.
- **Client-side sanitization** strips HTML tags from track names in `state/grid.tsx:378-388`.
- **Security headers** include `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and a restrictive `Permissions-Policy`.
- **Rate limiting** on session creation (100/min per IP).

### Items to Address

#### 4.1 Minimal .gitignore

The `.gitignore` only excludes `app/.wrangler/` and `app/test-output.mid`. Standard patterns for `.env`, `*.key`, `*.pem`, and IDE files are missing. While no secrets were found in the repo, this is a safety net that should exist.

**Recommendation:** Add standard secret/IDE exclusion patterns.

#### 4.2 No Production Error Tracking

`ErrorBoundary.tsx:44-47` has a TODO for integrating Sentry or similar. Errors are only logged to console, meaning production issues go undetected.

**Recommendation:** Integrate an error tracking service. Cloudflare Workers already emit wide events via the observability module; a similar approach for client-side errors would complete the picture.

#### 4.3 Rate Limit Note

`worker/index.ts:12` has a comment: "NOTE: Increased from 10 to 100 for integration testing. Revert after testing." This appears to still be at the testing value.

**Recommendation:** Evaluate whether 100 req/min is the intended production limit or if this should be reverted to 10.

#### 4.4 dangerouslySetInnerHTML Usage

One instance at `components/QROverlay/QRCode.tsx:95` using SVG from the `qrcode` library. This is safe (trusted source, not user input) but should have a comment explaining the safety rationale.

---

## 5. Build & Deployment

### Strengths

- **Build is clean:** `tsc -b && vite build` completes without errors.
- **Staging environment** is isolated with separate KV/R2 namespaces and its own domain (`staging.keyboardia.dev`).
- **Production deploy** uses a custom script (`scripts/deploy-production.ts`) with validation gates.
- **CI/CD** via GitHub Actions with Playwright in CI mode (retries, multiple workers).
- **Pre-commit hooks** via Husky + lint-staged for ESLint auto-fix on staged `.ts/.tsx` files.

### Build Output

| Asset                     | Size    | Gzipped  |
|---------------------------|---------|----------|
| `index.js` (main bundle) | 566 KB  | 166 KB   |
| `tone.js` (audio lib)    | 340 KB  | 81 KB    |
| `vendor-react.js`        | 11 KB   | 4 KB     |
| CSS total                 | 138 KB  | 25 KB    |

The main bundle could benefit from code-splitting the audio engine and sync modules.

---

## 6. Documentation

This is one of the project's strongest areas. The `specs/` directory contains 60+ documents covering architecture, sync protocol, audio engineering, testing strategy, UI philosophy, and more. Key documents:

- `specs/ARCHITECTURE.md` -- System design with ASCII diagrams
- `specs/MULTIPLAYER-RELIABILITY-SPEC.md` -- Sync guarantees and failure modes
- `specs/SYNTHESIS-ENGINE.md` -- Audio subsystem spec
- `docs/LESSONS-LEARNED.md` -- War stories and debugging patterns
- `CHANGELOG.md` -- Version history with clear categorization

Phase numbers in code comments (Phase 8 through Phase 34) trace the project's architectural evolution, making it easy to understand when and why decisions were made.

---

## 7. Summary of Recommendations

### High Priority

1. **Add user-facing error toasts** for failed async operations (share, remix, publish) in `App.tsx`
2. **Integrate production error tracking** (Sentry or equivalent) to replace the TODO in `ErrorBoundary.tsx:44`
3. **Review rate limit value** -- `worker/index.ts:12` may still be at testing level (100 vs intended 10)

### Medium Priority

4. **Expand .gitignore** with standard patterns for secrets, IDE files, and build artifacts
5. **Add unit tests** for `Transport.tsx`, `LandingPage.tsx`, and other untested critical components
6. **Extract TrackRow sub-components** to improve maintainability of the 1,097-line file
7. **Fix PortraitGrid lint warning** -- derive active page from state instead of syncing via effect
8. **Code-split the main bundle** -- lazy-load audio engine and sync modules to reduce initial load

### Low Priority

9. **Deduplicate handler creation** in `TrackRow.tsx` with a shared factory function
10. **Add npm audit** to CI pipeline for dependency vulnerability scanning
11. **Add safety comment** on `dangerouslySetInnerHTML` in `QRCode.tsx`
12. **Add bounds validation** for XY pad parameter mapping in `Transport.tsx` (decay value from Y coordinate)

---

*This review covers architecture, code quality, testing, security, build/deploy, and documentation. All 4,244 unit tests pass. Build compiles without errors. One lint warning exists in PortraitGrid.tsx.*
