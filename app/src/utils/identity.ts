/**
 * Phase 11: Anonymous Animal Identity System
 *
 * Google Docs-style anonymous identities for multiplayer presence.
 * 18 colors × 73 animals = 1,314 unique combinations
 */

// 18 distinct colors that work well on both light and dark backgrounds
export const IDENTITY_COLORS = [
  '#E53935', // Red
  '#D81B60', // Pink
  '#8E24AA', // Purple
  '#5E35B1', // Deep Purple
  '#3949AB', // Indigo
  '#1E88E5', // Blue
  '#039BE5', // Light Blue
  '#00ACC1', // Cyan
  '#00897B', // Teal
  '#43A047', // Green
  '#7CB342', // Light Green
  '#C0CA33', // Lime
  '#FDD835', // Yellow
  '#FFB300', // Amber
  '#FB8C00', // Orange
  '#F4511E', // Deep Orange
  '#6D4C41', // Brown
  '#757575', // Grey
] as const;

// 73 animals - friendly, recognizable, single-word names
export const IDENTITY_ANIMALS = [
  'Ant', 'Badger', 'Bat', 'Bear', 'Beaver', 'Bee', 'Bird', 'Bison',
  'Butterfly', 'Camel', 'Cat', 'Cheetah', 'Chicken', 'Crab', 'Crow',
  'Deer', 'Dog', 'Dolphin', 'Dove', 'Dragon', 'Duck', 'Eagle', 'Elephant',
  'Falcon', 'Fish', 'Flamingo', 'Fox', 'Frog', 'Giraffe', 'Goat',
  'Gorilla', 'Hamster', 'Hawk', 'Hedgehog', 'Hippo', 'Horse', 'Jaguar',
  'Kangaroo', 'Koala', 'Lemur', 'Leopard', 'Lion', 'Llama', 'Lobster',
  'Monkey', 'Moose', 'Mouse', 'Octopus', 'Otter', 'Owl', 'Panda',
  'Panther', 'Parrot', 'Peacock', 'Penguin', 'Pig', 'Puma', 'Rabbit',
  'Raccoon', 'Raven', 'Rhino', 'Seal', 'Shark', 'Sheep', 'Snake',
  'Spider', 'Squid', 'Swan', 'Tiger', 'Turtle', 'Whale', 'Wolf', 'Zebra',
] as const;

export type IdentityColor = typeof IDENTITY_COLORS[number];
export type IdentityAnimal = typeof IDENTITY_ANIMALS[number];

export interface PlayerIdentity {
  color: IdentityColor;
  colorIndex: number;
  animal: IdentityAnimal;
  name: string; // e.g., "Red Fox"
}

/**
 * Generate a deterministic identity from a player ID.
 * Same player ID always gets the same identity.
 */
export function getIdentityFromId(playerId: string): PlayerIdentity {
  // Simple hash function for deterministic results
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    const char = playerId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Use absolute value and modulo to get indices
  const absHash = Math.abs(hash);
  const colorIndex = absHash % IDENTITY_COLORS.length;
  const animalIndex = (absHash >> 8) % IDENTITY_ANIMALS.length;

  const color = IDENTITY_COLORS[colorIndex];
  const animal = IDENTITY_ANIMALS[animalIndex];

  // Get color name for display
  const colorNames = [
    'Red', 'Pink', 'Purple', 'Violet', 'Indigo', 'Blue', 'Sky', 'Cyan',
    'Teal', 'Green', 'Lime', 'Olive', 'Yellow', 'Amber', 'Orange', 'Coral',
    'Brown', 'Grey',
  ];
  const colorName = colorNames[colorIndex];

  return {
    color,
    colorIndex,
    animal,
    name: `${colorName} ${animal}`,
  };
}

/**
 * Get a short display name (just the animal)
 */
export function getShortName(identity: PlayerIdentity): string {
  return identity.animal;
}

/**
 * Get CSS variables for a player's identity color
 */
export function getIdentityStyles(identity: PlayerIdentity): React.CSSProperties {
  return {
    '--player-color': identity.color,
    '--player-color-light': `${identity.color}40`, // 25% opacity
    '--player-color-glow': `${identity.color}80`, // 50% opacity
  } as React.CSSProperties;
}
