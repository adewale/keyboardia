/**
 * Client compatibility facade for runtime-neutral pattern operations.
 *
 * The implementation belongs in shared because Worker mutation handlers and
 * browser controls must perform exactly the same pure transformations.
 */

export * from '../shared/pattern-operations';
