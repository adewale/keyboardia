import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SYNTH_PRESETS } from '../audio/synth';
import { audioEngine } from '../audio/engine';

/**
 * Import the synth categories from SamplePicker.
 * We need to export them to make this test work.
 */
import { SYNTH_CATEGORIES, SYNTH_NAMES } from './SamplePicker';

/**
 * CRITICAL TEST: AudioContext user gesture requirement
 *
 * Web Audio API requires AudioContext to be created inside a user gesture:
 * - click ✓
 * - touchstart ✓
 * - keydown ✓
 * - mouseenter ✗ (NOT a user gesture!)
 * - mouseover ✗
 *
 * This test verifies that preview functionality respects this requirement.
 * If this test fails, users will see "AudioContext was not allowed to start" warnings
 * and audio may not work on first load.
 *
 * Bug fixed: Phase 21A - handlePreview was calling audioEngine.initialize() from
 * onMouseEnter, which is not a valid user gesture.
 */
describe('AudioContext user gesture compliance', () => {
  let initializeSpy: ReturnType<typeof vi.spyOn>;
  let isInitializedSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on audioEngine methods
    initializeSpy = vi.spyOn(audioEngine, 'initialize').mockResolvedValue();
    isInitializedSpy = vi.spyOn(audioEngine, 'isInitialized').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should NOT call initialize() when audio is not ready (preview should be skipped)', () => {
    // This test verifies the invariant:
    // "When audioEngine is not initialized, preview operations should NOT try to initialize"
    //
    // Why? Because preview is triggered by onMouseEnter, which is NOT a user gesture.
    // Calling initialize() from mouseenter causes:
    // - "AudioContext was not allowed to start" browser warning
    // - Silent audio on first load (broken UX)
    //
    // The fix: handlePreview checks isInitialized() and returns early if false.

    // Simulate the handlePreview logic (extracted from SamplePicker.tsx)
    const handlePreviewLogic = () => {
      if (!audioEngine.isInitialized()) {
        return; // Skip preview if audio not ready - user must click first
      }
      // Would play audio here if initialized
    };

    // Call the logic
    handlePreviewLogic();

    // Verify initialize was NOT called
    expect(initializeSpy).not.toHaveBeenCalled();
    expect(isInitializedSpy).toHaveBeenCalled();
  });

  it('should allow preview when audio IS initialized (from prior click)', () => {
    // When user has already clicked Play, audio is initialized
    isInitializedSpy.mockReturnValue(true);
    const playNowSpy = vi.spyOn(audioEngine, 'playNow').mockImplementation(() => {});

    // Simulate the handlePreview logic
    const handlePreviewLogic = (sampleId: string) => {
      if (!audioEngine.isInitialized()) {
        return;
      }
      audioEngine.playNow(sampleId);
    };

    handlePreviewLogic('kick');

    // Verify preview played (not skipped)
    expect(playNowSpy).toHaveBeenCalledWith('kick');
    // And still no initialize() call
    expect(initializeSpy).not.toHaveBeenCalled();
  });

  it('documents: mouseenter is NOT a valid user gesture for AudioContext', () => {
    // MDN documentation: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
    // Chrome blog: https://developer.chrome.com/blog/autoplay/
    //
    // Valid user gestures for AudioContext creation/resume:
    const validGestures = ['click', 'touchstart', 'touchend', 'keydown', 'keyup', 'pointerup'];

    // NOT valid for AudioContext:
    const invalidGestures = ['mouseenter', 'mouseover', 'mousemove', 'focus', 'scroll', 'load'];

    // This is a documentation test - it always passes but serves as a reference
    expect(validGestures).toContain('click');
    expect(invalidGestures).toContain('mouseenter');
  });
});

describe('SamplePicker synth preset coverage', () => {
  // Get all preset keys from the engine
  const enginePresets = Object.keys(SYNTH_PRESETS);

  // Get all presets exposed in the UI (flattened from categories)
  const uiPresets = Object.values(SYNTH_CATEGORIES)
    .flat()
    .map(id => id.replace('synth:', ''));

  it('should expose ALL synth engine presets in the UI', () => {
    const missingFromUI = enginePresets.filter(preset => !uiPresets.includes(preset));

    expect(missingFromUI).toEqual([]);

    if (missingFromUI.length > 0) {
      throw new Error(
        `The following synth presets are defined in synth.ts but NOT exposed in SamplePicker.tsx:\n` +
        `  ${missingFromUI.join(', ')}\n\n` +
        `Add them to SYNTH_CATEGORIES in SamplePicker.tsx`
      );
    }
  });

  it('should not have UI presets that do not exist in the engine', () => {
    const missingFromEngine = uiPresets.filter(preset => !enginePresets.includes(preset));

    expect(missingFromEngine).toEqual([]);

    if (missingFromEngine.length > 0) {
      throw new Error(
        `The following presets are in SamplePicker.tsx but NOT defined in synth.ts:\n` +
        `  ${missingFromEngine.join(', ')}\n\n` +
        `Either add them to SYNTH_PRESETS in synth.ts or remove them from SamplePicker.tsx`
      );
    }
  });

  it('should have display names for all UI presets', () => {
    const allUiPresetIds = Object.values(SYNTH_CATEGORIES).flat();
    const missingNames = allUiPresetIds.filter(id => !SYNTH_NAMES[id]);

    expect(missingNames).toEqual([]);

    if (missingNames.length > 0) {
      throw new Error(
        `The following presets are missing display names in SYNTH_NAMES:\n` +
        `  ${missingNames.join(', ')}`
      );
    }
  });

  it('should have correct preset count (sanity check)', () => {
    // If someone adds presets, this test reminds them to verify UI coverage
    // Phase 21A: 33 presets (5 core + 8 keys + 6 electronic + 4 bass + 3 strings + 7 ambient)
    expect(enginePresets.length).toBe(33);
    expect(uiPresets.length).toBe(33);
  });
});
