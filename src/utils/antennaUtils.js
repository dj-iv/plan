'use client';

// Clean v3 interior-first farthest-point placement ensuring antennas remain inside polygon
export function simpleAutoPlaceAntennas({
  savedAreas,
  scale,
  defaultAntennaRange,
  defaultAntennaPower,
  isPointInPolygon,
  exclusions = [],
  coverageMode = 'aggressive',
  maxAntennasGlobal = 160
}) {
  console.log('🟢 FULL COVERAGE (JS) v3 clean start');
  if (!scale) return [];
  if (!savedAreas || !savedAreas.length) return [];

  const rangeM = defaultAntennaRange || 8;
  const rangePx = rangeM / scale;
  const sampleSpacing = rangePx * 0.33; // dense grid
  const boundarySpacing = rangePx * 0.22; // denser edges
  const edgeClearancePx = rangePx * 0.15;
  const coverageTarget = coverageMode === 'aggressive' ? 0.995 : 0.985;
  const antennas = [];
  console.log(`Range ${rangeM}m (~${rangePx.toFixed(1)}px) spacing=${sampleSpacing.toFixed(1)} boundary=${boundarySpacing.toFixed(1)} target=${(coverageTarget*100).toFixed(2)}%`);

  const pointInAnyExclusion = (pt) => {
    for (const ex of exclusions) if (Array.isArray(ex) && ex.length>=3 && isPointInPolygon(pt, ex)) return true; return false;
  };

  function distanceToEdge(p, poly){
    let min=Infinity; for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];const vx=b.x-a.x,vy=b.y-a.y;const wx=p.x-a.x,wy=p.y-a.y;const c1=vx*wx+vy*wy;const c2=vx*vx+vy*vy;let t=c2?c1/c2:0; if(t<0)t=0; else if(t>1)t=1; const projx=a.x+vx*t,projy=a.y+vy*t; const dx=p.x-projx,dy=p.y-projy; const d=Math.hypot(dx,dy); if(d<min)min=d;} return min;
  }

  function markCoverage(samples){
    const r2 = rangePx*rangePx; for(const s of samples){ if(s.covered) continue; for(const a of antennas){ const dx=s.x-a.position.x, dy=s.y-a.position.y; if(dx*dx+dy*dy<=r2){ s.covered=true; break; } } }
  }

  for (let areaIdx=0; areaIdx < savedAreas.length; areaIdx++) {
    const area = savedAreas[areaIdx];
    if (!Array.isArray(area) || area.length < 3) continue;
    console.log(`→ Area ${areaIdx} points=${area.length}`);

    // Build sample set
    const xs = area.map(p=>p.x), ys = area.map(p=>p.y);
    const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
    const samples = [];
    let row=0; for(let y=minY; y<=maxY; y+=sampleSpacing){ const off=(row&1)*sampleSpacing*0.5; for(let x=minX; x<=maxX; x+=sampleSpacing){ const px=x+off, py=y; const pt={x:px,y:py}; if(!isPointInPolygon(pt,area)) continue; if(pointInAnyExclusion(pt)) continue; samples.push({x:px,y:py,covered:false}); } row++; }
    // boundary samples
    for(let i=0;i<area.length;i++){ const a=area[i], b=area[(i+1)%area.length]; const dx=b.x-a.x, dy=b.y-a.y; const len=Math.hypot(dx,dy); const steps=Math.max(1,Math.floor(len/boundarySpacing)); for(let s=0;s<=steps;s++){ const t=s/steps; const x=a.x+dx*t, y=a.y+dy*t; const pt={x,y}; if(pointInAnyExclusion(pt)) continue; if(!isPointInPolygon(pt,area)) continue; samples.push({x,y,covered:false,boundary:true}); }}

    if(!samples.length) { console.warn('No samples inside area', areaIdx); continue; }
    // compute edge distance
    for(const s of samples) s.edgeDist = distanceToEdge(s, area);
    const totalSamples = samples.length;
    const interior = samples.filter(s=>s.edgeDist>=edgeClearancePx);
    console.log(`   samples=${totalSamples} interior=${interior.length}`);

    let iterations=0;
    while(iterations<4000){
      markCoverage(samples);
      const uncoveredInterior = interior.filter(s=>!s.covered);
      const uncoveredAll = samples.filter(s=>!s.covered);
      const coveredRatio = 1 - uncoveredAll.length/totalSamples;
      if(coveredRatio>=coverageTarget) { console.log(`   ✅ area ${areaIdx} coverage ${(coveredRatio*100).toFixed(2)}%`); break; }
      const candidates = uncoveredInterior.length? uncoveredInterior : uncoveredAll;
      if(!candidates.length) break;
      let best=candidates[0]; let bestScore=-Infinity;
      for(const c of candidates){
        let nearest=Infinity; for(const a of antennas){ const dx=c.x-a.position.x, dy=c.y-a.position.y; const d2=dx*dx+dy*dy; if(d2<nearest) nearest=d2; }
        if(!antennas.length) nearest=1e12; // first
        const edgeBonus = Math.min(c.edgeDist, rangePx); // keep away from edge
        const score = nearest + edgeBonus*edgeBonus*0.12; // weighting
        if(score>bestScore){ bestScore=score; best=c; }
      }
      antennas.push({ id:`antenna-${antennas.length+1}`, position:{x:best.x,y:best.y}, range: rangeM, power: defaultAntennaPower });
      iterations++;
      if(antennas.length>=maxAntennasGlobal){ console.warn('Global antenna limit reached'); break; }
    }

    // Boundary refinement: cover any remaining boundary points specifically
    let boundaryPass=0;
    while(boundaryPass<150 && antennas.length<maxAntennasGlobal){
      markCoverage(samples);
      const uncoveredBoundary = samples.filter(s=>!s.covered && s.boundary);
      if(!uncoveredBoundary.length) break;
      let best=uncoveredBoundary[0]; let bestNear=-1;
      for(const b of uncoveredBoundary){ let nearest=Infinity; for(const a of antennas){ const dx=b.x-a.position.x, dy=b.y-a.position.y; const d2=dx*dx+dy*dy; if(d2<nearest) nearest=d2; } if(nearest>bestNear){ bestNear=nearest; best=b; } }
      antennas.push({ id:`antenna-${antennas.length+1}`, position:{x:best.x,y:best.y}, range: rangeM, power: defaultAntennaPower, edge:true });
      boundaryPass++;
      const coveredRatio = 1 - samples.filter(s=>!s.covered).length/totalSamples;
      if(coveredRatio>=coverageTarget) break;
    }
    const finalCoverage = 1 - samples.filter(s=>!s.covered).length/totalSamples;
    console.log(`   ➕ area ${areaIdx} final coverage ${(finalCoverage*100).toFixed(2)}% antennas so far ${antennas.length}`);
    if(antennas.length>=maxAntennasGlobal) break;
  }

  console.log(`🟢 Placement complete. Total antennas=${antennas.length}`);
  return antennas;
}
