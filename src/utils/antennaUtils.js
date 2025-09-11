'use client';

// Simple auto-placement function for antennas
export function simpleAutoPlaceAntennas({
  savedAreas,
  scale,
  defaultAntennaRange,
  defaultAntennaPower,
  isPointInPolygon,
  exclusions = [] // optional array of exclusion polygons (arrays of points)
}) {
  console.log('🟢 FULL COVERAGE (JS) v2 start (multi-resolution)');
  if (!scale) {
    alert('Please set the scale first before placing antennas');
    return [];
  }
  if (!savedAreas || savedAreas.length === 0) {
    alert('Please calculate at least one area before auto-placing antennas');
    return [];
  }

  const rangeM = defaultAntennaRange || 8;
  const rangePx = rangeM / scale; // meters -> pixels
  const baseCoverageFactor = 0.95; // for marking sample as covered
  const coarseSpacing = rangePx * 0.9;   // fast initial sweep
  const fineSpacing   = rangePx * 0.45;  // corridor / gap refinement
  const ultraSpacing  = rangePx * 0.25;  // stubborn gaps

  console.log(`Range ${rangeM}m => ${rangePx.toFixed(2)}px (pxPerM=${(1/scale).toFixed(2)}). Spacing: coarse=${coarseSpacing.toFixed(1)} fine=${fineSpacing.toFixed(1)} ultra=${ultraSpacing.toFixed(1)}`);
  const antennas = [];

  const pointInAnyExclusion = (pt) => {
    if (!exclusions || !exclusions.length) return false;
    for (const ex of exclusions) {
      if (Array.isArray(ex) && ex.length >= 3 && isPointInPolygon(pt, ex)) return true;
    }
    return false;
  };

  const polygonAreaPx = (poly) => { // returns area in canvas units^2
    let a = 0; const n = poly.length;
    for (let i=0,j=n-1;i<n;j=i++) { a += (poly[j].x + poly[i].x)*(poly[j].y - poly[i].y); }
    return Math.abs(a/2);
  };

  const addSamples = (poly, spacing, bucket, tag) => {
    let row = 0; let added = 0;
    const minX = Math.min(...poly.map(p=>p.x));
    const maxX = Math.max(...poly.map(p=>p.x));
    const minY = Math.min(...poly.map(p=>p.y));
    const maxY = Math.max(...poly.map(p=>p.y));
    for (let y = minY; y <= maxY; y += spacing) {
      const offset = (row % 2) * spacing * 0.5; // hex staggering
      for (let x = minX; x <= maxX; x += spacing) {
        const sx = x + offset; const sy = y;
        const pt = { x: sx, y: sy };
        if (!isPointInPolygon(pt, poly)) continue;
        if (pointInAnyExclusion(pt)) continue;
        bucket.push({ x: sx, y: sy, covered: false });
        added++;
      }
      row++;
    }
    console.log(`   ▫ ${tag} samples added: ${added}`);
  };

  const markCoverage = (samples, antennaList, coverageFactor = baseCoverageFactor) => {
    const rEff = rangePx * coverageFactor;
    const r2 = rEff * rEff;
    for (const s of samples) {
      if (s.covered) continue;
      for (const a of antennaList) {
        const dx = s.x - a.position.x; const dy = s.y - a.position.y;
        if (dx*dx + dy*dy <= r2) { s.covered = true; break; }
      }
    }
  };

  try {
    const areas = Array.isArray(savedAreas) ? savedAreas : [];
    areas.forEach((area, areaIdx) => {
      if (!Array.isArray(area) || area.length < 3) return;
      const areaPx = polygonAreaPx(area);
      const areaM2 = areaPx * scale * scale;
      const effPerAntennaM2 = Math.PI * rangeM * rangeM * 0.6; // assume 60% efficiency after overlap / geometry
      let estNeeded = Math.ceil(areaM2 / effPerAntennaM2);
      estNeeded = Math.max(estNeeded, 1);
      const hardCap = Math.min(estNeeded * 2, 1000); // safety
      console.log(`Area ${areaIdx} points=${area.length} areaPx=${areaPx.toFixed(1)} areaM2=${areaM2.toFixed(1)} estNeeded≈${estNeeded}`);

      // SAMPLE GENERATION (multi-resolution)
      const samples = [];
      addSamples(area, coarseSpacing, samples, 'coarse');
      addSamples(area, fineSpacing, samples, 'fine');

      // Deduplicate samples (grid hashing)
      const seen = new Map();
      const deduped = [];
      const hashFactor = 1 / (ultraSpacing * 0.5);
      for (const s of samples) {
        const key = `${Math.round(s.x*hashFactor)}:${Math.round(s.y*hashFactor)}`;
        if (!seen.has(key)) { seen.set(key, true); deduped.push(s); }
      }
      samples.length = 0; samples.push(...deduped);
      console.log(`   ▫ total unique samples=${samples.length}`);
      if (!samples.length) return;

      let iterations = 0;
      let addedForArea = 0;
      let maxDistSqLast = Infinity;

      while (iterations < 3000) { // generous safety
        markCoverage(samples, antennas, baseCoverageFactor);
        const uncovered = samples.filter(s => !s.covered);
        if (!uncovered.length) {
          console.log(`   ✅ Area ${areaIdx} fully sampled in ${iterations} iterations (antennas so far=${antennas.length})`);
          break;
        }

        // compute farthest uncovered from nearest antenna (or arbitrary if none yet)
        let best = uncovered[0];
        let bestDistSq = -1;
        for (const s of uncovered) {
          let nearest = Infinity;
            for (const a of antennas) {
              const dx = s.x - a.position.x; const dy = s.y - a.position.y; const d2 = dx*dx + dy*dy; if (d2 < nearest) nearest = d2;
            }
          if (antennas.length === 0) nearest = Infinity;
          if (nearest > bestDistSq) { bestDistSq = nearest; best = s; }
        }

        // early exit heuristics
        const rTolSq = (rangePx * 0.55)*(rangePx * 0.55);
        const progress = bestDistSq < maxDistSqLast - (rangePx*rangePx*0.02); // 2% radius^2 improvement
        if (!progress && addedForArea >= estNeeded && bestDistSq <= rTolSq) {
          console.log(`   ⏹ Area ${areaIdx} stopping: diminishing returns (bestDistSq=${bestDistSq.toFixed(1)})`);
          break;
        }
        maxDistSqLast = bestDistSq;

        antennas.push({
          id: `antenna-${antennas.length+1}`,
          position: { x: best.x, y: best.y },
          range: rangeM,
          power: defaultAntennaPower
        });
        addedForArea++;
        iterations++;
        if (addedForArea >= hardCap) { console.warn(`   ⚠ Area ${areaIdx} reached hardCap ${hardCap}`); break; }
        if (antennas.length >= 1000) { console.warn('Global antenna hard limit (1000)'); break; }

        // dynamic refinement: if still lots uncovered after exceeding estNeeded/2 add ultra samples around uncovered cluster
        if (addedForArea === Math.ceil(estNeeded/2) || (addedForArea > estNeeded && iterations % 10 === 0)) {
          const stillUncovered = samples.filter(s => !s.covered);
          if (stillUncovered.length) {
            // compute bbox of uncovered
            let ux_min = Infinity, ux_max = -Infinity, uy_min = Infinity, uy_max = -Infinity;
            for (const u of stillUncovered) { if (u.x<ux_min) ux_min=u.x; if (u.x>ux_max) ux_max=u.x; if (u.y<uy_min) uy_min=u.y; if (u.y>uy_max) uy_max=u.y; }
            const localSamples = [];
            for (let y = uy_min; y <= uy_max; y += ultraSpacing) {
              const rowOff = ((y/ultraSpacing)|0 % 2) * ultraSpacing * 0.5;
              for (let x = ux_min; x <= ux_max; x += ultraSpacing) {
                const sx = x + rowOff; const sy = y; const pt = {x:sx,y:sy};
                if (!isPointInPolygon(pt, area)) continue;
                if (pointInAnyExclusion(pt)) continue;
                const key = `${Math.round(sx*hashFactor)}:${Math.round(sy*hashFactor)}`;
                if (!seen.has(key)) { seen.set(key,true); samples.push({x:sx,y:sy,covered:false}); }
              }
            }
            console.log(`   🔍 Ultra refinement added. Samples now=${samples.length}`);
          }
        }
      }
      console.log(`   ➕ Area ${areaIdx} added antennas=${addedForArea} (global total ${antennas.length})`);
    });
  } catch (err) {
    console.error('Full coverage placement failed', err);
    return [];
  }
  console.log(`🟢 Placement complete. Total antennas: ${antennas.length}`);
  return antennas;
}
