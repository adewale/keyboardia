/**
 * Track utility functions - consolidated from duplicated patterns
 */

import type { Track, ParameterLock } from '../types';
import { MAX_STEPS } from '../types';

/**
 * Find a track by ID in an array of tracks
 * @param tracks Array of tracks to search
 * @param trackId The ID to find
 * @returns The track if found, undefined otherwise
 */
export function findTrackById(tracks: Track[], trackId: string): Track | undefined {
  return tracks.find(t => t.id === trackId);
}

/**
 * Create a new steps array initialized to false
 * @param length Length of the array (defaults to MAX_STEPS)
 * @returns Array of booleans initialized to false
 */
export function createStepsArray(length: number = MAX_STEPS): boolean[] {
  return Array(length).fill(false);
}

/**
 * Create a new parameter locks array initialized to null
 * @param length Length of the array (defaults to MAX_STEPS)
 * @returns Array of ParameterLock or null initialized to null
 */
export function createParameterLocksArray(length: number = MAX_STEPS): (ParameterLock | null)[] {
  return Array(length).fill(null);
}
