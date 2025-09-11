// Full coverage antenna placement (deterministic hex + gap fill)
// No 'use client' here so it can be imported normally in client components.

export interface Point { x: number; y: number; }
export interface Antenna { id: string; position: Point; range: number; power?: number; }
export interface AutoPlaceOptions {
  savedAreas: Point[][];
  scale: number; // meters per pixel
  defaultAntennaRange: number; // meters
  defaultAntennaPower: number; // arbitrary 0-100
  isPointInPolygon: (p: Point, poly: Point[]) => boolean;
  exclusions?: Point[][];
  overlapFactor?: number; // 0.7 - 1.0 (1.0 = no extra overlap). Default 0.9
  gapSampleFactor?: number; // sample spacing factor relative to radius (default 0.6)
  gapCoverThreshold?: number; // fraction of sample points covered to stop (default 0.995)
  maxGapAntennas?: number; // safety cap
}

// Polygon area (shoelace) in pixel units
function polygonArea(polygon: Point[]): number {
  if (polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
  }
  return Math.abs(area / 2);
}

function hexSeed(area: Point[], rangePx: number, isPointInPolygon: (p:Point,poly:Point[])=>boolean, exclusions: Point[][], overlap: number): Point[] {
  const res: Point[] = [];
  if (area.length < 3) return res;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of area) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  const dx = rangePx * Math.sqrt(3) * overlap; // horizontal spacing
  const dy = rangePx * 1.5 * overlap;          // vertical spacing
  let row = 0;
  for (let y = minY - rangePx; y <= maxY + rangePx; y += dy, row++) {
    const xOffset = (row % 2 === 0) ? 0 : dx / 2;
    for (let x = minX - rangePx; x <= maxX + rangePx; x += dx) {
      const px = x + xOffset; const pt = { x: px, y };
      if (!isPointInPolygon(pt, area)) continue;
      let excluded = false;
      for (const ex of exclusions) { if (ex.length >=3 && isPointInPolygon(pt, ex)) { excluded = true; break; } }
      if (excluded) continue;
      res.push(pt);
    }
  }
  return res;
}

function buildSamples(area: Point[], rangePx: number, isPointInPolygon: (p:Point,poly:Point[])=>boolean, exclusions: Point[][], sampleSpacing: number): Point[] {
  const out: Point[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of area) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  for (let x = minX; x <= maxX; x += sampleSpacing) {
    for (let y = minY; y <= maxY; y += sampleSpacing) {
      const pt = { x, y };
      if (!isPointInPolygon(pt, area)) continue;
      let excluded = false;
      for (const ex of exclusions) { if (ex.length>=3 && isPointInPolygon(pt, ex)) { excluded = true; break; } }
      if (excluded) continue;
      out.push(pt);
    }
  }
  return out;
}

function coverCheck(samples: Point[], antennas: Point[], rangePx: number): boolean[] {
  const covered = new Array(samples.length).fill(false);
  const r2 = rangePx * rangePx;
  for (let i=0;i<samples.length;i++) {
    const s = samples[i];
    for (const a of antennas) {
      const dx = s.x - a.x; const dy = s.y - a.y;
      if (dx*dx + dy*dy <= r2) { covered[i] = true; break; }
    }
  }
  return covered;
}

function gapFill(area: Point[], current: Point[], samples: Point[], covered: boolean[], rangePx: number, maxAdd: number): Point[] {
  const added: Point[] = [];
  const r2 = rangePx * rangePx;
  let iterations = 0;
  while (iterations < maxAdd) {
    let bestIdx = -1; let bestScore = -1; let bestPoint: Point | null = null;
    for (let i=0;i<samples.length;i++) {
      if (covered[i]) continue; // uncovered sample candidate
      const cand = samples[i];
      // Score: number of uncovered samples within radius
      let score = 0;
      for (let j=0;j<samples.length;j++) {
        if (covered[j]) continue;
        const s = samples[j]; const dx = s.x - cand.x; const dy = s.y - cand.y;
        if (dx*dx + dy*dy <= r2) score++;
      }
      if (score > bestScore) { bestScore = score; bestIdx = i; bestPoint = cand; }
    }
    if (!bestPoint || bestScore <= 0) break;
    current.push(bestPoint); added.push(bestPoint);
    // Update coverage quickly
    for (let j=0;j<samples.length;j++) {
      if (covered[j]) continue;
      const s = samples[j]; const dx = s.x - bestPoint.x; const dy = s.y - bestPoint.y;
      if (dx*dx + dy*dy <= r2) covered[j] = true;
    }
    iterations++;
  }
  return added;
}

export function fullCoverageAutoPlace(opts: AutoPlaceOptions): Antenna[] {
  const { savedAreas, scale, defaultAntennaRange, defaultAntennaPower, isPointInPolygon } = opts;
  const exclusions = opts.exclusions || [];
  if (!savedAreas?.length || !scale || scale <= 0) return [];
  const rangePx = (defaultAntennaRange || 6) / scale;
  const overlap = opts.overlapFactor ?? 0.9;
  const sampleFactor = opts.gapSampleFactor ?? 0.6;
  const coverThreshold = opts.gapCoverThreshold ?? 0.995;
  const maxGapAntennas = opts.maxGapAntennas ?? 400;

  const antennas: Antenna[] = [];
  savedAreas.forEach((area, areaIdx) => {
    // Seed placement
    let points = hexSeed(area, rangePx, isPointInPolygon, exclusions, overlap);

    // Build samples & evaluate coverage
    const samples = buildSamples(area, rangePx, isPointInPolygon, exclusions, rangePx * sampleFactor);
    let covered = coverCheck(samples, points, rangePx);
    const coveredRatio = () => covered.filter(Boolean).length / (covered.length || 1);

    // Adaptive tightening: if coverage < 60% (pathological) increase overlap then reseed
    if (coveredRatio() < 0.6) {
      const tighter = Math.max(0.6, overlap * 0.75);
      points = hexSeed(area, rangePx, isPointInPolygon, exclusions, tighter);
      covered = coverCheck(samples, points, rangePx);
    }

    // Gap fill until threshold or safety limit
    let loops = 0;
    while (coveredRatio() < coverThreshold && loops < 10) {
      gapFill(area, points, samples, covered, rangePx, Math.min(25, maxGapAntennas));
      loops++;
      if (points.length > maxGapAntennas) break;
    }

    // FINE PASS: resample with finer grid to catch missed pockets
    const fineSamples = buildSamples(area, rangePx, isPointInPolygon, exclusions, rangePx * 0.35);
    let fineCovered = coverCheck(fineSamples, points, rangePx);
    if (fineCovered.some(c => !c)) {
      // Place antennas directly at uncovered fine sample clusters (greedy)
      let safety = 0;
      while (fineCovered.includes(false) && safety < 150) {
        // pick first uncovered
        const idx = fineCovered.findIndex(c => !c);
        if (idx === -1) break;
        const seed = fineSamples[idx];
        // Skip if very close to existing
        const tooClose = points.some(p => {
          const dx = p.x - seed.x; const dy = p.y - seed.y; return (dx*dx + dy*dy) < (rangePx*0.55)*(rangePx*0.55);
        });
        if (!tooClose) {
          points.push(seed);
          // update coverage local
          const r2 = rangePx * rangePx;
          for (let i=0;i<fineSamples.length;i++) {
            if (fineCovered[i]) continue;
            const s = fineSamples[i]; const dx = s.x - seed.x; const dy = s.y - seed.y;
            if (dx*dx + dy*dy <= r2) fineCovered[i] = true;
          }
        } else {
          fineCovered[idx] = true; // avoid infinite loop
        }
        safety++;
        if (points.length > maxGapAntennas) break;
      }
    }

    // Adaptive minimum antenna requirement based on area size & overlap
    const areaPx = polygonArea(area);
    const theoreticalMin = areaPx / (Math.PI * rangePx * rangePx); // discs at perfect packing
    const desiredMultiplier = 0.9 + (1 - overlap) * 0.8; // higher density => bigger multiplier
    const minAntennas = Math.ceil(theoreticalMin * desiredMultiplier);

    if (points.length < minAntennas) {
      // Supplemental offset hex grid (shifted by half spacing) to add more candidates
      const dxBase = rangePx * Math.sqrt(3) * overlap * 0.9; // slightly tighter
      const dyBase = rangePx * 1.5 * overlap * 0.9;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of area) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
      let row = 0;
      for (let y = minY - rangePx/2; y <= maxY + rangePx/2 && points.length < minAntennas; y += dyBase/1.2, row++) {
        const xOffset = (row % 2 === 0) ? dxBase/2 : 0; // reversed offset for dense interleave
        for (let x = minX - rangePx/2; x <= maxX + rangePx/2 && points.length < minAntennas; x += dxBase) {
          const pt = { x: x + xOffset, y };
          if (!isPointInPolygon(pt, area)) continue;
          let excluded = false; for (const ex of exclusions) { if (ex.length>=3 && isPointInPolygon(pt, ex)) { excluded = true; break; } }
          if (excluded) continue;
          // Skip if already close to existing
          const close = points.some(p => { const dx = p.x - pt.x; const dy = p.y - pt.y; return (dx*dx + dy*dy) < (rangePx*0.6)*(rangePx*0.6); });
          if (close) continue;
          points.push(pt);
        }
      }
    }

    // Emit antennas
    points.forEach((p, i) => antennas.push({ id: `ant-${areaIdx}-${i}`, position: p, range: defaultAntennaRange, power: defaultAntennaPower }));
  });
  return antennas;
}

export default { fullCoverageAutoPlace };
