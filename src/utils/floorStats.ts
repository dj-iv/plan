import { CanvasState, FloorStatistics, Units } from '@/types/project';

const AREA_CONVERSIONS: Record<string, number> = {
  meters: 1,
  cm: 1 / 100,
  mm: 1 / 1000,
  feet: 0.3048,
};

export function normaliseUnit(unit?: Units): Units {
  if (!unit) return 'meters';
  switch (unit) {
    case 'cm':
    case 'mm':
    case 'feet':
    case 'meters':
      return unit;
    default:
      return 'meters';
  }
}

export function convertAreaToUnit(areaSqMeters: number, unit: Units): number {
  const metersPerUnit = AREA_CONVERSIONS[unit] ?? 1;
  const factor = 1 / (metersPerUnit * metersPerUnit);
  return areaSqMeters * factor;
}

export function computeFloorStatistics(canvasState: CanvasState): { stats: FloorStatistics; units: Units } {
  const antennas = canvasState.antennas?.length ?? 0;

  const selectionAreas = (canvasState.selections || [])
    .filter(entry => typeof entry.value === 'number')
    .map((entry, idx) => {
      const value = entry.value ?? 0;
      const isExclusion = value < 0;
      return {
        id: entry.id || `selection-${idx}`,
        label: entry.label || (isExclusion ? `Exclusion ${idx + 1}` : `Area ${idx + 1}`),
        area: value,
      };
    });

  let areas = selectionAreas;
  if (!areas.length && Array.isArray(canvasState.areas)) {
    areas = canvasState.areas
      .filter(area => typeof area?.area === 'number')
      .map((area, idx) => ({
        id: area.id || `area-${idx}`,
        label: `Area ${idx + 1}`,
        area: area.area ?? 0,
      }));
  }

  const totalArea = areas.reduce((sum, item) => sum + (item.area || 0), 0);
  const areaCount = areas.filter(item => (item.area ?? 0) > 0).length || areas.length;

  const stats: FloorStatistics = {
    antennaCount: antennas,
    areaCount,
    totalArea,
    areaSummaries: areas,
  };

  const units = normaliseUnit(canvasState.scaleUnit);

  return { stats, units };
}
