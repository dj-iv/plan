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
};

export type CanvasState = {
  // Core geometry/state
  antennas?: Antenna[];
  areas?: Area[];
  scale?: number | null;
  showCoverage?: boolean;
  showRadiusBoundary?: boolean;
  antennaRange?: number;
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
};

export type Units = 'meters' | 'cm' | 'mm' | 'feet';

export type ProjectSettings = {
  units: Units;
  showRadiusBoundary?: boolean;
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
};
