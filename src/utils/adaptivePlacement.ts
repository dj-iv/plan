'use client';

// Adaptive antenna placement aiming for near-complete coverage (tolerance based)
// Works entirely in image pixel coordinates (caller must ensure consistent coord space)

interface Point { x: number; y: number; }

interface AdaptiveOptions {
  rangeInPixels: number;              // Antenna coverage radius in image pixels
  antennaRangeMeters: number;         // For dynamic max calculation
  scale: number;                      // meters per pixel
  exclusions: Point[][];              // Polygons to avoid placing antenna centers inside
  isPointInPolygon: (p: Point, poly: Point[]) => boolean;
  wallBuffer: number;                 // Minimum distance from outer polygon edge
  exclusionBuffer: number;            // Minimum distance from exclusion polygons
  tolerancePercent?: number;          // % of area allowed to remain uncovered (default 1%)
  cellSizePixelsCap?: number;         // Absolute max grid cell size (pixels) (optional)
  packingEfficiency?: number;         // Approx circle packing efficiency (default 0.65)
  safetyFactor?: number;              // Safety multiplier for dynamic max (default 1.25)
  edgePenaltyWeight?: number;         // Weight for edge proximity penalty (default 0.3)
  overlapPenaltyWeight?: number;      // Weight for overlap penalty (default 0.6)
  gridSpacingPercent?: number;        // Grid spacing as percentage (default 50)
  debug?: boolean;                    // Enable console diagnostics
}

interface PlacementResult { points: Point[]; coveragePercent: number; uncoveredCount: number; totalCells: number; }

// Basic helpers
function polygonArea(poly: Point[]): number {
  let sum = 0; for (let i=0;i<poly.length;i++){ const j=(i+1)%poly.length; sum += poly[i].x*poly[j].y - poly[j].x*poly[i].y; } return Math.abs(sum/2);
}
function pointToLineDistance(p: Point, a: Point, b: Point): number {
  const A = p.x - a.x, B = p.y - a.y, C = b.x - a.x, D = b.y - a.y; const dot = A*C + B*D; const lenSq = C*C + D*D; const t = lenSq? Math.max(0, Math.min(1, dot/lenSq)) : 0; const xx = a.x + t*C; const yy = a.y + t*D; const dx = p.x-xx, dy=p.y-yy; return Math.sqrt(dx*dx+dy*dy);
}
function minDistanceToPolygonEdges(p: Point, poly: Point[]): number { let min=Infinity; for (let i=0;i<poly.length;i++){ const a=poly[i], b=poly[(i+1)%poly.length]; const d=pointToLineDistance(p,a,b); if(d<min) min=d; } return min; }
function distance(a: Point,b: Point){ const dx=a.x-b.x, dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy); }

// Build coverage grid (returns centers of cells inside polygon and not inside exclusions)
function buildCoverageGrid(area: Point[], exclusions: Point[][], isInside:(p:Point, poly:Point[])=>boolean, cell: number): Point[] {
  let minX = Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity; for (const p of area){ if(p.x<minX) minX=p.x; if(p.x>maxX) maxX=p.x; if(p.y<minY) minY=p.y; if(p.y>maxY) maxY=p.y; }
  const pts: Point[] = [];
  for (let x = minX; x <= maxX; x += cell) {
    for (let y = minY; y <= maxY; y += cell) {
      const c = {x: x + cell/2, y: y + cell/2};
      if (!isInside(c, area)) continue;
      let excluded = false;
      for (const e of exclusions){ if (e.length>2 && isInside(c,e)){ excluded=true; break; } }
      if (!excluded) pts.push(c);
    }
  }
  return pts;
}

// Cluster uncovered cells using simple BFS grid-neighborhood (radius in cells ~2)
function clusterCells(cells: Point[], radius: number): Point[] { // returns centroids
  const centroids: Point[] = []; const used = new Set<number>(); const r2 = radius*radius;
  for (let i=0;i<cells.length;i++){
    if (used.has(i)) continue;
    const stack=[i]; used.add(i); let sx=0, sy=0, count=0;
    while(stack.length){ const idx = stack.pop()!; const c = cells[idx]; sx+=c.x; sy+=c.y; count++; for (let j=0;j<cells.length;j++){ if(used.has(j)) continue; const d = distance(c, cells[j]); if (d*d <= r2){ used.add(j); stack.push(j); } } }
    centroids.push({x: sx/count, y: sy/count});
  }
  return centroids;
}

export function adaptivePlacementForArea(area: Point[], opts: AdaptiveOptions): PlacementResult {
  const {
    rangeInPixels, antennaRangeMeters, scale, exclusions, isPointInPolygon,
    wallBuffer, exclusionBuffer, tolerancePercent=1, cellSizePixelsCap,
    packingEfficiency=0.65, safetyFactor=2.5, edgePenaltyWeight=0.3,
    overlapPenaltyWeight=0.6, debug=false,
    gridSpacingPercent = 50,
  } = opts;

  if (area.length < 3) return { points: [], coveragePercent: 0, uncoveredCount: 0, totalCells: 0 };

  const areaPx = polygonArea(area);
  const areaMeters = areaPx * scale * scale;
  const theoreticalMin = areaMeters / (Math.PI * antennaRangeMeters * antennaRangeMeters * packingEfficiency);
  const dynamicMax = Math.ceil(theoreticalMin * safetyFactor) || 1;

  // Cell size: at most range/3, optionally capped
  let cell = rangeInPixels / 3; if (cellSizePixelsCap) cell = Math.min(cell, cellSizePixelsCap); if (cell < 2) cell = 2;
  const gridCells = buildCoverageGrid(area, exclusions, isPointInPolygon, cell);
  const totalCells = gridCells.length;
  const uncovered = new Set<number>(); gridCells.forEach((_,i)=>uncovered.add(i));

  if (debug) console.log(`[ADAPT] AreaPx=${areaPx.toFixed(1)} cells=${totalCells} dynamicMax=${dynamicMax}`);

  // Candidate generation (initial grid spacing ~0.7R)
  const candidates: Point[] = [];
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity; for(const p of area){ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; }
  const spacing = rangeInPixels * (gridSpacingPercent / 100);
  for (let x=minX; x<=maxX; x+=spacing) {
    for (let y=minY; y<=maxY; y+=spacing) {
      const pt = {x,y};
      if(!isPointInPolygon(pt, area)) continue;
      // wall buffer
      if (minDistanceToPolygonEdges(pt, area) < wallBuffer) continue;
      // exclusions + exclusion buffer
      let bad=false; for (const ex of exclusions){ if (ex.length<3) continue; if (isPointInPolygon(pt, ex)) { bad=true; break; } if (minDistanceToPolygonEdges(pt, ex) < exclusionBuffer) { bad=true; break; } }
      if(!bad) candidates.push(pt);
    }
  }
  // Always add centroid as candidate
  const centroid = (() => { let cx=0,cy=0; for(const p of area){ cx+=p.x; cy+=p.y; } return {x:cx/area.length, y:cy/area.length}; })();
  if (isPointInPolygon(centroid, area)) candidates.push(centroid);

  const placed: Point[] = [];

  const coverCellsByPoint = (pt: Point) => {
    const r2 = rangeInPixels*rangeInPixels;
    for (let i=0;i<gridCells.length;i++) {
      if (!uncovered.has(i)) continue; const c = gridCells[i]; const dx=c.x-pt.x, dy=c.y-pt.y; if (dx*dx + dy*dy <= r2) uncovered.delete(i);
    }
  };

  const coverageGain = (pt: Point) => {
    let gain=0; const r2=rangeInPixels*rangeInPixels; const indices = Array.from(uncovered.values());
    for (let k=0;k<indices.length;k++){ const i = indices[k]; const c=gridCells[i]; const dx=c.x-pt.x, dy=c.y-pt.y; if (dx*dx+dy*dy<=r2) gain++; }
    return gain;
  };

  const scoreCandidate = (pt: Point) => {
    const gain = coverageGain(pt);
    if (gain===0) return -Infinity;
    // edge penalty
    const edgeDist = minDistanceToPolygonEdges(pt, area);
    const edgePenalty = (edgePenaltyWeight * (1 / (edgeDist + 1)) * rangeInPixels);
    // overlap penalty (count how many placed already cover same zone)
    let overlapPenalty = 0; for (const p of placed){ const d = distance(p, pt); if (d < rangeInPixels*0.8) overlapPenalty += (rangeInPixels*0.8 - d); }
    overlapPenalty *= overlapPenaltyWeight;
    return gain - edgePenalty - overlapPenalty;
  };

  const toleranceCells = totalCells * (tolerancePercent/100);
  let stagnation=0;

  while (uncovered.size > toleranceCells && placed.length < dynamicMax) {
    let best: Point | null = null; let bestScore = -Infinity; let bestIndex=-1; let bestGain=0;
    for (let i=0;i<candidates.length;i++) {
      const c = candidates[i];
      const score = scoreCandidate(c);
      if (score > bestScore) { bestScore = score; best = c; bestIndex=i; bestGain = coverageGain(c); }
    }
    if (!best || bestScore === -Infinity) break;
    if (bestGain < 1) { // stagnation detection
      stagnation++;
      candidates.splice(bestIndex,1);
      if (stagnation > 5) break; // can't improve
      continue;
    }
    stagnation = 0;
    placed.push(best);
    candidates.splice(bestIndex,1);
    coverCellsByPoint(best);
    if (debug) console.log(`[ADAPT] Placed ${placed.length} gain=${bestGain} uncovered=${uncovered.size}`);

    // Gap fill seeding every few placements
    if (placed.length % 3 === 0 && uncovered.size > toleranceCells) {
  const remainingCells: Point[] = [];
  const indices = Array.from(uncovered.values());
  for (let ii=0; ii<indices.length; ii++) remainingCells.push(gridCells[indices[ii]]);
      if (remainingCells.length) {
        const clusters = clusterCells(remainingCells, rangeInPixels*0.9);
        for (const cen of clusters.slice(0,3)) { // seed a few
          candidates.push(cen);
        }
      }
    }
  }

  const coveragePercent = totalCells === 0 ? 0 : ((totalCells - uncovered.size)/totalCells)*100;
  return { points: placed, coveragePercent, uncoveredCount: uncovered.size, totalCells };
}
