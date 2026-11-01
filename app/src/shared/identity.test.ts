/**
 * Anonymous player identities.
 *
 * Until the July 2026 audit this algorithm had no tests at all, and existed
 * twice: here, imported by nothing, and hand-copied into `live-session.ts`
 * under the comment "duplicated from utils/identity.ts for worker". The copy
 * was the one that shipped. They happened to agree — 0 mismatches over 20,000
 * ids — but nothing enforced it.
 *
 * The drift is not hypothetical, and the invariants below are chosen for it.
 * Both indices are `hash % list.length`, so appending one animal to one list
 * and not the other renames *every existing player* on that side. Two people
 * in the same session would then see different names for each other, and a
 * returning player would come back as somebody else. Determinism and stability
 * are the properties that matter; the list contents are what breaks them.
 */
import { describe, it, expect } from 'vitest';
import {
  IDENTITY_COLORS,
  IDENTITY_COLOR_NAMES,
  IDENTITY_ANIMALS,
  getIdentityFromId,
} from './identity';

/** Realistic ids: the worker passes through whatever the client requested. */
const SAMPLE_IDS = Array.from({ length: 500 }, (_, i) =>
  `player-${i}-${(i * 2654435761) % 99991}`,
);

describe('identity lists', () => {
  it('keeps colours and colour names index-aligned', () => {
    // `name` indexes IDENTITY_COLOR_NAMES with the colour index. If the two
    // lists ever differ in length, some players get `undefined Fox`.
    expect(IDENTITY_COLOR_NAMES).toHaveLength(IDENTITY_COLORS.length);
  });

  it('has no duplicate colours or animals', () => {
    // A duplicate silently halves the odds of a distinguishable identity and
    // makes two different players render identically.
    expect(new Set(IDENTITY_COLORS).size).toBe(IDENTITY_COLORS.length);
    expect(new Set(IDENTITY_ANIMALS).size).toBe(IDENTITY_ANIMALS.length);
    expect(new Set(IDENTITY_COLOR_NAMES).size).toBe(IDENTITY_COLOR_NAMES.length);
  });

  it('uses well-formed hex colours', () => {
    for (const colour of IDENTITY_COLORS) {
      expect(colour, `${colour} is not a 6-digit hex colour`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('documents 1,314 combinations and actually offers them', () => {
    // The module header promises 18 x 73. If someone extends one list, this
    // fails and they update the header — rather than the header rotting.
    expect(IDENTITY_COLORS.length).toBe(18);
    expect(IDENTITY_ANIMALS.length).toBe(73);
    expect(IDENTITY_COLORS.length * IDENTITY_ANIMALS.length).toBe(1314);
  });
});

describe('getIdentityFromId', () => {
  it('is deterministic', () => {
    // The whole point: a player who reconnects must be the same Red Fox. This
    // is also what makes the client and server agree without coordinating.
    for (const id of SAMPLE_IDS.slice(0, 50)) {
      expect(getIdentityFromId(id)).toEqual(getIdentityFromId(id));
    }
  });

  it('returns values drawn from the published lists', () => {
    for (const id of SAMPLE_IDS) {
      const identity = getIdentityFromId(id);
      expect(IDENTITY_COLORS, `colour for ${id}`).toContain(identity.color);
      expect(IDENTITY_ANIMALS, `animal for ${id}`).toContain(identity.animal);
      expect(identity.colorIndex).toBeGreaterThanOrEqual(0);
      expect(identity.colorIndex).toBeLessThan(IDENTITY_COLORS.length);
    }
  });

  it('builds the name from the colour name and animal, not the hex', () => {
    for (const id of SAMPLE_IDS.slice(0, 100)) {
      const { name, colorIndex, animal } = getIdentityFromId(id);
      expect(name).toBe(`${IDENTITY_COLOR_NAMES[colorIndex]} ${animal}`);
      expect(name, `"${name}" leaked a hex value`).not.toMatch(/#/);
      expect(name, `"${name}" has an undefined component`).not.toMatch(/undefined/);
    }
  });

  it('keeps colorIndex consistent with the colour it returned', () => {
    for (const id of SAMPLE_IDS) {
      const { color, colorIndex } = getIdentityFromId(id);
      expect(IDENTITY_COLORS[colorIndex]).toBe(color);
    }
  });

  it('spreads ids across the space rather than collapsing onto one identity', () => {
    // A hash that returns a constant satisfies every property above. This is
    // the witness that it does not: 500 ids should reach most of the 18
    // colours and a good share of the 73 animals.
    const colours = new Set(SAMPLE_IDS.map((id) => getIdentityFromId(id).color));
    const animals = new Set(SAMPLE_IDS.map((id) => getIdentityFromId(id).animal));

    expect(colours.size).toBeGreaterThan(IDENTITY_COLORS.length / 2);
    expect(animals.size).toBeGreaterThan(IDENTITY_ANIMALS.length / 2);
  });

  it('handles ids the transport can actually deliver', () => {
    // playerId comes off a query string, so it can be empty, unicode, or long.
    // A crash here takes down the connection handler, not just the name.
    for (const id of ['', 'a', '  ', '🦊', 'x'.repeat(4096), '../../etc/passwd']) {
      const identity = getIdentityFromId(id);
      expect(IDENTITY_ANIMALS, `animal for ${JSON.stringify(id.slice(0, 12))}`)
        .toContain(identity.animal);
      expect(identity.name).not.toMatch(/undefined|NaN/);
    }
  });

  it('gives different ids different identities often enough to be useful', () => {
    // Not a uniqueness guarantee — 1,314 combinations over 500 ids will
    // collide by the birthday bound. But near-total collision would mean the
    // hash is broken, and every player would look like the same person.
    const names = new Set(SAMPLE_IDS.map((id) => getIdentityFromId(id).name));
    expect(names.size).toBeGreaterThan(SAMPLE_IDS.length * 0.5);
  });
});
