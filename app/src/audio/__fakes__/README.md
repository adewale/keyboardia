# Test Fakes

Purpose-built test doubles for the audio engine's heavy collaborator
classes. Use these in new tests instead of `vi.mock(...)`.

## Why fakes over framework mocks

From the testing-best-practices skill: prefer real objects → purpose-built
fakes → deterministic stubs → framework mocks (last resort). Fakes win
over `vi.mock` for three reasons:

1. **Compile-time surface check.** Each fake ends with a line like
   `const _surfaceCheck: ToneSynthManagerSurface = new FakeToneSynthManager();`
   that fails to type-check if a method is renamed on the real class.
   `vi.mock` has no equivalent — drift goes undetected until production.
2. **Typed recorders.** `fake.playNoteCalls[0].volume` is type-safe.
   `mock.calls[0][4]` is `unknown`.
3. **Reusable across tests.** A fake instance can be configured once
   in a fixture; every `vi.mock` block is per-file boilerplate.

## Available fakes

| File | Class faked |
|---|---|
| `FakeToneSynthManager.ts` | `src/audio/toneSynths.ts:ToneSynthManager` |
| `FakeAdvancedSynthEngine.ts` | `src/audio/advancedSynth.ts:AdvancedSynthEngine` |

## Usage

```ts
import { FakeToneSynthManager } from './__fakes__/FakeToneSynthManager';

it('plays a note via the manager', async () => {
  const fake = new FakeToneSynthManager();
  await fake.initialize();
  // Inject the fake wherever the system-under-test would have the real one.
  fake.playNote('fm-bass', 'C4', '8n', 0.5, 0.8);
  expect(fake.playNoteCalls).toHaveLength(1);
  expect(fake.playNoteCalls[0].volume).toBe(0.8); // typed
});
```

## When you must keep using vi.mock

Some tests construct an `AudioEngine` directly and mock its imports
(`vi.mock('./toneSynths', ...)`). Those tests continue to work; the
runtime `mock-fidelity.test.ts` guards them against rename-drift. New
tests should prefer the fakes wherever possible.

## Adding a new fake

1. Create `Fake<RealClass>.ts` next to the existing fakes.
2. Define `type <RealClass>Surface = Pick<RealClass, 'method1' | 'method2' | ...>`.
3. Implement the class with `implements <RealClass>Surface`.
4. Add `const _surfaceCheck: <RealClass>Surface = new Fake<RealClass>();`
   at the bottom — this is the compile-time fidelity guard.
5. Add a sanity test in `fakes.test.ts` exercising the recorders.
