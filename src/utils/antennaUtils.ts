'use client';

// SENTINEL: Ensure this TS module is the one being bundled (watch for this message once per HMR load)
console.log('[antennaUtils.ts] Module loaded – using hex full coverage implementation');

// Basic interfaces
interface Point {
  x: number;
  y: number;
}

interface Antenna {
  id: string;
  position: {
    x: number;
    y: number;
  };
  range: number;
  power?: number;
}

interface AutoPlaceOptions {
  savedAreas: Point[][];
  scale: number;
  defaultAntennaRange: number;
  defaultAntennaPower: number;
  isPointInPolygon: (point: Point, polygon: Point[]) => boolean;
  exclusions?: Point[][];
  gridSpacingPercent?: number; // Grid spacing as percentage of antenna range (default 130%)
  canvasToImageScale?: number; // scaleX = image.width / canvasSize.width for coordinate conversion
  placementMode?: 'strategic' | 'adaptive';
  tolerancePercent?: number; // for adaptive mode
}

// Calculate distance between two points
function distance(p1: Point, p2: Point): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

// Calculate polygon area
function calculatePolygonArea(polygon: Point[]): number {
  let area = 0;
  const n = polygon.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  
  return Math.abs(area / 2);
}

// Find the centroid of a polygon
function findPolygonCentroid(polygon: Point[]): Point {
  const n = polygon.length;
  let centroidX = 0;
  let centroidY = 0;
  let signedArea = 0;
  
  for (let i = 0; i < n; i++) {
    const x0 = polygon[i].x;
    const y0 = polygon[i].y;
    const x1 = polygon[(i + 1) % n].x;
    const y1 = polygon[(i + 1) % n].y;
    
    const A = (x0 * y1) - (x1 * y0);
    signedArea += A;
    
    centroidX += (x0 + x1) * A;
    centroidY += (y0 + y1) * A;
  }
  
  signedArea *= 0.5;
  centroidX /= (6 * signedArea);
  centroidY /= (6 * signedArea);
  
  return { x: Math.abs(centroidX), y: Math.abs(centroidY) };
}

// Calculate the minimum distance from a point to any edge of the polygon
function distanceToPolygonEdge(point: Point, polygon: Point[]): number {
  let minDistance = Infinity;
  
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    const distance = pointToLineDistance(point, p1, p2);
    
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  
  return minDistance;
}

// Check if a point is safely inside the area (not in exclusions and respecting wall margin)
function isPointValid(
  point: Point, 
  area: Point[], 
  exclusions: Point[][],
  isPointInPolygon: (point: Point, polygon: Point[]) => boolean,
  safetyMargin = 0,
  wallMargin = 0
): boolean {
  // Check if point is inside the area with strict validation
  if (!isPointInPolygon(point, area)) {
    console.log(`Point (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) rejected: Outside area`);
    return false;
  }
  
  // VERY STRICT: Check if point is too close to walls (area boundaries)
  if (wallMargin > 0) {
    const distanceToWall = distanceToPolygonEdge(point, area);
    if (distanceToWall < wallMargin) {
      console.log(`Point (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) rejected: Too close to wall (${distanceToWall.toFixed(1)}px < ${wallMargin.toFixed(1)}px)`);
      return false;
    }
  }
  
  // ULTRA-STRICT EXCLUSION CHECK - Absolutely guaranteed avoidance of all exclusion zones
  for (let excIndex = 0; excIndex < exclusions.length; excIndex++) {
    const exclusion = exclusions[excIndex];
    
    // Skip invalid exclusions
    if (!exclusion || exclusion.length < 3) continue;
    
    // Basic check if point is inside exclusion - VERY IMPORTANT
    if (isPointInPolygon(point, exclusion)) {
      console.log(`Point (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) rejected: Inside exclusion zone ${excIndex}`);
      return false;
    }
    
    // ENHANCED: Always check distance to exclusion boundary with extremely strict safety margins
    const minDistanceToExclusion = getMinDistanceToPolygon(point, exclusion);
    if (minDistanceToExclusion < safetyMargin) {
      console.log(`Point (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) rejected: Too close to exclusion ${excIndex} (${minDistanceToExclusion.toFixed(1)}px < ${safetyMargin.toFixed(1)}px)`);
      return false;
    }
  }
  
  console.log(`Point (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) accepted`);
  return true;
}

// Get minimum distance from a point to any edge of a polygon
function getMinDistanceToPolygon(point: Point, polygon: Point[]): number {
  let minDistance = Infinity;
  
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    const dist = pointToLineDistance(point, p1, p2);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }
  
  return minDistance;
}

// Calculate the distance from a point to a line segment
function pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;

  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;

  return Math.sqrt(dx * dx + dy * dy);
}

// Strategic antenna placement algorithm - optimizes for coverage efficiency
function strategicAntennaPlacement(
  area: Point[], 
  rangeInPixels: number, 
  exclusions: Point[][], 
  isPointInPolygon: (point: Point, polygon: Point[]) => boolean,
  wallBuffer: number,
  exclusionBuffer: number
): Point[] {
  console.log(`🟡 STRATEGIC: Starting placement for area with ${area.length} points, range=${rangeInPixels.toFixed(1)}px`);
  
  // Calculate area bounds WITHOUT buffer for candidate generation (buffer applied in validation)
  const bounds = {
    minX: Math.min(...area.map(p => p.x)),
    maxX: Math.max(...area.map(p => p.x)),
    minY: Math.min(...area.map(p => p.y)),
    maxY: Math.max(...area.map(p => p.y))
  };
  
  console.log(`🟡 STRATEGIC: Raw bounds without buffer:`, bounds);
  
  // Helper function: Priority zones - areas further from edges get higher priority
  const getDistanceFromEdge = (point: Point): number => {
    let minDist = Infinity;
    for (let i = 0; i < area.length; i++) {
      const edge1 = area[i];
      const edge2 = area[(i + 1) % area.length];
      const dist = distanceFromPointToLine(point, edge1, edge2);
      minDist = Math.min(minDist, dist);
    }
    return minDist;
  };
  
  // Step 1: Generate candidate points with aggressive coverage-focused grid
  const gridSpacing = rangeInPixels * 0.4; // Very tight spacing for maximum coverage
  const candidates: Point[] = [];
  
  for (let x = bounds.minX; x <= bounds.maxX; x += gridSpacing) {
    for (let y = bounds.minY; y <= bounds.maxY; y += gridSpacing) {
      const point = { x, y };
      
      // STRICT VALIDATION: Only accept points that are well inside area and away from exclusions
      if (isPointInPolygon(point, area)) {
        // Check distance from walls (area boundary)
        const distToWall = getDistanceFromEdge(point);
        if (distToWall >= wallBuffer) {
          // Check distance from exclusions
          let validPoint = true;
          for (const excl of exclusions) {
            if (isPointInPolygon(point, excl)) {
              validPoint = false;
              break;
            }
            const distToExcl = getMinDistanceToPolygon(point, excl);
            if (distToExcl < exclusionBuffer) {
              validPoint = false;
              break;
            }
          }
          if (validPoint) {
            candidates.push(point);
          }
        }
      }
    }
  }
  
  console.log(`🟡 STRATEGIC: Generated ${candidates.length} candidates, selecting optimal positions...`);
  
  if (candidates.length === 0) {
    console.log(`🟡 STRATEGIC: No valid candidates found`);
    return [];
  }
  
  // Step 2: Strategic selection using coverage optimization
  const selectedAntennas: Point[] = [];
  const coveredAreas = new Set<string>(); // Track covered grid cells
  
  // Score function: higher score = better antenna position
  const scorePosition = (candidate: Point, existing: Point[]): number => {
    let score = 0;
    
    // 1. Moderately prefer positions away from edges (but don't be too restrictive)
    const edgeDistance = getDistanceFromEdge(candidate);
    
    // Give gentle preference to interior positions but don't heavily penalize edge positions
    score += edgeDistance * 0.5; // Reduced weight - allow edge placement for coverage
    
    // 2. Minimize overlap with existing antennas but allow reasonable density
    for (const antenna of existing) {
      const dist = distance(candidate, antenna);
      const minSpacing = rangeInPixels * 0.8; // Allow closer spacing for better coverage
      if (dist < minSpacing) {
        // Light penalty for being too close - prioritize coverage over spacing
        score -= (minSpacing - dist) * 2; 
      }
    }
    
    // 3. HEAVILY reward positions that provide new coverage (this is the priority)
    const coverageRadius = rangeInPixels / 10; // Very fine-grained coverage grid
    let newCoverage = 0;
    for (let dx = -rangeInPixels; dx <= rangeInPixels; dx += coverageRadius) {
      for (let dy = -rangeInPixels; dy <= rangeInPixels; dy += coverageRadius) {
        if (dx * dx + dy * dy <= rangeInPixels * rangeInPixels) {
          const coveragePoint = `${Math.round(candidate.x + dx)}_${Math.round(candidate.y + dy)}`;
          if (!coveredAreas.has(coveragePoint)) {
            newCoverage++;
          }
        }
      }
    }
    score += newCoverage * 2; // Strong reward for new coverage - this is the main goal
    
    return score;
  };
  
  // Greedy selection: prioritize coverage over everything else
  while (candidates.length > 0 && selectedAntennas.length < 25) { // Increased max to 25 antennas per area
    let bestCandidate = candidates[0];
    let bestScore = -Infinity;
    let bestIndex = 0;
    
    // Find the best remaining candidate
    for (let i = 0; i < candidates.length; i++) {
      const score = scorePosition(candidates[i], selectedAntennas);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidates[i];
        bestIndex = i;
      }
    }
    
    // Only stop if we really can't find any good positions
    if (bestScore < -50 && selectedAntennas.length > 5) {
      console.log(`🟡 STRATEGIC: Stopping - no more beneficial positions (score: ${bestScore.toFixed(1)})`);
      break;
    }
    
    // Add the best candidate
    selectedAntennas.push(bestCandidate);
    candidates.splice(bestIndex, 1); // Remove from candidates
    
    // Update covered areas with very fine granularity for accurate tracking
    const coverageRadius = rangeInPixels / 10;
    for (let dx = -rangeInPixels; dx <= rangeInPixels; dx += coverageRadius) {
      for (let dy = -rangeInPixels; dy <= rangeInPixels; dy += coverageRadius) {
        if (dx * dx + dy * dy <= rangeInPixels * rangeInPixels) {
          const coveragePoint = `${Math.round(bestCandidate.x + dx)}_${Math.round(bestCandidate.y + dy)}`;
          coveredAreas.add(coveragePoint);
        }
      }
    }
    
    console.log(`🟡 STRATEGIC: Selected ${selectedAntennas.length} antennas (score: ${bestScore.toFixed(1)})`);
  }
  
  console.log(`🟡 STRATEGIC: Final selection: ${selectedAntennas.length} antennas`);
  return selectedAntennas;
}

// Helper function: distance from point to line segment
function distanceFromPointToLine(point: Point, lineStart: Point, lineEnd: Point): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) {
    return Math.sqrt(A * A + B * B);
  }
  
  let param = dot / lenSq;
  
  if (param < 0) {
    param = 0;
  } else if (param > 1) {
    param = 1;
  }
  
  const xx = lineStart.x + param * C;
  const yy = lineStart.y + param * D;
  
  const dx = point.x - xx;
  const dy = point.y - yy;
  
  return Math.sqrt(dx * dx + dy * dy);
}
import { adaptivePlacementForArea } from './adaptivePlacement';

// Deterministic full-coverage hex tiling with fixed radius
function hexFullCoveragePlacement(area: Point[], rangePx: number, isPointInPolygon: (p:Point, poly:Point[])=>boolean, exclusions: Point[][]): Point[] {
  const results: Point[] = [];
  if (area.length < 3) return results;
  const minX = Math.min(...area.map(p=>p.x));
  const maxX = Math.max(...area.map(p=>p.x));
  const minY = Math.min(...area.map(p=>p.y));
  const maxY = Math.max(...area.map(p=>p.y));

  // Hex grid spacing: horizontal = r*sqrt(3), vertical = 1.5*r gives overlap (~13%) ensuring no gaps.
  const r = rangePx; // radius in pixels (fixed)
  const horiz = r * Math.sqrt(3) * 0.9; // slight reduction to increase overlap
  const vert = r * 1.5 * 0.9; // same overlap factor

  let row = 0;
  for (let y = minY - r; y <= maxY + r; y += vert, row++) {
    const xOffset = (row % 2 === 0) ? 0 : horiz / 2;
    for (let x = minX - r; x <= maxX + r; x += horiz) {
      const px = x + xOffset;
      const point = { x: px, y };
      // Quick reject: bounding box test already satisfied
      if (!isPointInPolygon(point, area)) continue;
      // Exclusions
      let blocked = false;
      for (const ex of exclusions) {
        if (ex.length >=3 && isPointInPolygon(point, ex)) { blocked = true; break; }
      }
      if (blocked) continue;
      results.push(point);
    }
  }
  return results;
}

export function simpleAutoPlaceAntennas(options: AutoPlaceOptions): Antenna[] {
  const { savedAreas, scale, defaultAntennaRange, defaultAntennaPower, isPointInPolygon, exclusions = [], gridSpacingPercent } = options;
  if (!savedAreas?.length || !scale || scale <= 0) return [];
  const rangeMeters = defaultAntennaRange || 6;
  const rangePx = rangeMeters / scale;
  const spacingFactor = (gridSpacingPercent && gridSpacingPercent > 0) ? (gridSpacingPercent/100) : 1.3; // default 130% of radius
  const sampleSpacing = rangePx * spacingFactor;
  console.log(`🧩 FULL COVERAGE (greedy) start range=${rangeMeters}m (${rangePx.toFixed(1)}px) spacingFactor=${spacingFactor.toFixed(2)}`);

  const antennas: Antenna[] = [];

  // Greedy coverage algorithm per area
  savedAreas.forEach((poly, areaIdx) => {
    if (!poly || poly.length < 3) return;
    const minX = Math.min(...poly.map(p=>p.x));
    const maxX = Math.max(...poly.map(p=>p.x));
    const minY = Math.min(...poly.map(p=>p.y));
    const maxY = Math.max(...poly.map(p=>p.y));

    // Build candidate grid
    const candidates: Point[] = [];
    for (let y = minY; y <= maxY; y += sampleSpacing) {
      for (let x = minX; x <= maxX; x += sampleSpacing) {
        const pt = { x, y };
        if (!isPointInPolygon(pt, poly)) continue;
        let blocked = false;
        for (const ex of exclusions) {
          if (ex.length >=3 && isPointInPolygon(pt, ex)) { blocked = true; break; }
        }
        if (!blocked) candidates.push(pt);
      }
    }
    console.log(`🧩 Area ${areaIdx}: candidates=${candidates.length}`);
    if (!candidates.length) return;

    // Track uncovered indices
    const uncovered: number[] = candidates.map((_,i)=>i);

    // Precompute neighbor lists for efficiency (indices of candidates within coverage radius)
    const coverRadius = rangePx * 0.98; // slight reduction to minimize excessive overlap
    const coverRadiusSq = coverRadius * coverRadius;
    const neighborMap: number[][] = new Array(candidates.length);
    for (let i=0;i<candidates.length;i++) {
      const ci = candidates[i];
      const neigh: number[] = [];
      for (let j=0;j<candidates.length;j++) {
        const cj = candidates[j];
        const dx = ci.x - cj.x; const dy = ci.y - cj.y;
        if (dx*dx + dy*dy <= coverRadiusSq) neigh.push(j);
      }
      neighborMap[i] = neigh;
    }

    // Greedy selection: each iteration pick candidate covering most uncovered points
    let placedThisArea = 0;
    const uncoveredSet = new Set(uncovered);
    while (uncoveredSet.size > 0) {
      let bestIdx = -1; let bestGain = -1;
      // Evaluate a subset (heuristic) if very large for performance
      const evalCandidates = uncoveredSet.size > 800 ? Array.from(uncoveredSet).filter((_,k)=> k % 3 === 0) : Array.from(uncoveredSet);
      for (const idx of evalCandidates) {
        let gain = 0;
        for (const n of neighborMap[idx]) if (uncoveredSet.has(n)) gain++;
        if (gain > bestGain) { bestGain = gain; bestIdx = idx; }
      }
      if (bestIdx === -1) break;
      const p = candidates[bestIdx];
      antennas.push({ id:`ant-${areaIdx}-${placedThisArea}`, position:{x:p.x,y:p.y}, range: rangeMeters, power: defaultAntennaPower });
      placedThisArea++;
      for (const n of neighborMap[bestIdx]) uncoveredSet.delete(n);
      if (placedThisArea > 1000) { console.warn(`🧩 Area ${areaIdx}: safety stop at 1000 antennas`); break; }
    }
    console.log(`🧩 Area ${areaIdx}: placed ${placedThisArea} antennas (remaining uncovered=${[...uncoveredSet].length})`);

    // Optional fine gap fill with tighter sampling if still uncovered (skip if large)
    if (placedThisArea < 200 && savedAreas.length === 1) {
      const gapAnts = fillCoverageGaps(antennas.filter(a=>a.id.startsWith(`ant-${areaIdx}-`)), poly, isPointInPolygon, exclusions, rangePx, rangeMeters, defaultAntennaPower).map((a,i)=> ({...a, id:`ant-gap-${areaIdx}-${i}`}));
      antennas.push(...gapAnts);
      if (gapAnts.length) console.log(`🧩 Area ${areaIdx}: gap fill added ${gapAnts.length} antennas`);
    }
  });
  console.log(`🧩 TOTAL antennas placed: ${antennas.length}`);
  return antennas;
}

// Provide default export for wildcard import fallbacks
export default { simpleAutoPlaceAntennas };

// Gap-filling function to ensure complete coverage
function fillCoverageGaps(
  existingAntennas: Antenna[],
  area: Point[],
  isPointInPolygon: (point: Point, polygon: Point[]) => boolean,
  exclusions: Point[][],
  rangeInPixels: number,
  antennaRangeMeters: number,
  defaultAntennaPower: number
): Antenna[] {
  console.log("🟦 GAP FILLING: Starting gap analysis");
  
  const gapAntennas: Antenna[] = [];
  const bounds = {
    minX: Math.min(...area.map(p => p.x)),
    maxX: Math.max(...area.map(p => p.x)),
    minY: Math.min(...area.map(p => p.y)),
    maxY: Math.max(...area.map(p => p.y))
  };
  
  // Create a fine sampling grid to detect gaps
  const sampleSpacing = rangeInPixels * 0.4; // Fine sampling
  const cols = Math.ceil((bounds.maxX - bounds.minX) / sampleSpacing);
  const rows = Math.ceil((bounds.maxY - bounds.minY) / sampleSpacing);
  
  console.log(`🟦 GAP FILLING: Scanning ${cols}x${rows} sample points`);
  
  let uncoveredPoints: Point[] = [];
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = bounds.minX + (col * sampleSpacing);
      const y = bounds.minY + (row * sampleSpacing);
      const point = { x, y };
      
      // Must be in area
      if (!isPointInPolygon(point, area)) continue;
      
      // Must not be in exclusion
      let inExclusion = false;
      for (const exclusion of exclusions) {
        if (exclusion.length >= 3 && isPointInPolygon(point, exclusion)) {
          inExclusion = true;
          break;
        }
      }
      if (inExclusion) continue;
      
      // Check if covered by any existing antenna
      let covered = false;
      for (const antenna of existingAntennas) {
        const distance = Math.sqrt(
          Math.pow(antenna.position.x - x, 2) + Math.pow(antenna.position.y - y, 2)
        );
        if (distance <= rangeInPixels * 0.95) { // 95% coverage requirement
          covered = true;
          break;
        }
      }
      
      if (!covered) {
        uncoveredPoints.push(point);
      }
    }
  }
  
  console.log(`🟦 GAP FILLING: Found ${uncoveredPoints.length} uncovered points`);
  
  // Cluster uncovered points and place antennas at cluster centers
  while (uncoveredPoints.length > 0) {
    // Find the point that would cover the most uncovered points
    let bestPoint: Point | null = null;
    let bestCoverage = 0;
    let bestCoveredIndices: number[] = [];
    
    for (const candidate of uncoveredPoints) {
      const coveredIndices: number[] = [];
      for (let i = 0; i < uncoveredPoints.length; i++) {
        const distance = Math.sqrt(
          Math.pow(candidate.x - uncoveredPoints[i].x, 2) + 
          Math.pow(candidate.y - uncoveredPoints[i].y, 2)
        );
        if (distance <= rangeInPixels * 0.8) { // 80% range for placement optimization
          coveredIndices.push(i);
        }
      }
      
      if (coveredIndices.length > bestCoverage) {
        bestPoint = candidate;
        bestCoverage = coveredIndices.length;
        bestCoveredIndices = coveredIndices;
      }
    }
    
    if (bestPoint && bestCoverage > 0) {
      // Place antenna at best point
      gapAntennas.push({
        id: `gap-antenna-${gapAntennas.length + 1}`,
        position: { x: bestPoint.x, y: bestPoint.y },
        range: antennaRangeMeters,
        power: defaultAntennaPower
      });
      
      // Remove covered points from uncovered list (in reverse order to maintain indices)
      bestCoveredIndices.sort((a, b) => b - a).forEach(index => {
        uncoveredPoints.splice(index, 1);
      });
      
      console.log(`🟦 GAP FILLING: Placed antenna at (${bestPoint.x.toFixed(1)}, ${bestPoint.y.toFixed(1)}), covered ${bestCoverage} points`);
    } else {
      // No good placement found, break to avoid infinite loop
      break;
    }
    
    // Safety limit
    if (gapAntennas.length > 50) {
      console.log("🟦 GAP FILLING: Reached safety limit of 50 gap antennas");
      break;
    }
  }
  
  console.log(`🟦 GAP FILLING: Added ${gapAntennas.length} gap-filling antennas`);
  return gapAntennas;
}

// Helper function to cluster uncovered points to identify coverage gaps
function clusterUncoveredPoints(points: Point[], clusterRadius: number): {centroid: Point, points: Point[]}[] {
  if (points.length === 0) return [];
  
  const clusters: {centroid: Point, points: Point[]}[] = [];
  const assigned = new Set<number>();
  
  for (let i = 0; i < points.length; i++) {
    if (assigned.has(i)) continue;
    
    // Start a new cluster
    const clusterPoints: Point[] = [points[i]];
    let sumX = points[i].x;
    let sumY = points[i].y;
    assigned.add(i);
    
    // Find all points that belong to this cluster
    for (let j = 0; j < points.length; j++) {
      if (i === j || assigned.has(j)) continue;
      
      if (distance(points[i], points[j]) <= clusterRadius) {
        clusterPoints.push(points[j]);
        sumX += points[j].x;
        sumY += points[j].y;
        assigned.add(j);
      }
    }
    
    // Calculate centroid
    const centroid = {
      x: sumX / clusterPoints.length,
      y: sumY / clusterPoints.length
    };
    
    clusters.push({
      centroid,
      points: clusterPoints
    });
  }
  
  return clusters;
}

// Helper function to find bounding box of a polygon
function findBoundingBox(polygon: Point[]) {
  if (!polygon || polygon.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  
  let minX = polygon[0].x;
  let minY = polygon[0].y;
  let maxX = polygon[0].x;
  let maxY = polygon[0].y;
  
  for (const point of polygon) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  
  return { minX, minY, maxX, maxY };
}

// Calculate the distance from a point to a line segment using raw coordinates
function distanceToLineSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;

  return Math.sqrt(dx * dx + dy * dy);
}
