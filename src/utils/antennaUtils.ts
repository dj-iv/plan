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
  gridSpacingPercent?: number; // Grid spacing as percentage of antenna range (default 90%)
  canvasToImageScale?: number; // scaleX = image.width / canvasSize.width for coordinate conversion
  placementMode?: 'strategic' | 'adaptive' | 'coverage' | 'gap-first';
  tolerancePercent?: number; // for adaptive mode
}

export const WALL_BUFFER_FACTOR = 0.6;
const CORRIDOR_TOTAL_WIDTH_FACTOR = 1.2; // Allow corridors up to 1.2 * antenna radius wide
const CORRIDOR_AXIS_CLEARANCE_FACTOR = WALL_BUFFER_FACTOR;
const ADJUST_STEP_FACTOR = 0.2;
const ADJUST_MAX_RADIUS_FACTOR = 4;

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return Math.hypot(point.x - projX, point.y - projY);
}

function minDistanceToPolygonEdges(point: Point, polygon: Point[]): number {
  if (!polygon || polygon.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const d = pointToSegmentDistance(point, a, b);
    if (d < min) min = d;
  }
  return min;
}

function minDistanceToPolygons(point: Point, polygons: Point[][]): number {
  if (!polygons?.length) return Infinity;
  let min = Infinity;
  for (const poly of polygons) {
    if (!poly || poly.length < 2) continue;
    const d = minDistanceToPolygonEdges(point, poly);
    if (d < min) min = d;
  }
  return min;
}

function computeAxisClearances(point: Point, polygon: Point[]) {
  const clearances = { posX: Infinity, negX: Infinity, posY: Infinity, negY: Infinity };
  if (!polygon || polygon.length < 2) return clearances;
  const px = point.x;
  const py = point.y;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    // Horizontal scan (positive X / negative X)
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (maxY === minY) {
      // Horizontal edge - skip for axis-aligned scan to avoid double counting
    } else if (py >= minY && py <= maxY) {
      const t = (py - a.y) / (b.y - a.y);
      if (t >= 0 && t <= 1) {
        const ix = a.x + (b.x - a.x) * t;
        if (ix >= px) {
          const dist = ix - px;
          if (dist < clearances.posX) clearances.posX = dist;
        }
        if (ix <= px) {
          const dist = px - ix;
          if (dist < clearances.negX) clearances.negX = dist;
        }
      }
    }

    // Vertical scan (positive Y / negative Y)
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    if (maxX === minX) {
      // Vertical edge
    } else if (px >= minX && px <= maxX) {
      const t = (px - a.x) / (b.x - a.x);
      if (t >= 0 && t <= 1) {
        const iy = a.y + (b.y - a.y) * t;
        if (iy >= py) {
          const dist = iy - py;
          if (dist < clearances.posY) clearances.posY = dist;
        }
        if (iy <= py) {
          const dist = py - iy;
          if (dist < clearances.negY) clearances.negY = dist;
        }
      }
    }
  }
  return clearances;
}

interface CorridorInfo {
  isCorridor: boolean;
  axis: 'horizontal' | 'vertical' | null;
  clearances: ReturnType<typeof computeAxisClearances>;
}

function getCorridorInfo(point: Point, polygon: Point[], rangePx: number): CorridorInfo {
  if (!polygon || polygon.length < 3) {
    return {
      isCorridor: false,
      axis: null,
      clearances: computeAxisClearances(point, polygon)
    };
  }

  const bufferPx = rangePx * CORRIDOR_AXIS_CLEARANCE_FACTOR;
  const maxWidth = rangePx * CORRIDOR_TOTAL_WIDTH_FACTOR;
  const clearances = computeAxisClearances(point, polygon);

  const horizontalOk = isFinite(clearances.posX) && isFinite(clearances.negX)
    && clearances.posX > 0 && clearances.negX > 0
    && clearances.posX < bufferPx && clearances.negX < bufferPx
    && (clearances.posX + clearances.negX) <= maxWidth;

  const verticalOk = isFinite(clearances.posY) && isFinite(clearances.negY)
    && clearances.posY > 0 && clearances.negY > 0
    && clearances.posY < bufferPx && clearances.negY < bufferPx
    && (clearances.posY + clearances.negY) <= maxWidth;

  return {
    isCorridor: horizontalOk || verticalOk,
    axis: horizontalOk ? 'horizontal' : verticalOk ? 'vertical' : null,
    clearances
  };
}

function isInNarrowCorridor(point: Point, polygon: Point[], rangePx: number): boolean {
  return getCorridorInfo(point, polygon, rangePx).isCorridor;
}

interface EdgeInfo {
  distance: number;
  normal: { x: number; y: number };
}

function nearestEdgeInfo(point: Point, polygon: Point[]): EdgeInfo | null {
  if (!polygon || polygon.length < 2) return null;
  let bestDistance = Infinity;
  let bestVector: { x: number; y: number } | null = null;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = point.x - a.x;
    const apy = point.y - a.y;
    const abLenSq = abx * abx + aby * aby;
    let projX: number;
    let projY: number;

    if (abLenSq === 0) {
      projX = a.x;
      projY = a.y;
    } else {
      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
      projX = a.x + abx * t;
      projY = a.y + aby * t;
    }

    const dx = point.x - projX;
    const dy = point.y - projY;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestVector = { x: dx, y: dy };
    }
  }

  if (!isFinite(bestDistance) || !bestVector) return null;

  let nx = bestVector.x;
  let ny = bestVector.y;
  let len = Math.hypot(nx, ny);
  if (len < 1e-6) {
    const centroid = polygonCentroid(polygon);
    nx = point.x - centroid.x;
    ny = point.y - centroid.y;
    len = Math.hypot(nx, ny) || 1;
  }
  return {
    distance: bestDistance,
    normal: { x: nx / len, y: ny / len }
  };
}

function nearestEdgeInfoInPolygons(point: Point, polygons: Point[][]): EdgeInfo | null {
  if (!polygons?.length) return null;
  let best: EdgeInfo | null = null;
  for (const poly of polygons) {
    if (!poly || poly.length < 2) continue;
    const info = nearestEdgeInfo(point, poly);
    if (!info) continue;
    if (!best || info.distance < best.distance) {
      best = info;
    }
  }
  return best;
}

function polygonCentroid(polygon: Point[]): Point {
  let x = 0;
  let y = 0;
  let signedArea = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p0 = polygon[i];
    const p1 = polygon[(i + 1) % polygon.length];
    const a = p0.x * p1.y - p1.x * p0.y;
    signedArea += a;
    x += (p0.x + p1.x) * a;
    y += (p0.y + p1.y) * a;
  }
  signedArea *= 0.5;
  if (Math.abs(signedArea) < 1e-9) {
    // Fallback to average if polygon is degenerate
    const fallbackX = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
    const fallbackY = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length;
    return { x: fallbackX, y: fallbackY };
  }
  return { x: x / (6 * signedArea), y: y / (6 * signedArea) };
}

function isInsideAnyExclusion(point: Point, exclusions: Point[][], isPointInPolygon?: (p: Point, poly: Point[]) => boolean): boolean {
  if (!exclusions?.length || !isPointInPolygon) return false;
  return exclusions.some(poly => poly.length >= 3 && isPointInPolygon(point, poly));
}

function centerPointInCorridor(point: Point, info: CorridorInfo): Point {
  const centered = { ...point };
  if (!info.isCorridor || !info.axis) return centered;
  if (info.axis === 'horizontal') {
    const { posX, negX } = info.clearances;
    if (isFinite(posX) && isFinite(negX)) {
      const shift = (posX - negX) / 2;
      if (Math.abs(shift) > 0.5) {
        centered.x += shift;
      }
    }
  } else if (info.axis === 'vertical') {
    const { posY, negY } = info.clearances;
    if (isFinite(posY) && isFinite(negY)) {
      const shift = (posY - negY) / 2;
      if (Math.abs(shift) > 0.5) {
        centered.y += shift;
      }
    }
  }
  return centered;
}

export function isPlacementAllowed(
  point: Point,
  outerPolygon: Point[],
  exclusions: Point[][],
  rangePx: number,
  isPointInPolygon?: (p: Point, poly: Point[]) => boolean
): boolean {
  if (!outerPolygon || outerPolygon.length < 3) return false;
  if (isPointInPolygon && !isPointInPolygon(point, outerPolygon)) return false;
  if (isPointInPolygon && isInsideAnyExclusion(point, exclusions, isPointInPolygon)) return false;
  const wallBuffer = rangePx * WALL_BUFFER_FACTOR;
  const distToWall = minDistanceToPolygonEdges(point, outerPolygon);
  if (distToWall < wallBuffer && !isInNarrowCorridor(point, outerPolygon, rangePx)) {
    return false;
  }
  const exclusionBuffer = minDistanceToPolygons(point, exclusions || []);
  if (exclusionBuffer < wallBuffer) {
    return false;
  }
  return true;
}

export function findNearestAllowedPlacement(
  point: Point,
  outerPolygon: Point[],
  exclusions: Point[][],
  rangePx: number,
  isPointInPolygon: (pt: Point, poly: Point[]) => boolean,
  maxRadiusFactor: number = ADJUST_MAX_RADIUS_FACTOR
): Point | null {
  if (!outerPolygon || outerPolygon.length < 3) return null;
  if (!isPointInPolygon(point, outerPolygon)) return null;

  const centroid = polygonCentroid(outerPolygon);
  const wallBuffer = rangePx * WALL_BUFFER_FACTOR;
  let candidate: Point = { ...point };

  const maxIterations = 30;
  for (let iter = 0; iter < maxIterations; iter++) {
    if (!isPointInPolygon(candidate, outerPolygon)) {
      candidate = {
        x: candidate.x + (centroid.x - candidate.x) * 0.5,
        y: candidate.y + (centroid.y - candidate.y) * 0.5
      };
      continue;
    }

    let moved = false;
    const corridorInfo = getCorridorInfo(candidate, outerPolygon, rangePx);

    if (exclusions?.length) {
      const containing = exclusions.find(poly => poly.length >= 3 && isPointInPolygon(candidate, poly));
      if (containing) {
        const edgeInfo = nearestEdgeInfo(candidate, containing);
        if (edgeInfo) {
          const push = Math.max(wallBuffer - edgeInfo.distance + wallBuffer * 0.25, wallBuffer * 0.5);
          candidate = {
            x: candidate.x - edgeInfo.normal.x * push,
            y: candidate.y - edgeInfo.normal.y * push
          };
          moved = true;
          continue;
        }
      } else {
        const exclusionEdge = nearestEdgeInfoInPolygons(candidate, exclusions);
        if (exclusionEdge && exclusionEdge.distance < wallBuffer) {
          const push = wallBuffer - exclusionEdge.distance + Math.max(rangePx * 0.05, 1);
          candidate = {
            x: candidate.x + exclusionEdge.normal.x * push,
            y: candidate.y + exclusionEdge.normal.y * push
          };
          moved = true;
          continue;
        }
      }
    }

    if (corridorInfo.isCorridor) {
      const centered = centerPointInCorridor(candidate, corridorInfo);
      if (Math.hypot(centered.x - candidate.x, centered.y - candidate.y) > 0.5) {
        candidate = centered;
        moved = true;
        continue;
      }
    }

    if (!corridorInfo.isCorridor) {
      const wallEdge = nearestEdgeInfo(candidate, outerPolygon);
      if (wallEdge && wallEdge.distance < wallBuffer) {
        const push = wallBuffer - wallEdge.distance + Math.max(rangePx * 0.05, 1);
        candidate = {
          x: candidate.x + wallEdge.normal.x * push,
          y: candidate.y + wallEdge.normal.y * push
        };
        moved = true;
        continue;
      }
    }

    if (isPlacementAllowed(candidate, outerPolygon, exclusions, rangePx, isPointInPolygon)) {
      return candidate;
    }

    if (!moved) {
      candidate = {
        x: candidate.x + (centroid.x - candidate.x) * 0.35,
        y: candidate.y + (centroid.y - candidate.y) * 0.35
      };
    }
  }

  // Fall back to radial steps toward the centroid
  let dirX = centroid.x - candidate.x;
  let dirY = centroid.y - candidate.y;
  const len = Math.hypot(dirX, dirY) || 1;
  dirX /= len;
  dirY /= len;

  const step = Math.max(rangePx * ADJUST_STEP_FACTOR, 1);
  const maxDistance = rangePx * Math.max(maxRadiusFactor, 1);
  for (let dist = step; dist <= maxDistance; dist += step) {
    const fallback = { x: candidate.x + dirX * dist, y: candidate.y + dirY * dist };
    if (!isPointInPolygon(fallback, outerPolygon)) continue;
    if (isPlacementAllowed(fallback, outerPolygon, exclusions, rangePx, isPointInPolygon)) {
      return fallback;
    }
  }

  return isPlacementAllowed(candidate, outerPolygon, exclusions, rangePx, isPointInPolygon) ? candidate : null;
}


export function simpleAutoPlaceAntennas(options: AutoPlaceOptions): Antenna[] {
  const { savedAreas, scale, defaultAntennaRange, defaultAntennaPower, isPointInPolygon, exclusions = [], gridSpacingPercent, canvasToImageScale } = options;
  if (!savedAreas?.length || !scale || scale <= 0) return [];
  const rangeMeters = defaultAntennaRange || 6;
  const canvasScale = canvasToImageScale && canvasToImageScale > 0 ? (1 / canvasToImageScale) : 1;
  const rangePx = (rangeMeters / scale) * canvasScale;
  const wallBuffer = rangePx * WALL_BUFFER_FACTOR;
  const spacingPercentInput = gridSpacingPercent && gridSpacingPercent > 0
    ? gridSpacingPercent
    : 100;
  const spacingPercent = Math.max(20, Math.min(150, spacingPercentInput));
  const overlapPercent = 100 - spacingPercent; // positive => denser overlap, negative => gaps
  const spacingMultiplier = Math.max(0.3, Math.min(2.5, 1 - overlapPercent / 100));
  const desiredCenterSpacing = rangePx * 2 * spacingMultiplier;
  const minCenterSpacing = Math.max(rangePx * 0.4, desiredCenterSpacing);
  const centerSpacing = minCenterSpacing;
  const spacingTolerance = Math.min(rangePx * 0.02, minCenterSpacing * 0.05);
  const minSpacingThreshold = Math.max(0, minCenterSpacing - spacingTolerance);
  const minSpacingThresholdSq = minSpacingThreshold * minSpacingThreshold;
  const rowSpacing = minCenterSpacing * 0.8660254038; // sqrt(3)/2 for staggered rows (hex-like)
  console.log(`🧩 PLACEMENT (mode=${options.placementMode ?? 'coverage'}) range=${rangeMeters}m (${rangePx.toFixed(1)}px canvas, scale=${scale.toFixed(4)} m/px, image→canvas=${canvasScale.toFixed(3)}) spacingMultiplier=${spacingMultiplier.toFixed(2)} minCenterSpacingPx=${minCenterSpacing.toFixed(1)} overlap=${overlapPercent.toFixed(1)}%`);

  const keyFromCoords = (x: number, y: number) => `${Math.round(x * 100) / 100}:${Math.round(y * 100) / 100}`;
  const antennas: Antenna[] = [];
  const antennaKeys = new Set<string>();
  const placementMode = options.placementMode ?? 'coverage';
  const isSpacingAllowed = (point: Point): boolean => {
    for (const existing of antennas) {
      const dx = existing.position.x - point.x;
      const dy = existing.position.y - point.y;
      if (dx * dx + dy * dy < minSpacingThresholdSq) {
        return false;
      }
    }
    return true;
  };

  if (placementMode === 'gap-first') {
    savedAreas.forEach((poly, areaIdx) => {
      if (!poly || poly.length < 3) return;
      const minX = Math.min(...poly.map(p => p.x));
      const maxX = Math.max(...poly.map(p => p.x));
      const minY = Math.min(...poly.map(p => p.y));
      const maxY = Math.max(...poly.map(p => p.y));

      const areaAntennas: Antenna[] = [];
      for (let row = 0, y = minY + rowSpacing * 0.5; y <= maxY + rowSpacing; row++, y += rowSpacing) {
        const xOffset = (row % 2) * (centerSpacing * 0.5);
        for (let x = minX + xOffset; x <= maxX + centerSpacing; x += centerSpacing) {
          const pt = { x, y };
          if (!isPointInPolygon(pt, poly)) continue;
          let blocked = false;
          for (const ex of exclusions) {
            if (ex.length >= 3 && isPointInPolygon(pt, ex)) { blocked = true; break; }
          }
          if (blocked) continue;
          const adjusted = findNearestAllowedPlacement(pt, poly, exclusions, rangePx, isPointInPolygon);
          if (!adjusted) continue;
          if (!isSpacingAllowed(adjusted)) continue;
          const key = keyFromCoords(adjusted.x, adjusted.y);
          if (antennaKeys.has(key)) continue;
          const antenna: Antenna = {
            id: `grid-${areaIdx}-${areaAntennas.length}`,
            position: { x: adjusted.x, y: adjusted.y },
            range: rangeMeters,
            power: defaultAntennaPower
          };
          antennaKeys.add(key);
          antennas.push(antenna);
          areaAntennas.push(antenna);
        }
      }
      console.log(`🟩 GRID MODE: area ${areaIdx} seeds=${areaAntennas.length}`);

    });

    console.log(`🟩 GRID MODE: total antennas placed ${antennas.length}`);
    return antennas;
  }

  // Greedy coverage algorithm per area
  savedAreas.forEach((poly, areaIdx) => {
    if (!poly || poly.length < 3) return;
    const minX = Math.min(...poly.map(p=>p.x));
    const maxX = Math.max(...poly.map(p=>p.x));
    const minY = Math.min(...poly.map(p=>p.y));
    const maxY = Math.max(...poly.map(p=>p.y));

    // Build candidate grid
    const candidates: Point[] = [];
    const candidateKeys = new Set<string>();
    const roundedKey = (value: number) => Math.round(value * 100) / 100;
    for (let row = 0, y = minY + rowSpacing * 0.5; y <= maxY + rowSpacing; row++, y += rowSpacing) {
      const xOffset = (row % 2) * (centerSpacing * 0.5);
      for (let x = minX + xOffset; x <= maxX + centerSpacing; x += centerSpacing) {
        const pt = { x, y };
        if (!isPointInPolygon(pt, poly)) continue;
        let blocked = false;
        for (const ex of exclusions) {
          if (ex.length >=3 && isPointInPolygon(pt, ex)) { blocked = true; break; }
        }
  if (blocked) continue;
  const adjusted = findNearestAllowedPlacement(pt, poly, exclusions, rangePx, isPointInPolygon);
  if (!adjusted) continue;
  const key = `${roundedKey(adjusted.x)}:${roundedKey(adjusted.y)}`;
        if (candidateKeys.has(key)) continue;
        candidateKeys.add(key);
        candidates.push(adjusted);
      }
    }
    console.log(`🧩 Area ${areaIdx}: candidates=${candidates.length}`);
    if (!candidates.length) return;

    // Track uncovered indices
    const uncovered: number[] = candidates.map((_,i)=>i);

    // Precompute neighbor lists for efficiency (indices of candidates within coverage radius)
  const coverRadius = rangePx;
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
        const p = candidates[idx];
        if (!isSpacingAllowed(p)) {
          continue;
        }
        let gain = 0;
        for (const n of neighborMap[idx]) if (uncoveredSet.has(n)) gain++;
        if (gain > bestGain) { bestGain = gain; bestIdx = idx; }
      }
      if (bestIdx === -1) break;
      const p = candidates[bestIdx];
      const key = `${Math.round(p.x * 100) / 100}:${Math.round(p.y * 100) / 100}`;
      if (antennaKeys.has(key)) {
        for (const n of neighborMap[bestIdx]) uncoveredSet.delete(n);
        continue;
      }
      if (!isSpacingAllowed(p)) {
        uncoveredSet.delete(bestIdx);
        continue;
      }
      antennas.push({ id:`ant-${areaIdx}-${placedThisArea}`, position:{x:p.x,y:p.y}, range: rangeMeters, power: defaultAntennaPower });
      antennaKeys.add(key);
      const wallDist = minDistanceToPolygonEdges(p, poly);
      const corridorInfo = getCorridorInfo(p, poly, rangePx);
      if (wallDist < wallBuffer * 0.98 && !corridorInfo.isCorridor) {
        console.warn(`🧩 WARN: antenna ant-${areaIdx}-${placedThisArea} only ${(wallDist/wallBuffer*100).toFixed(1)}% of required wall buffer`);
      }
      placedThisArea++;
      for (const n of neighborMap[bestIdx]) uncoveredSet.delete(n);
      if (placedThisArea > 1000) { console.warn(`🧩 Area ${areaIdx}: safety stop at 1000 antennas`); break; }
    }
    console.log(`🧩 Area ${areaIdx}: placed ${placedThisArea} antennas (remaining uncovered=${Array.from(uncoveredSet).length})`);

  });
  console.log(`🧩 TOTAL antennas placed: ${antennas.length}`);
  return antennas;
}

// Provide default export for wildcard import fallbacks
const antennaUtils = { simpleAutoPlaceAntennas };
export default antennaUtils;
