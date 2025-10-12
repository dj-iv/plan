export interface CoverageReport {
  coveragePercent: number;
  uncoveredSamples: number;
  sampleCount: number;
  antennaCount: number;
  targetPercent: number;
  theoreticalMin: number;
  baselineCount: number;
  overlapPercent: number;
  solver: 'greedy' | 'adaptive' | 'hybrid';
  fallbackApplied: boolean;
  alternativeApplied: boolean;
}

export interface CoverageDebugInfo {
  sampleStep: number;
  candidateCount: number;
  hardCap: number;
  iterations: number;
  placements?: Array<{
    id: string;
    x: number;
    y: number;
    areaIdx: number;
    edgeDistance: number;
    seed?: boolean;
  }>;
  uncoveredSamples?: Array<{
    x: number;
    y: number;
    areaIdx: number;
  }>;
  aiNotes?: string;
}
