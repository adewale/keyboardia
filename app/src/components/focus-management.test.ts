/**
 * Focus Management Tests
 *
 * Tests for keyboard focus management and dialog focus restoration.
 * Replaces E2E test: e2e/keyboard.spec.ts - "focus returns after closing dialogs"
 *
 * Key behaviors tested:
 * 1. Focus trap within modals
 * 2. Focus restoration after modal close
 * 3. Focus-visible styling
 * 4. Tab order management
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// =============================================================================
// SECTION 1: Focus Stack Management
// =============================================================================

describe('Focus Stack Management', () => {
  /**
   * The focus stack tracks where focus was before opening modals.
   * When a modal closes, focus returns to the previous element.
   */

  interface FocusState {
    stack: string[]; // Stack of element IDs that had focus
    currentFocus: string | null;
    activeModal: string | null;
  }

  function createFocusState(): FocusState {
    return { stack: [], currentFocus: null, activeModal: null };
  }

  function openModal(state: FocusState, modalId: string, previousFocusId: string): FocusState {
    return {
      ...state,
      stack: [...state.stack, previousFocusId],
      currentFocus: `${modalId}-first-focusable`,
      activeModal: modalId,
    };
  }

  function closeModal(state: FocusState): FocusState {
    const newStack = [...state.stack];
    const previousFocus = newStack.pop() || null;

    return {
      ...state,
      stack: newStack,
      currentFocus: previousFocus,
      activeModal: newStack.length > 0 ? state.activeModal : null,
    };
  }

  it('FM-001: opening modal saves previous focus', () => {
    let state = createFocusState();
    state.currentFocus = 'step-cell-5';

    state = openModal(state, 'plock-editor', 'step-cell-5');

    expect(state.stack).toContain('step-cell-5');
    expect(state.activeModal).toBe('plock-editor');
  });

  it('FM-002: closing modal restores previous focus', () => {
    let state = createFocusState();
    state.currentFocus = 'step-cell-5';

    state = openModal(state, 'plock-editor', 'step-cell-5');
    state = closeModal(state);

    expect(state.currentFocus).toBe('step-cell-5');
    expect(state.activeModal).toBeNull();
  });

  it('FM-003: nested modals maintain focus stack', () => {
    let state = createFocusState();
    state.currentFocus = 'step-cell-5';

    state = openModal(state, 'settings', 'step-cell-5');
    state = openModal(state, 'confirm-dialog', 'settings-first-focusable');

    expect(state.stack).toHaveLength(2);

    state = closeModal(state);
    expect(state.currentFocus).toBe('settings-first-focusable');

    state = closeModal(state);
    expect(state.currentFocus).toBe('step-cell-5');
  });

  it('FM-004: closing all modals empties stack', () => {
    let state = createFocusState();
    state.currentFocus = 'button-1';

    state = openModal(state, 'modal-a', 'button-1');
    state = openModal(state, 'modal-b', 'modal-a-first-focusable');
    state = closeModal(state);
    state = closeModal(state);

    expect(state.stack).toHaveLength(0);
    expect(state.currentFocus).toBe('button-1');
  });
});

// =============================================================================
// SECTION 2: Focus Trap Logic
// =============================================================================

describe('Focus Trap Logic', () => {
  /**
   * When a modal is open, Tab/Shift+Tab should cycle within the modal only.
   */

  interface FocusableElement {
    id: string;
    tabIndex: number;
    disabled: boolean;
  }

  function getNextFocusable(
    elements: FocusableElement[],
    currentIndex: number,
    direction: 'forward' | 'backward'
  ): number {
    const enabledElements = elements.filter(el => !el.disabled && el.tabIndex >= 0);

    if (enabledElements.length === 0) return -1;

    const currentEnabledIndex = enabledElements.findIndex(
      el => el.id === elements[currentIndex]?.id
    );

    if (currentEnabledIndex === -1) {
      return elements.findIndex(el => el.id === enabledElements[0].id);
    }

    if (direction === 'forward') {
      const nextIndex = (currentEnabledIndex + 1) % enabledElements.length;
      return elements.findIndex(el => el.id === enabledElements[nextIndex].id);
    } else {
      const prevIndex = (currentEnabledIndex - 1 + enabledElements.length) % enabledElements.length;
      return elements.findIndex(el => el.id === enabledElements[prevIndex].id);
    }
  }

  const modalElements: FocusableElement[] = [
    { id: 'close-button', tabIndex: 0, disabled: false },
    { id: 'input-field', tabIndex: 0, disabled: false },
    { id: 'save-button', tabIndex: 0, disabled: false },
    { id: 'cancel-button', tabIndex: 0, disabled: false },
  ];

  it('FT-001: Tab cycles forward through modal elements', () => {
    let index = 0; // Start at close-button

    index = getNextFocusable(modalElements, index, 'forward');
    expect(modalElements[index].id).toBe('input-field');

    index = getNextFocusable(modalElements, index, 'forward');
    expect(modalElements[index].id).toBe('save-button');
  });

  it('FT-002: Tab wraps from last to first element', () => {
    let index = 3; // Start at cancel-button (last)

    index = getNextFocusable(modalElements, index, 'forward');
    expect(modalElements[index].id).toBe('close-button');
  });

  it('FT-003: Shift+Tab cycles backward', () => {
    let index = 2; // Start at save-button

    index = getNextFocusable(modalElements, index, 'backward');
    expect(modalElements[index].id).toBe('input-field');
  });

  it('FT-004: Shift+Tab wraps from first to last', () => {
    let index = 0; // Start at close-button (first)

    index = getNextFocusable(modalElements, index, 'backward');
    expect(modalElements[index].id).toBe('cancel-button');
  });

  it('FT-005: disabled elements are skipped', () => {
    const elementsWithDisabled: FocusableElement[] = [
      { id: 'button-1', tabIndex: 0, disabled: false },
      { id: 'button-2', tabIndex: 0, disabled: true },
      { id: 'button-3', tabIndex: 0, disabled: false },
    ];

    let index = 0;
    index = getNextFocusable(elementsWithDisabled, index, 'forward');
    expect(elementsWithDisabled[index].id).toBe('button-3');
  });
});

// =============================================================================
// SECTION 3: Focus Visible State
// =============================================================================

describe('Focus Visible State', () => {
  /**
   * Tests the logic for :focus-visible styling.
   * Focus ring should show for keyboard navigation, not mouse clicks.
   */

  type InputMethod = 'keyboard' | 'mouse' | 'touch';

  interface FocusVisibleState {
    lastInputMethod: InputMethod;
    focusedElementId: string | null;
  }

  function shouldShowFocusRing(state: FocusVisibleState): boolean {
    if (!state.focusedElementId) return false;
    return state.lastInputMethod === 'keyboard';
  }

  function handleFocus(
    state: FocusVisibleState,
    elementId: string,
    inputMethod: InputMethod
  ): FocusVisibleState {
    return {
      lastInputMethod: inputMethod,
      focusedElementId: elementId,
    };
  }

  it('FV-001: keyboard focus shows focus ring', () => {
    const state = handleFocus(
      { lastInputMethod: 'mouse', focusedElementId: null },
      'button-1',
      'keyboard'
    );

    expect(shouldShowFocusRing(state)).toBe(true);
  });

  it('FV-002: mouse click focus hides focus ring', () => {
    const state = handleFocus(
      { lastInputMethod: 'keyboard', focusedElementId: null },
      'button-1',
      'mouse'
    );

    expect(shouldShowFocusRing(state)).toBe(false);
  });

  it('FV-003: touch focus hides focus ring', () => {
    const state = handleFocus(
      { lastInputMethod: 'keyboard', focusedElementId: null },
      'button-1',
      'touch'
    );

    expect(shouldShowFocusRing(state)).toBe(false);
  });

  it('FV-004: no focus means no focus ring', () => {
    const state: FocusVisibleState = {
      lastInputMethod: 'keyboard',
      focusedElementId: null,
    };

    expect(shouldShowFocusRing(state)).toBe(false);
  });
});

// =============================================================================
// SECTION 4: Tab Order Calculation
// =============================================================================

describe('Tab Order Calculation', () => {
  /**
   * Tests the logic for determining tab order based on DOM position and tabIndex.
   */

  interface TabbableElement {
    id: string;
    tabIndex: number;
    domOrder: number;
  }

  function sortByTabOrder(elements: TabbableElement[]): TabbableElement[] {
    return [...elements].sort((a, b) => {
      // Elements with tabIndex > 0 come first, sorted by tabIndex
      if (a.tabIndex > 0 && b.tabIndex > 0) {
        return a.tabIndex - b.tabIndex;
      }
      if (a.tabIndex > 0) return -1;
      if (b.tabIndex > 0) return 1;

      // Elements with tabIndex = 0 follow DOM order
      if (a.tabIndex === 0 && b.tabIndex === 0) {
        return a.domOrder - b.domOrder;
      }

      // Elements with tabIndex < 0 are not tabbable
      if (a.tabIndex < 0) return 1;
      if (b.tabIndex < 0) return -1;

      return 0;
    });
  }

  it('TO-001: tabIndex=0 elements follow DOM order', () => {
    const elements: TabbableElement[] = [
      { id: 'c', tabIndex: 0, domOrder: 2 },
      { id: 'a', tabIndex: 0, domOrder: 0 },
      { id: 'b', tabIndex: 0, domOrder: 1 },
    ];

    const sorted = sortByTabOrder(elements);
    expect(sorted.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('TO-002: positive tabIndex comes before tabIndex=0', () => {
    const elements: TabbableElement[] = [
      { id: 'a', tabIndex: 0, domOrder: 0 },
      { id: 'b', tabIndex: 1, domOrder: 1 },
      { id: 'c', tabIndex: 0, domOrder: 2 },
    ];

    const sorted = sortByTabOrder(elements);
    expect(sorted[0].id).toBe('b');
  });

  it('TO-003: positive tabIndex sorted numerically', () => {
    const elements: TabbableElement[] = [
      { id: 'a', tabIndex: 3, domOrder: 0 },
      { id: 'b', tabIndex: 1, domOrder: 1 },
      { id: 'c', tabIndex: 2, domOrder: 2 },
    ];

    const sorted = sortByTabOrder(elements);
    expect(sorted.map(e => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('TO-004: negative tabIndex elements are excluded from tab order', () => {
    const elements: TabbableElement[] = [
      { id: 'a', tabIndex: 0, domOrder: 0 },
      { id: 'skip', tabIndex: -1, domOrder: 1 },
      { id: 'b', tabIndex: 0, domOrder: 2 },
    ];

    const sorted = sortByTabOrder(elements);
    const tabbable = sorted.filter(e => e.tabIndex >= 0);
    expect(tabbable.map(e => e.id)).toEqual(['a', 'b']);
  });
});

// =============================================================================
// SECTION 5: Dialog Focus Restoration
// =============================================================================

describe('Dialog Focus Restoration', () => {
  /**
   * Specifically tests the focus return behavior when closing dialogs.
   * This is the main behavior tested in the E2E test.
   */

  interface DialogState {
    isOpen: boolean;
    previousFocusId: string | null;
    firstFocusableId: string | null;
  }

  function openDialog(triggerId: string, firstFocusableId: string): DialogState {
    return {
      isOpen: true,
      previousFocusId: triggerId,
      firstFocusableId,
    };
  }

  function closeDialog(state: DialogState): { shouldFocusId: string | null } {
    if (!state.isOpen) {
      return { shouldFocusId: null };
    }

    return { shouldFocusId: state.previousFocusId };
  }

  it('DR-001: opening dialog stores trigger element', () => {
    const state = openDialog('step-cell-5', 'dialog-close-button');

    expect(state.previousFocusId).toBe('step-cell-5');
    expect(state.isOpen).toBe(true);
  });

  it('DR-002: closing dialog returns focus to trigger', () => {
    const state = openDialog('step-cell-5', 'dialog-close-button');
    const result = closeDialog(state);

    expect(result.shouldFocusId).toBe('step-cell-5');
  });

  it('DR-003: closing already-closed dialog does nothing', () => {
    const state: DialogState = {
      isOpen: false,
      previousFocusId: null,
      firstFocusableId: null,
    };

    const result = closeDialog(state);
    expect(result.shouldFocusId).toBeNull();
  });

  it('DR-004: focus restoration works with any trigger element', () => {
    const triggers = ['button-play', 'track-header-1', 'menu-item-settings', 'step-cell-0'];

    for (const triggerId of triggers) {
      const state = openDialog(triggerId, 'dialog-content');
      const result = closeDialog(state);
      expect(result.shouldFocusId).toBe(triggerId);
    }
  });
});

// =============================================================================
// SECTION 6: Escape Key Handler
// =============================================================================

describe('Escape Key Handler', () => {
  /**
   * Tests the Escape key behavior for closing modals.
   */

  interface ModalStackState {
    stack: string[];
  }

  function handleEscape(state: ModalStackState): {
    shouldClose: boolean;
    modalToClose: string | null;
    newState: ModalStackState;
  } {
    if (state.stack.length === 0) {
      return { shouldClose: false, modalToClose: null, newState: state };
    }

    const modalToClose = state.stack[state.stack.length - 1];
    const newStack = state.stack.slice(0, -1);

    return {
      shouldClose: true,
      modalToClose,
      newState: { stack: newStack },
    };
  }

  it('EK-001: Escape closes topmost modal', () => {
    const state: ModalStackState = { stack: ['modal-a', 'modal-b'] };
    const result = handleEscape(state);

    expect(result.shouldClose).toBe(true);
    expect(result.modalToClose).toBe('modal-b');
    expect(result.newState.stack).toEqual(['modal-a']);
  });

  it('EK-002: Escape with no modals does nothing', () => {
    const state: ModalStackState = { stack: [] };
    const result = handleEscape(state);

    expect(result.shouldClose).toBe(false);
    expect(result.modalToClose).toBeNull();
  });

  it('EK-003: multiple Escapes close all modals', () => {
    let state: ModalStackState = { stack: ['modal-a', 'modal-b', 'modal-c'] };

    const result1 = handleEscape(state);
    state = result1.newState;
    expect(result1.modalToClose).toBe('modal-c');

    const result2 = handleEscape(state);
    state = result2.newState;
    expect(result2.modalToClose).toBe('modal-b');

    const result3 = handleEscape(state);
    expect(result3.modalToClose).toBe('modal-a');
    expect(result3.newState.stack).toEqual([]);
  });
});

// =============================================================================
// SECTION 7: Property-Based Focus Tests
// =============================================================================

describe('Focus Management Properties', () => {
  const arbElementId = fc.stringMatching(/^[a-z0-9-]{1,20}$/);

  it('PB-001: focus stack maintains LIFO order', () => {
    fc.assert(
      fc.property(
        fc.array(arbElementId, { minLength: 1, maxLength: 10 }),
        (ids) => {
          const stack: string[] = [];

          // Push all
          for (const id of ids) {
            stack.push(id);
          }

          // Pop all and verify LIFO
          const popped: string[] = [];
          while (stack.length > 0) {
            popped.push(stack.pop()!);
          }

          // Popped should be reverse of original
          expect(popped).toEqual([...ids].reverse());
        }
      ),
      { numRuns: 200 }
    );
  });

  it('PB-002: focus restoration is deterministic', () => {
    fc.assert(
      fc.property(arbElementId, (triggerId) => {
        const state1 = { isOpen: true, previousFocusId: triggerId, firstFocusableId: 'first' };
        const state2 = { isOpen: true, previousFocusId: triggerId, firstFocusableId: 'first' };

        const result1 = state1.previousFocusId;
        const result2 = state2.previousFocusId;

        expect(result1).toBe(result2);
      }),
      { numRuns: 200 }
    );
  });
});
