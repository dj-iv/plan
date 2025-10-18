// Shared types for project saving/loading

export type Point = { x: number; y: number };

export type Area = {
  id: string;
  points: Point[];
  area?: number;
};

export type ObjectRegion = {
  id: string;
  name?: string;
  perimeter: Point[];
  holes: Point[][];
};

export type SelectionEntry = {
  id: string;
  value: number; // positive for included area, negative for exclusions
  label?: string;
};

export type Antenna = {
  id: string;
  position: Point;
  range: number; // meters
  power?: number; // 0-100
  pulsing?: boolean;
};

export type ScaleMetadata = {
  mode: 'distance' | 'area';
  /** For distance mode this is the measured pixel length; for area it is the pixel area (px²). */
  pixelValue: number;
  /** Stored real-world distance in meters (distance mode only). */
  realMeters?: number;
  /** Stored real-world area in square meters (area mode only). */
  realSquareMeters?: number;
  /** Natural image dimensions when the scale was captured. */
  imageWidth: number;
  imageHeight: number;
  /** Canvas draw dimensions when the scale was captured. */
  canvasWidth?: number;
  canvasHeight?: number;
  /** Original unit label provided by the user (e.g. meters, feet). */
  unitLabel?: string;
  /** ISO timestamp string when calibration occurred; useful for diagnostics. */
  capturedAtIso?: string;
};

export type CanvasState = {
  // Core geometry/state
  antennas?: Antenna[];
  areas?: Area[];
  scale?: number | null;
  scaleUnit?: Units;
  scaleMetadata?: ScaleMetadata | null;
  showCoverage?: boolean;
  showRadiusBoundary?: boolean;
  antennaRange?: number;
  pulsingAntennaIds?: string[];
  scaleVertices?: Point[];
  selectedAreaVertices?: Point[];
  calculatedArea?: number | null;

  // Calibration
  calibrationPoints?: Point[];
  calibrationAreaPoints?: Point[];
  calibrationAreaReal?: number | string | null;

  // Detected geometry
  perimeter?: Point[] | null;
  perimeterRaw?: Point[] | null;
  holes?: Point[][]; // nested arrays of points
  objects?: ObjectRegion[];
  justSavedObject?: boolean;
  autoHolesPreview?: Point[][]; // nested arrays of points
  autoHolesIndex?: number;

  // Manual session
  excludeCurrent?: Point[];
  roi?: { x: number; y: number; w: number; h: number } | null;
  mode?:
    | 'select'
    | 'measure'
    | 'calibrate'
    | 'calibrate-area'
    | 'roi'
    | 'edit-poly'
    | 'exclude'
    | 'pick-hole'
    | 'edit-hole'
    | 'manual-exclude'
    | 'refine'
    | 'antenna';
  manualRegions?: Point[][];
  manualHoles?: Point[][];
  manualResult?: number | null;
  selections?: SelectionEntry[];

  // Overlays persisted for context
  savedAreas?: Point[][];
  savedExclusions?: Point[][];

  // View info (optional, helps restore view)
  zoom?: number;
  pan?: { x: number; y: number };
  canvasWidth?: number;
  canvasHeight?: number;
  originalImageWidth?: number;
  originalImageHeight?: number;
  savedForDeviceWidth?: number;
  savedForDeviceHeight?: number;
  mappedAntennasForSave?: (Antenna & { imageX?: number; imageY?: number })[];
};

export type Units = 'meters' | 'cm' | 'mm' | 'feet';

export type ProjectSettings = {
  units: Units;
  showRadiusBoundary?: boolean;
};

export type ProjectEngineer = {
  uid?: string;
  email?: string;
  displayName?: string;
};

export type FloorAreaSummary = {
  id: string;
  label: string;
  area: number;
};

export type PulsingAntennaSummary = {
  id: string;
  label: string;
  range: number | null;
  position: Point;
};

export type FloorStatistics = {
  antennaCount: number;
  areaCount: number;
  totalArea: number;
  areaSummaries: FloorAreaSummary[];
  antennaRange?: number | null;
  pulsingAntennaCount?: number;
  pulsingAntennas?: PulsingAntennaSummary[];
};

export type SaveProjectRequest = {
  name: string;
  description?: string;
  canvasState: CanvasState;
  settings: ProjectSettings;
  imageFile?: File; // optional when updating without new image
  thumbnailBlob?: Blob; // optional small preview image to store
};

export type ProjectData = {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt?: Date;
  version: number;
  // Optional: number of floors in subcollection (for multi-floor projects)
  floorCount?: number;
  engineer?: ProjectEngineer;
  metadata: {
    originalFileName?: string;
    fileSize?: number;
    imageUrl: string;
    storagePath?: string;
    imageWidth?: number;
    imageHeight?: number;
    thumbnailUrl?: string;
  };
  canvasState: CanvasState;
  settings: ProjectSettings;
};

export type ProjectSummary = {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt?: Date;
  thumbnailUrl?: string;
  antennaCount: number;
  areaCount: number;
  floorCount?: number;
  engineer?: ProjectEngineer;
};

// ===== Multi-floor types (subcollection under projects/{pid}/floors/{fid}) =====

export type SaveFloorRequest = {
  name?: string;
  canvasState: CanvasState;
  imageFile?: File;
  thumbnailBlob?: Blob;
  sourcePlanType?: 'pdf' | 'image' | 'bitmap';
  sourcePageWidthMm?: number | null;
  sourcePageHeightMm?: number | null;
  sourcePageWidthPoints?: number | null;
  sourcePageHeightPoints?: number | null;
  sourceRenderScale?: number | null;
};

export type FloorData = {
  id: string;
  projectId: string;
  name: string;
  orderIndex: number;
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    originalFileName?: string;
    fileSize?: number;
    imageUrl: string;
    storagePath?: string;
    imageWidth?: number;
    imageHeight?: number;
    thumbnailUrl?: string;
  };
  canvasState: CanvasState;
  stats?: FloorStatistics;
  units?: Units;
  sourcePlanType?: 'pdf' | 'image' | 'bitmap';
  sourcePageWidthMm?: number | null;
  sourcePageHeightMm?: number | null;
  sourcePageWidthPoints?: number | null;
  sourcePageHeightPoints?: number | null;
  sourceRenderScale?: number | null;
};

export type FloorSummary = {
  id: string;
  name: string;
  orderIndex: number;
  updatedAt: Date;
  thumbnailUrl?: string;
  antennaCount: number;
  areaCount: number;
  totalArea: number;
  units?: Units;
  areaSummaries?: FloorAreaSummary[];
  antennaRange?: number | null;
  pulsingAntennaCount?: number;
  pulsingAntennas?: PulsingAntennaSummary[];
};

export type FloorEntry = {
  id: string;
  name: string;
  orderIndex: number;
  createdAt: Date;
  updatedAt: Date;
  thumbnailUrl?: string;
  imageUrl?: string;
  imageFile?: File;
  canvasState: CanvasState;
  stats: FloorStatistics;
  units: Units;
  scale: number | null;
  dirty: boolean;
  persisted: boolean;
  loaded: boolean;
  stateHash?: string;
  sourcePlanType?: 'pdf' | 'image' | 'bitmap';
  sourcePageWidthMm?: number | null;
  sourcePageHeightMm?: number | null;
  sourcePageWidthPoints?: number | null;
  sourcePageHeightPoints?: number | null;
  sourceRenderScale?: number | null;
};
