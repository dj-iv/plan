'use client';

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

export function simpleAutoPlaceAntennas(options: AutoPlaceOptions): Antenna[] {
  const { savedAreas, scale, defaultAntennaRange, defaultAntennaPower, isPointInPolygon, exclusions = [], gridSpacingPercent = 130, canvasToImageScale = 1, placementMode = 'strategic', tolerancePercent = 1 } = options;
  
  console.log("🔴 SMART ANTENNA PLACEMENT ALGORITHM WITH EXCLUSION AVOIDANCE");
  console.log("🔴 Areas:", savedAreas.length);
  console.log("🔴 Scale:", scale);
  console.log("🔴 Default Range:", defaultAntennaRange);
  console.log("🔴 Canvas to Image Scale:", canvasToImageScale);
  console.log("🔴 Exclusions received:", exclusions.length);
  
  // CRITICAL DEBUG: Log each exclusion zone in detail
  exclusions.forEach((exclusion, i) => {
    console.log(`🔴 Exclusion ${i}:`, {
      points: exclusion.length,
      coordinates: exclusion.map(p => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`),
      bounds: exclusion.length > 0 ? {
        minX: Math.min(...exclusion.map(p => p.x)).toFixed(1),
        maxX: Math.max(...exclusion.map(p => p.x)).toFixed(1),
        minY: Math.min(...exclusion.map(p => p.y)).toFixed(1),
        maxY: Math.max(...exclusion.map(p => p.y)).toFixed(1)
      } : 'no points'
    });
  });
  
  if (exclusions.length === 0) {
    console.log("🔴 WARNING: NO EXCLUSION ZONES DETECTED - antennas will not avoid any areas!");
  }
  
  const antennas: Antenna[] = [];
  
  try {
    if (!savedAreas || savedAreas.length === 0) {
      console.error("🔴 No areas provided for antenna placement");
      return [];
    }
    
    if (!scale || scale <= 0) {
      console.error("🔴 Invalid scale for antenna placement");
      return [];
    }
    
    const antennaRangeMeters = defaultAntennaRange || 6;
    const rangeInPixels = antennaRangeMeters / scale;
    
    console.log(`🔴 Using range: ${antennaRangeMeters}m = ${rangeInPixels.toFixed(2)} pixels`);
    
    // WALL-LIKE EXCLUSION AVOIDANCE - Treat exclusions like walls
    // Antennas cannot be placed inside, but coverage can extend into exclusion zones
    const exclusionBuffer = 15; // Reduced buffer to allow closer antenna placement
    const wallBuffer = 60; // Significantly reduced wall buffer - allow antennas closer to edges
    
    console.log(`🔴 WALL-LIKE buffers: exclusion=${exclusionBuffer.toFixed(1)}px (keep antennas out), wall=${wallBuffer.toFixed(1)}px`);

  savedAreas.forEach((area, areaIndex) => {
      if (area.length < 3) {
        console.log(`🔴 Skipping area ${areaIndex} - insufficient points`);
        return;
      }
      
      console.log(`🔴 Processing Area ${areaIndex} with ${area.length} points`);
      
      // Get area boundaries
      const bounds = {
        minX: Math.min(...area.map(p => p.x)),
        maxX: Math.max(...area.map(p => p.x)),
        minY: Math.min(...area.map(p => p.y)),
        maxY: Math.max(...area.map(p => p.y))
      };
      
      const areaWidth = bounds.maxX - bounds.minX;
      const areaHeight = bounds.maxY - bounds.minY;
      
      console.log(`🔴 Area ${areaIndex}: ${areaWidth.toFixed(1)} x ${areaHeight.toFixed(1)} pixels`);
      console.log(`🔴 Area ${areaIndex} bounds:`, bounds);
      
      // Create a much smaller safe zone deep inside the area
      const safeZone = {
        minX: bounds.minX + wallBuffer,
        maxX: bounds.maxX - wallBuffer,
        minY: bounds.minY + wallBuffer,
        maxY: bounds.maxY - wallBuffer
      };
      
      // Skip if safe zone is too small
      if (safeZone.minX >= safeZone.maxX || safeZone.minY >= safeZone.maxY) {
        console.log(`🔴 Area ${areaIndex}: Safe zone too small - skipping`);
        return;
      }
      
      const safeWidth = safeZone.maxX - safeZone.minX;
      const safeHeight = safeZone.maxY - safeZone.minY;
      
      console.log(`🔴 Area ${areaIndex}: Safe zone ${safeWidth.toFixed(1)} x ${safeHeight.toFixed(1)} pixels`);
      
      if (placementMode === 'adaptive') {
        console.log(`🟢 ADAPTIVE: Starting adaptive placement for area ${areaIndex}`);
        const result = adaptivePlacementForArea(area, {
          rangeInPixels: rangeInPixels,
            antennaRangeMeters: antennaRangeMeters,
            scale,
            exclusions,
            isPointInPolygon,
            wallBuffer,
            exclusionBuffer,
            tolerancePercent,
            debug: false
        });
        const areaAntennas: Antenna[] = result.points.map((pos, index) => ({
          id: `antenna-${antennas.length + index + 1}`,
          position: { x: pos.x, y: pos.y },
          range: antennaRangeMeters,
          power: defaultAntennaPower
        }));
        antennas.push(...areaAntennas);
        console.log(`🟢 ADAPTIVE: Area ${areaIndex} antennas=${areaAntennas.length} coverage=${result.coveragePercent.toFixed(2)}% uncoveredCells=${result.uncoveredCount}/${result.totalCells}`);
      } else {
        // Use existing strategic algorithm
        console.log(`🟡 STRATEGIC: Switching to strategic placement for area ${areaIndex}`);
        const strategicPositions = strategicAntennaPlacement(
          area,
          rangeInPixels,
          exclusions,
          isPointInPolygon,
          wallBuffer,
          exclusionBuffer
        );
        const areaAntennas: Antenna[] = strategicPositions.map((pos, index) => ({
          id: `antenna-${antennas.length + index + 1}`,
          position: { x: pos.x, y: pos.y },
          range: antennaRangeMeters,
          power: defaultAntennaPower
        }));
        antennas.push(...areaAntennas);
        console.log(`🔴 Area ${areaIndex}: Final result: ${areaAntennas.length} antennas placed`);
      }
    });
    
    console.log(`🔴 SMART PLACEMENT COMPLETE: ${antennas.length} total antennas`);
    return antennas;
    
  } catch (error) {
    console.error("🔴 Error in simpleAutoPlaceAntennas:", error);
    return [];
  }
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
