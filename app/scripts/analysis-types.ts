/**
 * Shared types for post-fix analysis and bug capture tools
 */

/**
 * Configuration for running a post-fix analysis
 */
export interface AnalysisConfig {
  patterns: string[];
  riskyContexts: string[];
  excludePatterns: string[];
  symptom?: string;
  fixedFile?: string;
  bugId?: string;
  category?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * A single match found during analysis
 */
export interface FileMatch {
  file: string;
  line: number;
  content: string;
  context: string[];
  riskLevel: 'high' | 'medium' | 'low';
  matchedPattern: string;
  hasRiskyContext: boolean;
}

/**
 * Complete analysis report structure
 */
export interface AnalysisReport {
  timestamp: string;
  config: AnalysisConfig;
  matches: FileMatch[];
  summary: {
    totalFiles: number;
    totalMatches: number;
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    affectedDirectories: string[];
  };
  recommendations: string[];
}
