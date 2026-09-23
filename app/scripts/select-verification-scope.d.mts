export interface VerificationImpactProfile {
  prefixes: string[];
  files: string[];
}

export interface VerificationImpactInventory {
  ignoredPrefixes: string[];
  ignoredFiles: string[];
  profiles: Record<string, VerificationImpactProfile>;
  selectAllFiles: string[];
}

export interface VerificationScope {
  paths: string[];
  selected: Record<string, boolean>;
  reasons: string[];
}

export function selectVerificationScope(
  paths: string[],
  inventory: VerificationImpactInventory,
): VerificationScope;

export function parseChangedPaths(nameStatusOutput: string): string[];
export function readChangedPaths(base: string, head: string, cwd?: string): string[];
