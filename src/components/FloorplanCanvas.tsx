import React, { useEffect, useRef, useState, useCallback } from 'react';
import Portal from './Portal';
import SmartAutoPlaceButton from './SmartAutoPlaceButton';
import FloorsPanel from './FloorsPanel';
import useFixAutoPlaceButton from '@/hooks/useFixAutoPlaceButton';
import { simpleAutoPlaceAntennas } from '@/utils/antennaUtils';
import type { ScaleMetadata } from '@/types/project';
import type { FloorNameAiStatus } from '@/types/ai';
// Placement logic provided by antennaUtils.simpleAutoPlaceAntennas
// Trim now runs in a Web Worker at /workers/trim-opencv.js to avoid blocking UI

interface FloorplanCanvasProps {
  imageUrl: string;
  scale: number | null;
  scaleUnit: string;
  onCalibrate?: (scale: number, unit: string) => void;
  requestCalibrateToken?: number; // increment to start calibrate from outside
  onFullscreenChange?: (isFs: boolean) => void;
  onTrimmedImage?: (croppedDataUrl: string, quad?: {x:number;y:number}[], confidence?: number) => void;
  onScaleDetected?: (unitsPerPixel: number, unit: string, method?: string, confidence?: number) => void;
  onReset?: () => void; // callback to reset and go back to upload screen
  onStateChange?: (state: any) => void; // notify parent for Save
  onSaveProject?: () => void; // callback to save current project
  loadedCanvasState?: any; // state to restore when loading a project
  isSaving?: boolean; // saving state for Save button UI
  justSaved?: boolean; // briefly show Saved ✓ after save completes
  isUpdate?: boolean; // whether current project exists (changes button label)
  // Multi-floor support
  floors?: import('@/types/project').FloorSummary[];
  currentFloorId?: string | null;
  onSelectFloor?: (floorId: string) => void;
  onRenameFloor?: (floorId: string, name: string) => void;
  onDeleteFloor?: (floorId: string) => void;
  onAddFloor?: () => void;
  floorsLoading?: boolean;
  onDetectFloorName?: (floorId: string) => void;
  floorNameAiStatus?: Record<string, FloorNameAiStatus>;
}

interface Point {
  x: number;
  y: number;
}

interface Area {
  id: string;
  points: Point[];
  area?: number;
}

interface ObjectRegion {
  id: string;
  name?: string;
  perimeter: Point[];
  holes: Point[][];
}

// Unified selection entry for the Summary (positive for included area, negative for exclusions)
interface SelectionEntry {
  id: string;
  value: number; // square units (m²)
  label?: string;
}

// Antenna placement feature
interface Antenna {
  id: string;
  position: Point;
  range: number; // in meters
  power?: number; // 0-100 percentage, optional to match antennaUtils
}

const CANVAS_VERTICAL_PADDING = 16;
const CANVAS_EDGE_MARGIN = 16;
const SUMMARY_GAP = 32;

// Snapshot of canvas state for undo/redo and save payloads
interface Snapshot {
  areas: Area[];
  currentArea: Point[];
  calibrationPoints: Point[];
  calibrationAreaPoints: Point[];
  calibrationAreaReal: string;
  scaleMetadata: ScaleMetadata | null;
  perimeter: Point[] | null;
  perimeterRaw: Point[] | null;
  holes: Point[][];
  objects: ObjectRegion[];
  justSavedObject: boolean;
  autoHolesPreview: Point[][];
  autoHolesIndex: number;
  antennas: Antenna[];
  excludeCurrent: Point[];
  roi: {x:number;y:number;w:number;h:number} | null;
  mode: 'select' | 'measure' | 'calibrate' | 'calibrate-area' | 'roi' | 'edit-poly' | 'exclude' | 'pick-hole' | 'edit-hole' | 'manual-exclude' | 'refine' | 'antenna';
  manualRegions: Point[][];
  manualHoles: Point[][];
  manualResult: number | null;
  selections: SelectionEntry[];
  savedAreas: Point[][];
  savedExclusions: Point[][];
  zoom: number;
  pan: {x:number;y:number};
  canvasWidth: number;
  canvasHeight: number;
}

export default function FloorplanCanvas({ 
  imageUrl, 
  scale, 
  scaleUnit, 
  onCalibrate, 
  requestCalibrateToken, 
  onFullscreenChange, 
  onTrimmedImage, 
  onScaleDetected, 
  onReset, 
  onStateChange, 
  onSaveProject, 
  loadedCanvasState, 
  isSaving, 
  justSaved, 
  isUpdate,
  // Multi-floor props
  floors = [],
  currentFloorId = null,
  onSelectFloor,
  onRenameFloor,
  onDeleteFloor,
  onAddFloor,
  floorsLoading = false,
  onDetectFloorName,
  floorNameAiStatus = {},
}: FloorplanCanvasProps) {
  useEffect(() => {
    console.log('[Canvas] onSaveProject present:', typeof onSaveProject);
  }, [onSaveProject]);
  // Use our custom hook to fix the Auto Place button
  // useFixAutoPlaceButton(); // Disabled - causing memory leak and unnecessary
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Add emergency antenna listener
  useEffect(() => {
    const handleEmergencyAntennaPlace = (event: Event) => {
      console.log('EMERGENCY ANTENNA PLACEMENT TRIGGERED');
      autoPlaceAntennas();
    };
    
    document.addEventListener('emergencyAntennaPlace', handleEmergencyAntennaPlace);
    
    return () => {
      document.removeEventListener('emergencyAntennaPlace', handleEmergencyAntennaPlace);
    };
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [controlsHeight, setControlsHeight] = useState(0);
  const [summaryWidth, setSummaryWidth] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [currentArea, setCurrentArea] = useState<Point[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [mode, setMode] = useState<'select' | 'measure' | 'calibrate' | 'calibrate-area' | 'roi' | 'edit-poly' | 'exclude' | 'pick-hole' | 'edit-hole' | 'manual-exclude' | 'refine' | 'antenna'>('select');
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [calibrationReal, setCalibrationReal] = useState<string>("");
  const [calibrationUnit, setCalibrationUnit] = useState<string>('meters');
  const [displayUnit, setDisplayUnit] = useState<'m' | 'ft'>('m');
  // Calibrate by Area
  const [calibrationAreaPoints, setCalibrationAreaPoints] = useState<Point[]>([]);
  const [calibrationAreaReal, setCalibrationAreaReal] = useState<string>("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x:0, y:0});
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef<{x:number;y:number}|null>(null);
  const [isPanCursor, setIsPanCursor] = useState(false);
  const suppressClickRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [scaleConfidence, setScaleConfidence] = useState<number | null>(null);
  const [scaleMethod, setScaleMethod] = useState<string | null>(null);
  const [scaleMetadata, setScaleMetadata] = useState<ScaleMetadata | null>(null);
  // Region of interest and perimeter detection
  const [roi, setRoi] = useState<{x:number;y:number;w:number;h:number}|null>(null);
  const roiDragRef = useRef<{x:number;y:number}|null>(null);
  const [perimeter, setPerimeter] = useState<Point[]|null>(null);
  const [perimeterRaw, setPerimeterRaw] = useState<Point[]|null>(null);
  const [holes, setHoles] = useState<Point[][]>([]);
  const [objects, setObjects] = useState<ObjectRegion[]>([]);
  const [justSavedObject, setJustSavedObject] = useState<boolean>(false);
  const [editHoleIndex, setEditHoleIndex] = useState<number | null>(null);
  const [autoHolesPreview, setAutoHolesPreview] = useState<Point[][]>([]);
  const [autoHolesIndex, setAutoHolesIndex] = useState<number>(-1);
  const [excludeCurrent, setExcludeCurrent] = useState<Point[]>([]);
  const [perimeterConfidence, setPerimeterConfidence] = useState<number|null>(null);
  const [simplify, setSimplify] = useState<number>(2); // epsilon in canvas pixels (minimum by default)
  // Auto Holes filtering: minimum hole size as percent of selected region area
  const [minHolePercent, setMinHolePercent] = useState<number>(1.5);
  // Unified selections list for Summary
  const [selections, setSelections] = useState<SelectionEntry[]>([]);
  // Persisted overlays of committed selections to keep visual context after Add
  const [savedAreas, setSavedAreas] = useState<Point[][]>([]);
  const [savedExclusions, setSavedExclusions] = useState<Point[][]>([]);
  // Manual selection session (multiple regions + red exclusions, then one final calculation)
  const [manualRegions, setManualRegions] = useState<Point[][]>([]);
  const [manualHoles, setManualHoles] = useState<Point[][]>([]);
  const [manualResult, setManualResult] = useState<number | null>(null);
  const manualActive = manualRegions.length > 0 || manualHoles.length > 0 || currentArea.length >= 1;
  const summaryVisible = (selections.length > 0 || floors.length > 0);
  const [summaryTopOffset, setSummaryTopOffset] = useState(CANVAS_VERTICAL_PADDING);

  // Antenna placement feature
  const [antennas, setAntennas] = useState<Antenna[]>([]);
  const [selectedAntennaId, setSelectedAntennaId] = useState<string | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [screenshotMessage, setScreenshotMessage] = useState<string | null>(null);
  const screenshotMessageTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const updateHeight = () => {
      if (controlsRef.current) {
        setControlsHeight(controlsRef.current.offsetHeight);
      }
    };

    updateHeight();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && controlsRef.current) {
      observer = new ResizeObserver(() => updateHeight());
      observer.observe(controlsRef.current);
    }

    window.addEventListener('resize', updateHeight);

    return () => {
      window.removeEventListener('resize', updateHeight);
      if (observer) observer.disconnect();
    };
  }, []);

  const showScreenshotMessage = useCallback((message: string) => {
    setScreenshotMessage(message);
    if (screenshotMessageTimeoutRef.current !== null) {
      window.clearTimeout(screenshotMessageTimeoutRef.current);
    }
    screenshotMessageTimeoutRef.current = window.setTimeout(() => {
      setScreenshotMessage(null);
      screenshotMessageTimeoutRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (screenshotMessageTimeoutRef.current !== null) {
        window.clearTimeout(screenshotMessageTimeoutRef.current);
        screenshotMessageTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const updateWidth = () => {
      const width = summaryRef.current?.offsetWidth || 0;
      setSummaryWidth(prev => (Math.abs(prev - width) > 1 ? width : prev));
    };

    updateWidth();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && summaryRef.current) {
      observer = new ResizeObserver(() => updateWidth());
      observer.observe(summaryRef.current);
    }

    window.addEventListener('resize', updateWidth);

    return () => {
      window.removeEventListener('resize', updateWidth);
      if (observer) observer.disconnect();
    };
  }, [floors.length, selections.length]);

  useEffect(() => {
    const measureOffset = () => {
      const parentEl = summaryRef.current?.offsetParent as HTMLElement | null;
      const containerEl = containerRef.current;
      if (!parentEl || !containerEl) {
        setSummaryTopOffset(controlsHeight + CANVAS_VERTICAL_PADDING);
        return;
      }
      const parentRect = parentEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      const offset = containerRect.top - parentRect.top + CANVAS_VERTICAL_PADDING;
      setSummaryTopOffset(offset);
    };

    const rafMeasure = () => { requestAnimationFrame(measureOffset); };

    rafMeasure();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => rafMeasure())
      : null;
    if (resizeObserver && containerRef.current) resizeObserver.observe(containerRef.current);
    if (resizeObserver && controlsRef.current) resizeObserver.observe(controlsRef.current);

    window.addEventListener('resize', rafMeasure);

    return () => {
      window.removeEventListener('resize', rafMeasure);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [controlsHeight, canvasSize.width, canvasSize.height, summaryWidth, summaryVisible]);

  const [showCoverage, setShowCoverage] = useState<boolean>(true);
  const [showRadiusBoundary, setShowRadiusBoundary] = useState<boolean>(true);
  // Always force coverage to be visible for debugging
  useEffect(() => {
    setShowCoverage(true);
  }, []);
  const [isDraggingAntenna, setIsDraggingAntenna] = useState<boolean>(false);
  const [isPlacingAntennas, setIsPlacingAntennas] = useState<boolean>(false); // Flag for auto-placement in progress
  const [antennaRange, setAntennaRange] = useState<number>(7); // Default 7m range for better coverage
  const [antennaDensity, setAntennaDensity] = useState<number>(65); // Grid spacing percent relative to diameter (65% ≈ 35% overlap)
  const [previewAntennas, setPreviewAntennas] = useState<Antenna[]>([]); // For live preview
  const [placementMode, setPlacementMode] = useState<'coverage' | 'gap-first'>('gap-first');
  const normalizedSpacingPercent = Math.max(50, Math.min(100, antennaDensity));
  const overlapPercent = Math.round(100 - normalizedSpacingPercent);
  const handleOverlapChange = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const clampedOverlap = Math.max(0, Math.min(50, value));
    setAntennaDensity(100 - clampedOverlap);
  }, []);
  const computeCanvasToImageScale = useCallback(() => {
    if (!image) return 1;
    const scaleX = canvasSize.width > 0 ? image.width / canvasSize.width : 1;
    const scaleY = canvasSize.height > 0 ? image.height / canvasSize.height : 1;
    if (isFinite(scaleX) && scaleX > 0 && isFinite(scaleY) && scaleY > 0) {
      return (scaleX + scaleY) / 2;
    }
    if (isFinite(scaleX) && scaleX > 0) return scaleX;
    if (isFinite(scaleY) && scaleY > 0) return scaleY;
    return 1;
  }, [image, canvasSize.width, canvasSize.height]);
  // When true, changing the radius slider will only resize existing antenna circles (visual coverage) without re-placement.
  // Track previous mode to react on mode change transitions
  const prevModeRef = useRef<typeof mode>(mode);
  useEffect(() => {
    // If leaving measure mode, clear the measurement path lines
    if (prevModeRef.current === 'measure' && mode !== 'measure') {
      setCurrentArea([]);
    }
    prevModeRef.current = mode;
  }, [mode]);

  const historyRef = useRef<Snapshot[]>([]);
  const redoHistoryRef = useRef<Snapshot[]>([]);
  const undoRef = useRef<() => void>();
  const redoRef = useRef<() => void>();
  const draggingVertexIdxRef = useRef<number | null>(null);
  const coverageDiagKeyRef = useRef<string>('');
  const processedLoadedStateRef = useRef<any>(null);

  // Utility function to scale coordinates when loading saved state
  const scaleCoordinates = useCallback((coords: any, fromDimensions: {width: number, height: number}, toDimensions: {width: number, height: number}): any => {
    if (!coords || fromDimensions.width === 0 || fromDimensions.height === 0) return coords;

    const scaleX = toDimensions.width / fromDimensions.width;
    const scaleY = toDimensions.height / fromDimensions.height;

    if (Array.isArray(coords)) {
      return coords.map(item => {
        if (item && typeof item === 'object' && 'x' in item && 'y' in item) {
          const scaled: any = { ...item, x: item.x * scaleX, y: item.y * scaleY };
          if ('w' in item) scaled.w = (item as any).w * scaleX;
          if ('h' in item) scaled.h = (item as any).h * scaleY;
          if ('width' in item) scaled.width = (item as any).width * scaleX;
          if ('height' in item) scaled.height = (item as any).height * scaleY;
          return scaled;
        } else if (Array.isArray(item)) {
          return scaleCoordinates(item, fromDimensions, toDimensions);
        }
        return item;
      });
    } else if (coords && typeof coords === 'object' && 'x' in coords && 'y' in coords) {
      const scaled: any = { ...coords, x: (coords as any).x * scaleX, y: (coords as any).y * scaleY };
      if ('w' in coords) scaled.w = (coords as any).w * scaleX;
      if ('h' in coords) scaled.h = (coords as any).h * scaleY;
      if ('width' in coords) scaled.width = (coords as any).width * scaleX;
      if ('height' in coords) scaled.height = (coords as any).height * scaleY;
      return scaled;
    } else if (coords && typeof coords === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(coords)) {
        if (key === 'position' && value && typeof value === 'object' && 'x' in value && 'y' in value) {
          const v: any = value as any;
          result[key] = { ...v, x: (v.x as number) * scaleX, y: (v.y as number) * scaleY };
        } else if (typeof value === 'object') {
          result[key] = scaleCoordinates(value, fromDimensions, toDimensions);
        } else if ((key === 'x' || key.endsWith('X')) && typeof value === 'number') {
          result[key] = value * scaleX;
        } else if ((key === 'y' || key.endsWith('Y')) && typeof value === 'number') {
          result[key] = value * scaleY;
        } else if ((key === 'w' || key === 'width') && typeof value === 'number') {
          result[key] = value * scaleX;
        } else if ((key === 'h' || key === 'height') && typeof value === 'number') {
          result[key] = value * scaleY;
        } else {
          result[key] = value;
        }
      }
      return result;
    }
    
    return coords;
  }, []);
  const draggingHoleIndexRef = useRef<number | null>(null);
  const draggingAntennaIdRef = useRef<string | null>(null);
  const draggingTargetRef = useRef<'perimeter' | 'currentArea' | 'calArea' | 'hole' | null>(null);
  // Preserve view (zoom/pan) across image replacements (e.g., after Trim)
  const preserveViewRef = useRef<null | { compositeScale: number; centerImg: {x:number;y:number} }>(null);
  const lastFitImageRef = useRef<string | null>(null);
  // Mandatory calibration gating
  const mustCalibrate = !scale;

  // Unit conversion helpers
  const unitToMetersFactor = useCallback((u: string): number => {
    switch ((u || '').toLowerCase()) {
      case 'm':
      case 'meter':
      case 'meters':
        return 1;
      case 'cm':
      case 'centimeter':
      case 'centimeters':
        return 0.01;
      case 'mm':
      case 'millimeter':
      case 'millimeters':
        return 0.001;
      case 'ft':
      case 'foot':
      case 'feet':
        return 0.3048;
      case 'in':
      case 'inch':
      case 'inches':
        return 0.0254;
      default:
        return 1; // fallback meters
    }
  }, []);
  const metersToUnitFactor = useCallback((u: string): number => {
    const f = unitToMetersFactor(u);
    return f ? (1 / f) : 1;
  }, [unitToMetersFactor]);

  // Display-only formatters (keep internal math in meters/m²)
  const formatDistanceDisplay = useCallback((metersVal: number) => {
    return displayUnit === 'ft'
      ? `${(metersVal * 3.28084).toFixed(2)} ft`
      : `${metersVal.toFixed(2)} m`;
  }, [displayUnit]);

  const formatAreaDisplay = useCallback((m2: number) => {
    // 1 m² = 10.7639104167 ft²
    return displayUnit === 'ft'
      ? `${(m2 * 10.7639104167).toFixed(2)} ft²`
      : `${m2.toFixed(2)} m²`;
  }, [displayUnit]);

  const computeFittedCanvasSize = useCallback((baseWidth: number, baseHeight: number) => {
    const safeWidth = Math.max(1, baseWidth);
    const safeHeight = Math.max(1, baseHeight);

    let availWidth = safeWidth;
    let availHeight = safeHeight;

    const container = containerRef.current;
    const controlsEl = controlsRef.current;

    const readPadding = (value?: string | null) => {
      if (value == null) return 0;
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    if (container) {
      let paddingX = 0;
      let paddingY = 0;
      if (typeof window !== 'undefined' && window.getComputedStyle) {
        const style = window.getComputedStyle(container);
        paddingX = readPadding(style?.paddingLeft) + readPadding(style?.paddingRight);
        paddingY = readPadding(style?.paddingTop) + readPadding(style?.paddingBottom);
      }

      const innerWidth = container.clientWidth - paddingX;
      const innerHeight = container.clientHeight - paddingY;
      if (innerWidth > 0) availWidth = innerWidth;
      if (innerHeight > 0) availHeight = innerHeight;
    } else if (typeof window !== 'undefined') {
  const paddingAllowance = CANVAS_EDGE_MARGIN * 2; // symmetric edge margins
  const summaryAllowance = summaryWidth ? summaryWidth + SUMMARY_GAP : 0;
  availWidth = window.innerWidth - paddingAllowance - summaryAllowance;
      const controlsHeightNow = controlsEl?.offsetHeight ?? controlsHeight ?? 0;
      availHeight = window.innerHeight - controlsHeightNow - paddingAllowance;
    }

    if (!Number.isFinite(availWidth) || availWidth <= 0) availWidth = safeWidth;
    if (!Number.isFinite(availHeight) || availHeight <= 0) availHeight = safeHeight;

    const scale = Math.min(availWidth / safeWidth, availHeight / safeHeight, 1);
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale)),
    };
  }, [controlsHeight, summaryWidth]);

  useEffect(() => {
    if (!image) return;
    const savedWidth = loadedCanvasState?.canvasWidth ?? 0;
    const savedHeight = loadedCanvasState?.canvasHeight ?? 0;
    const baseWidth = savedWidth > 0 ? savedWidth : image.width;
    const baseHeight = savedHeight > 0 ? savedHeight : image.height;
    if (!baseWidth || !baseHeight) return;
    setCanvasSize(prev => {
      const fitted = computeFittedCanvasSize(baseWidth, baseHeight);
      if (Math.abs(prev.width - fitted.width) < 2 && Math.abs(prev.height - fitted.height) < 2) {
        return prev;
      }
      return fitted;
    });
  }, [controlsHeight, image, loadedCanvasState, computeFittedCanvasSize]);

  // Load image when imageUrl changes
  useEffect(() => {
    console.log('FloorplanCanvas: Loading image from URL:', imageUrl);
    if (!imageUrl) {
      setImage(null);
      setImageLoaded(false);
      setScaleMetadata(null);
      return;
    }

    const loadImage = async () => {
      // Ensure authentication for Firebase Storage URLs
      if (imageUrl.includes('firebasestorage.googleapis.com')) {
        try {
          const { ensureAnonymousAuth } = await import('@/lib/firebaseAuth');
          await ensureAnonymousAuth();
          console.log('FloorplanCanvas: Authentication ensured for Firebase Storage');
        } catch (authError) {
          console.error('FloorplanCanvas: Failed to authenticate for Firebase Storage:', authError);
        }
      }

      setImageLoaded(false);
      const img = new Image();

      img.onload = () => {
        console.log('FloorplanCanvas: Image loaded successfully', { width: img.width, height: img.height });
        setImage(img);

  const savedCanvasWidth = loadedCanvasState?.canvasWidth ?? 0;
  const savedCanvasHeight = loadedCanvasState?.canvasHeight ?? 0;
  const hasSavedCanvasSize = savedCanvasWidth > 0 && savedCanvasHeight > 0;
  const baseWidth = hasSavedCanvasSize ? savedCanvasWidth : img.width;
  const baseHeight = hasSavedCanvasSize ? savedCanvasHeight : img.height;
        const fittedSize = computeFittedCanvasSize(baseWidth, baseHeight);
        setCanvasSize(prev => {
          if (Math.abs((prev?.width || 0) - fittedSize.width) < 2 && Math.abs((prev?.height || 0) - fittedSize.height) < 2) {
            return prev;
          }
          return fittedSize;
        });
        setImageLoaded(true);
      };
      
      img.onerror = (error) => {
        console.error('Failed to load image from URL:', imageUrl, 'Error:', error);
        // Check if it's a Firebase Storage URL
        if (imageUrl.includes('firebasestorage.googleapis.com')) {
          console.error('Firebase Storage URL failed. This might be a CORS or authentication issue.');
          
          // Try to fetch the URL directly to get more detailed error information
          fetch(imageUrl)
            .then(response => {
              console.log('Direct fetch response:', response.status, response.statusText);
              if (!response.ok) {
                return response.text().then(text => {
                  console.error('Fetch response body:', text);
                });
              }
            })
            .catch(fetchError => {
              console.error('Direct fetch failed:', fetchError);
            });
        }
        // Don't clear an already-visible image; only prevent switching
        if (!image) {
          alert('Failed to load image. Please try a different file.');
          setImageLoaded(false);
        }
      };
      
      // Add crossOrigin for Firebase Storage URLs
      if (imageUrl.includes('firebasestorage.googleapis.com')) {
        img.crossOrigin = 'anonymous';
      }
      
      img.src = imageUrl;
    };

    loadImage();
  }, [imageUrl, loadedCanvasState, computeFittedCanvasSize]);

  // Scroll to top and notify parent when ready
  useEffect(() => {
    if (imageLoaded && imageUrl) {
      try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior }); } catch { window.scrollTo(0, 0); }
      onFullscreenChange && onFullscreenChange(true);
    }
  }, [imageLoaded, imageUrl, onFullscreenChange]);

  // Recalculate canvas size on container resize or fullscreen toggle
  useEffect(() => {
    if (!image) return;
    const recalc = () => {
      const savedWidth = loadedCanvasState?.canvasWidth ?? 0;
      const savedHeight = loadedCanvasState?.canvasHeight ?? 0;
      const baseWidth = savedWidth > 0 ? savedWidth : image.width;
      const baseHeight = savedHeight > 0 ? savedHeight : image.height;
      if (!baseWidth || !baseHeight) return;
      setCanvasSize(prev => {
        const fitted = computeFittedCanvasSize(baseWidth, baseHeight);
        if (Math.abs((prev?.width || 0) - fitted.width) < 2 && Math.abs((prev?.height || 0) - fitted.height) < 2) {
          return prev;
        }
        return fitted;
      });
    };
    recalc();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => recalc()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    const onWin = () => recalc();
    window.addEventListener('resize', onWin);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onWin);
    };
  }, [image, loadedCanvasState, computeFittedCanvasSize]);
  // Keep drawings aligned if canvas size changes (e.g., entering fullscreen or UI overlays)
  const prevSizeRef = useRef<{width:number;height:number}>({ width: 0, height: 0 });
  useEffect(() => {
    const prev = prevSizeRef.current;
    const curr = canvasSize;
    const widthChanged = Math.abs(prev.width - curr.width) >= 2;
    const heightChanged = Math.abs(prev.height - curr.height) >= 2;
    if (prev.width > 0 && prev.height > 0 && (widthChanged || heightChanged)) {
      const sx = curr.width / prev.width;
      const sy = curr.height / prev.height;
      if (isFinite(sx) && isFinite(sy) && sx > 0 && sy > 0) {
        setAreas(a => a.map(ar => ({
          ...ar,
          points: ar.points.map(p => ({ x: p.x * sx, y: p.y * sy }))
        })));
        setCurrentArea(ca => ca.map(p => ({ x: p.x * sx, y: p.y * sy })));
        setCalibrationPoints(cp => cp.map(p => ({ x: p.x * sx, y: p.y * sy })));
  setCalibrationAreaPoints(cp => cp.map(p => ({ x: p.x * sx, y: p.y * sy })));
  setPerimeter(pr => pr ? pr.map(p => ({ x: p.x * sx, y: p.y * sy })) : pr);
  setPerimeterRaw(prw => prw ? prw.map(p => ({ x: p.x * sx, y: p.y * sy })) : prw);
  setHoles(hs => hs.map(poly => poly.map(p => ({ x: p.x * sx, y: p.y * sy }))));
  setExcludeCurrent(ec => ec.map(p => ({ x: p.x * sx, y: p.y * sy })));
  setRoi(r => r ? ({ x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy }) : r);
  setSavedAreas(sa => sa.map(poly => poly.map(p => ({ x: p.x * sx, y: p.y * sy }))));
  setSavedExclusions(se => se.map(poly => poly.map(p => ({ x: p.x * sx, y: p.y * sy }))));
        // FIX: Also transform antenna positions during canvas resize
        setAntennas(ants => ants.map(ant => ({
          ...ant,
          position: { x: ant.position.x * sx, y: ant.position.y * sy }
        })));
        setPan(p => ({ x: p.x * sx, y: p.y * sy }));
      }
    }
    prevSizeRef.current = curr;
  }, [canvasSize.width, canvasSize.height]);

  // After image loads (or size changes), if we requested to preserve the view, restore equivalent zoom/pan
  useEffect(() => {
    if (!imageLoaded || !image || !preserveViewRef.current) return;
    const info = preserveViewRef.current;
    preserveViewRef.current = null;
    const baseNew = canvasSize.width > 0 && image.width > 0 ? (canvasSize.width / image.width) : 1;
    const newZoom = Math.min(5, Math.max(0.2, info.compositeScale / baseNew));
    const displayFactorNew = baseNew; // canvasSize.width / image.width
    const cxDisp = Math.max(0, Math.min(image.width, info.centerImg.x)) * displayFactorNew;
    const cyDisp = Math.max(0, Math.min(image.height, info.centerImg.y)) * displayFactorNew;
    const targetPan = {
      x: (canvasSize.width / 2) - newZoom * cxDisp,
      y: (canvasSize.height / 2) - newZoom * cyDisp,
    };
    setZoom(newZoom);
    setPan(targetPan);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageLoaded, image?.src, canvasSize.width, canvasSize.height]);

  // Draw canvas whenever dependencies change
  useEffect(() => {
    if (imageLoaded && image && canvasSize.width > 0) {
      drawCanvas();
    }
  }, [imageLoaded, image, canvasSize, areas, currentArea, mode, calibrationPoints, calibrationAreaPoints, holes, excludeCurrent, autoHolesPreview, zoom, pan, roi, perimeter, antennas, previewAntennas, showCoverage, showRadiusBoundary, antennaRange]);

  useEffect(() => {
    if (!imageLoaded || !image) return;
    const key = image.src;
    if (lastFitImageRef.current === key) return;
    lastFitImageRef.current = key;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [imageLoaded, image]);

  // Show the calibration chooser overlay until the user explicitly picks a mode
  // (Avoid auto-switching to 'calibrate' which could make the overlay flash briefly.)
  useEffect(() => {
    // Intentionally no automatic mode change here; overlay prompts the user.
  }, [imageLoaded, mustCalibrate, mode]);

  // Recompute areas when scale changes
  useEffect(() => {
    if (!image || !scale) return;
    setAreas(prev => prev.map(a => ({
      ...a,
      area: calculateArea(a.points)
    })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, scaleUnit]);

  // Recompute manual total when regions/holes or scale change
  useEffect(() => {
    if (!scale) { setManualResult(null); return; }
    const areaOf = (poly: Point[]) => calculateArea(poly);
    const sumRegions = manualRegions.reduce((s, p) => s + (p.length>=3 ? areaOf(p) : 0), 0);
    const sumHoles = manualHoles.reduce((s, p) => s + (p.length>=3 ? areaOf(p) : 0), 0);
    const total = Math.max(0, sumRegions - sumHoles);
    setManualResult(total);
  }, [manualRegions, manualHoles, scale, scaleUnit]);

  // Notify parent with current canvas state for Save functionality
  useEffect(() => {
    if (!onStateChange) return;
    const currentState = {
      antennas,
      areas,
      scale,
      scaleUnit,
      showCoverage,
      showRadiusBoundary,
      antennaRange,
  scaleMetadata,
      calibrationPoints,
      calibrationAreaPoints,
      calibrationAreaReal,
      perimeter,
      perimeterRaw,
      holes,
      objects,
      autoHolesPreview,
      autoHolesIndex,
      excludeCurrent,
      roi,
      mode,
      manualRegions,
      manualHoles,
      manualResult,
      selections,
      savedAreas,
      savedExclusions,
      zoom,
      pan,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      originalImageWidth: image?.width || 0,
      originalImageHeight: image?.height || 0,
    };
    try { onStateChange(currentState); } catch {}
  }, [onStateChange, antennas, areas, scale, scaleUnit, scaleMetadata, calibrationPoints, calibrationAreaPoints, calibrationAreaReal, perimeter, perimeterRaw, holes, objects, autoHolesPreview, autoHolesIndex, excludeCurrent, roi, mode, manualRegions, manualHoles, manualResult, selections, savedAreas, savedExclusions, zoom, pan, canvasSize.width, canvasSize.height, image]);

  const drawCanvas = () => {
    if (!image || !imageLoaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set canvas size only if it changed
    if (canvas.width !== canvasSize.width || canvas.height !== canvasSize.height) {
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
    }
    
    // Clear canvas
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    
  // Apply pan/zoom
  ctx.save();
  ctx.translate(pan.x, pan.y);
  ctx.scale(zoom, zoom);
  // Draw image scaled to fit canvas
  ctx.drawImage(image, 0, 0, canvasSize.width, canvasSize.height);
    
  // Draw existing areas
    areas.forEach((area, index) => {
      drawArea(area.points, `Area ${index + 1}`, area.area);
    });

    // Draw saved overlays for context
  if (savedAreas.length) {
      ctx.save();
      // Softer, more translucent styling for saved areas
      ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.25)';
      ctx.lineWidth = 1;
      for (let i=0;i<savedAreas.length;i++) {
        const poly = savedAreas[i];
        if (poly.length < 3) continue;
    // Ensure polygon styles are set before each draw in case prior label changed them
    ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.25)';
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i=1;i<poly.length;i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Label index overlay
        const cx = poly.reduce((s,p)=>s+p.x,0)/poly.length;
        const cy = poly.reduce((s,p)=>s+p.y,0)/poly.length;
    // Draw label without leaking styles to next iteration
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'rgba(37,99,235,0.6)';
    ctx.lineWidth = 1.5;
        const text = `${i+1} Area`;
        ctx.font = 'bold 12px Inter, Arial';
        const tw = ctx.measureText(text).width + 10;
        const th = 18;
        ctx.beginPath(); ctx.roundRect?.(cx - tw/2, cy - th/2, tw, th, 6);
        if (!ctx.roundRect) { ctx.rect(cx - tw/2, cy - th/2, tw, th); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
        ctx.fillStyle = 'rgba(37,99,235,1)';
        ctx.fillText(text, cx - tw/2 + 5, cy + 4);
    ctx.restore();
      }
      ctx.restore();
    }
    if (savedExclusions.length) {
      ctx.save();
      // Softer, more translucent styling for saved exclusions
      ctx.fillStyle = 'rgba(220,38,38,0.06)';
      ctx.strokeStyle = 'rgba(220,38,38,0.25)';
      ctx.lineWidth = 1;
      for (let i=0;i<savedExclusions.length;i++) {
        const poly = savedExclusions[i];
        if (poly.length < 3) continue;
    // Ensure polygon styles are set before each draw in case prior label changed them
    ctx.fillStyle = 'rgba(220,38,38,0.06)';
    ctx.strokeStyle = 'rgba(220,38,38,0.25)';
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i=1;i<poly.length;i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Label index overlay (Exclusion number continues after areas)
        const cx = poly.reduce((s,p)=>s+p.x,0)/poly.length;
        const cy = poly.reduce((s,p)=>s+p.y,0)/poly.length;
        const indexOffset = savedAreas.length;
        const text = `${indexOffset + i + 1} Exclusion`;
    // Draw label without leaking styles to next iteration
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'rgba(220,38,38,0.6)';
    ctx.lineWidth = 1.5;
        ctx.font = 'bold 12px Inter, Arial';
        const tw = ctx.measureText(text).width + 10; const th = 18;
        ctx.beginPath(); ctx.roundRect?.(cx - tw/2, cy - th/2, tw, th, 6);
        if (!ctx.roundRect) { ctx.rect(cx - tw/2, cy - th/2, tw, th); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
        ctx.fillStyle = 'rgba(220,38,38,1)';
        ctx.fillText(text, cx - tw/2 + 5, cy + 4);
    ctx.restore();
      }
      ctx.restore();
    }
    
    // Draw manual session regions (blue)
    if (manualRegions.length) {
      ctx.save();
      for (const poly of manualRegions) {
        drawArea(poly);
      }
      ctx.restore();
    }
    // Draw manual session holes (red)
    if (manualHoles.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(220,38,38,0.95)';
      ctx.fillStyle = 'rgba(220,38,38,0.18)';
      ctx.lineWidth = 2;
      for (const h of manualHoles) {
        if (h.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(h[0].x, h[0].y);
        for (let i=1;i<h.length;i++) ctx.lineTo(h[i].x, h[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw current area/path being drawn (with subtle styling and smaller handles)
    if (currentArea.length > 0) {
      // inline draw to control style for in-progress shape
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(currentArea[0].x, currentArea[0].y);
      for (let i=1;i<currentArea.length;i++) ctx.lineTo(currentArea[i].x, currentArea[i].y);
      // Close/fill polygon for select and manual-exclude modes, not for measuring distance
      if ((mode === 'select' || mode === 'manual-exclude') && currentArea.length > 2) {
        ctx.closePath();
        ctx.fillStyle = mode === 'manual-exclude' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.10)'; // Red for exclusions, blue for areas
        ctx.fill();
      }
      ctx.strokeStyle = mode === 'manual-exclude' ? 'rgba(239, 68, 68, 0.8)' : 'rgba(59, 130, 246, 0.6)'; // Red for exclusions, blue for areas
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (mode === 'select' || mode === 'measure' || mode === 'manual-exclude') {
        ctx.fillStyle = 'rgba(37,99,235,0.9)';
        const r = Math.max(2, 4/Math.max(0.2, zoom));
        for (const pt of currentArea) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI*2);
          ctx.fill();
        }

        // Live ruler: show per-segment lengths and cumulative path in Measure mode only
        if (mode === 'measure' && image && scale) {
          const scaleX = image.width / canvasSize.width;
          const scaleY = image.height / canvasSize.height;
          const formatDist = (metersVal: number) => formatDistanceDisplay(metersVal);

          // Helper to draw a small label at a canvas position
          const drawLabel = (x: number, y: number, text: string) => {
            ctx.save();
            ctx.font = `${Math.max(10, Math.round(12/Math.max(0.5, 1)))}px ui-sans-serif, system-ui`;
            const paddingX = 6, paddingY = 3;
            const metrics = ctx.measureText(text);
            const w = Math.ceil(metrics.width) + paddingX*2;
            const h = 16 + paddingY*2;
            const rx = 4;
            const bx = x - w/2;
            const by = y - h - 6;
            // rounded rect background
            ctx.beginPath();
            ctx.moveTo(bx+rx, by);
            ctx.arcTo(bx+w, by, bx+w, by+h, rx);
            ctx.arcTo(bx+w, by+h, bx, by+h, rx);
            ctx.arcTo(bx, by+h, bx, by, rx);
            ctx.arcTo(bx, by, bx+w, by, rx);
            ctx.closePath();
            ctx.fillStyle = 'rgba(17,24,39,0.85)';
            ctx.fill();
            // text
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, bx + paddingX, by + h - paddingY - 4);
            ctx.restore();
          };

          // Per-segment labels and cumulative path
          let totalUnits = 0;
          for (let i = 1; i < currentArea.length; i++) {
            const a = currentArea[i-1];
            const b = currentArea[i];
            const dx = (b.x - a.x) * scaleX;
            const dy = (b.y - a.y) * scaleY;
            const segMeters = Math.hypot(dx, dy) * scale; // scale is meters per pixel
            totalUnits += segMeters;
            // mid-point for label in canvas coords
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            drawLabel(mx, my, formatDist(segMeters));
          }

          // Show cumulative path near the last point
          const last = currentArea[currentArea.length - 1];
          drawLabel(last.x, last.y, `Path: ${formatDist(totalUnits)}`);
        }
      }
      ctx.restore();
    }
    // Draw current exclusion polygon being drawn (subtle red styling)
    if (excludeCurrent.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(excludeCurrent[0].x, excludeCurrent[0].y);
      for (let i=1;i<excludeCurrent.length;i++) ctx.lineTo(excludeCurrent[i].x, excludeCurrent[i].y);
      if (excludeCurrent.length > 2) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(220,38,38,0.08)';
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(220,38,38,0.6)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // Draw calibration-by-area polygon (precise styling)
    if (calibrationAreaPoints.length > 0) {
      ctx.save();
      // Thin stroke and subtle fill for precision
      ctx.fillStyle = 'rgba(234, 88, 12, 0.12)';
      ctx.strokeStyle = 'rgba(234, 88, 12, 0.9)';
      ctx.lineWidth = 1;
      const pts = calibrationAreaPoints;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (pts.length > 2) ctx.closePath();
      if (pts.length > 2) ctx.fill();
      ctx.stroke();
      if (mode === 'calibrate-area') {
        ctx.fillStyle = 'rgba(234,88,12,0.95)';
        const r = Math.max(2, 3/Math.max(0.2, zoom));
        for (const pt of pts) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI*2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

  // Draw calibration points/line
    if (calibrationPoints.length > 0) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.strokeStyle = 'rgba(234,88,12,1)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(calibrationPoints[0].x, calibrationPoints[0].y, 5, 0, 2*Math.PI);
      ctx.stroke();
      if (calibrationPoints[1]) {
        ctx.beginPath();
        ctx.moveTo(calibrationPoints[0].x, calibrationPoints[0].y);
        ctx.lineTo(calibrationPoints[1].x, calibrationPoints[1].y);
        ctx.stroke();
      }
  }

  // Draw ROI rectangle (in world coords)
  if (roi) {
    ctx.save();
    ctx.strokeStyle = 'rgba(56,189,248,0.95)';
    ctx.setLineDash([6,4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
    ctx.restore();
  }

  // Draw detected perimeter polygon
  if (perimeter && perimeter.length >= 3) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,123,0,0.15)';
    ctx.strokeStyle = 'rgba(255,123,0,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(perimeter[0].x, perimeter[0].y);
    for (let i=1;i<perimeter.length;i++) ctx.lineTo(perimeter[i].x, perimeter[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  // draw handles when editing or refining
  if (mode === 'edit-poly' || mode === 'refine') {
      ctx.fillStyle = 'rgba(255,123,0,0.95)';
      perimeter.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(3, 6/Math.max(0.2, zoom)), 0, Math.PI*2);
        ctx.fill();
      });
    }
    ctx.restore();
  }

  // Draw holes (excluded areas)
  if (holes.length) {
    ctx.save();
    ctx.strokeStyle = 'rgba(220,38,38,0.95)';
    ctx.fillStyle = 'rgba(220,38,38,0.18)';
    ctx.lineWidth = 2;
    for (let hi=0; hi<holes.length; hi++) {
      const h = holes[hi];
      if (h.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(h[0].x, h[0].y);
      for (let i=1;i<h.length;i++) ctx.lineTo(h[i].x, h[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
  if ((mode === 'edit-hole' || mode === 'refine') && (editHoleIndex === null || editHoleIndex === hi)) {
        ctx.save();
        ctx.fillStyle = 'rgba(220,38,38,0.95)';
        for (const pt of h) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, Math.max(3, 5/Math.max(0.2, zoom)), 0, Math.PI*2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }
  // Draw auto-detected holes preview (dashed outline)
  if (autoHolesPreview.length) {
    ctx.save();
    for (let i=0;i<autoHolesPreview.length;i++) {
      const h = autoHolesPreview[i];
      if (h.length < 3) continue;
      const selected = i === autoHolesIndex;
      ctx.strokeStyle = selected ? 'rgba(245,158,11,1)' : 'rgba(234,179,8,0.9)';
      ctx.setLineDash(selected ? [10,6] : [5,4]);
      ctx.lineWidth = selected ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(h[0].x, h[0].y);
      for (let i=1;i<h.length;i++) ctx.lineTo(h[i].x, h[i].y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }
  
  // Draw preview antennas (semi-transparent)
  if (previewAntennas.length > 0 && antennas.length === 0) {
    console.log('🟣 DRAWING: Drawing', previewAntennas.length, 'preview antennas');
    ctx.save();
    ctx.globalAlpha = 0.5; // Semi-transparent
    
    // Draw preview coverage areas
    if (showCoverage) {
      for (const antenna of previewAntennas) {
        const { x, y } = antenna.position;
        const range = antenna.range;
        const radiusInPixels = range / (scale || 1);
        const visibleRadius = Math.max(radiusInPixels, 20);
        
        // Draw preview coverage circle (lighter green)
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, visibleRadius);
        gradient.addColorStop(0, 'rgba(100, 255, 100, 0.3)');
        gradient.addColorStop(0.5, 'rgba(150, 255, 150, 0.2)');
        gradient.addColorStop(1, 'rgba(200, 255, 200, 0.1)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, visibleRadius, 0, 2 * Math.PI);
        ctx.fill();
        
        // Draw preview boundary
        ctx.strokeStyle = 'rgba(100, 200, 100, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]); // Dashed line for preview
        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash
      }
    }
    
    // Draw preview antenna icons
    for (const antenna of previewAntennas) {
      const { x, y } = antenna.position;
      
      // Draw antenna icon (lighter/dashed)
      ctx.strokeStyle = 'rgba(80, 80, 80, 0.6)';
      ctx.fillStyle = 'rgba(120, 120, 120, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      
      // Draw preview antenna square
      ctx.fillRect(x - 6, y - 6, 12, 12);
      ctx.strokeRect(x - 6, y - 6, 12, 12);
      ctx.setLineDash([]);
    }
    
    ctx.restore();
  } else {
    console.log('🟣 DRAWING: NOT drawing preview antennas. Preview count:', previewAntennas.length, 'Actual antenna count:', antennas.length);
  }

  // Draw antennas and coverage
  if (antennas.length > 0) {
    // console.log("Drawing antennas:", antennas.length, "antennas found");
    ctx.save();
    
    // Draw coverage areas first (underneath the antenna icons)
    if (showCoverage && antennas.length > 0) {
      // console.log("Coverage display enabled, drawing", antennas.length, "antennas");
      for (const antenna of antennas) {
        const { x, y } = antenna.position;
        const range = antenna.range;
        const power = (antenna.power || 50) / 100; // convert to 0-1 scale, default 50%
        
        // Calculate the radius in pixels - Apply coordinate system transformation
        // The scale is in image coordinates, but antenna positions are in canvas coordinates
        const scaleX = image ? image.width / canvasSize.width : 1;
        
        // Convert range from meters to image pixels, then to canvas pixels for drawing
        const radiusInImagePixels = range / (scale || 1);
        const radiusInPixels = radiusInImagePixels / scaleX;
        // console.log(`Antenna at (${x}, ${y}) - Range ${range}m converted to ${radiusInPixels.toFixed(2)} pixels with scale ${scale}`);
        
        // Use the correctly transformed radius
        const visibleRadius = radiusInPixels;
        
        // Check if the point is in an exclusion zone before drawing
        let isInExclusion = false;
        
        // Check all exclusion areas (holes)
        if (holes.length > 0) {
          isInExclusion = holes.some(hole => isPointInPolygon({ x, y }, hole));
        }
        
        // Check manually excluded areas
        if (!isInExclusion && manualHoles.length > 0) {
          isInExclusion = manualHoles.some(hole => isPointInPolygon({ x, y }, hole));
        }
        
        // Skip this antenna if it's in an exclusion zone
        if (isInExclusion) {
          console.log(`Skipping antenna at (${x}, ${y}) - in exclusion zone`);
          continue;
        }
        
        // Create a green gradient for signal strength visualization - VERY VISIBLE
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, visibleRadius);
        gradient.addColorStop(0, `rgba(0, 200, 0, ${Math.max(0.8, 0.9 * power)})`); // Very dark green center, more opaque
        gradient.addColorStop(0.3, `rgba(50, 255, 50, ${Math.max(0.6, 0.7 * power)})`); // Bright green
        gradient.addColorStop(0.6, `rgba(100, 255, 100, ${Math.max(0.5, 0.5 * power)})`); // Light bright green  
        gradient.addColorStop(0.9, `rgba(150, 255, 150, ${Math.max(0.3, 0.3 * power)})`); // Very light green
        gradient.addColorStop(1, `rgba(150, 255, 150, ${Math.max(0.2, 0.15 * power)})`); // Still visible at edge
        
        ctx.beginPath();
        ctx.arc(x, y, visibleRadius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        // console.log(`Drew coverage circle at (${x}, ${y}) with radius ${visibleRadius}px, power ${power}`);
        
        // Draw range indicator circle if enabled
        if (showRadiusBoundary) {
          ctx.beginPath();
          ctx.arc(x, y, visibleRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(20, 83, 45, ${Math.max(0.7, 0.8 * power)})`; // Dark green border, more visible
          ctx.lineWidth = 2; // Thicker line
          ctx.setLineDash([5, 5]); // Dotted line
          ctx.stroke();
          ctx.setLineDash([]);
        }
        
        // Display the range value in meters
        const textX = x + visibleRadius * 0.7;
        const textY = y - visibleRadius * 0.7;
        
        // Draw text with background for better visibility
        ctx.font = 'bold 14px Arial';
        // Skip range text display on circles - we know the range from the control panel
        // const rangeText = `${range}m`;
        // const textWidth = ctx.measureText(rangeText).width;
        
        // Text background
        // ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        // ctx.fillRect(textX - 4, textY - 14, textWidth + 8, 18);
        
        // Text
        // ctx.fillStyle = 'rgba(20, 83, 45, 0.9)'; // Dark green text
        // ctx.fillText(rangeText, textX, textY);
      }
    } else if (antennas.length === 0) {
      console.log("No antennas to display");
    } else {
      console.log("Coverage display disabled but", antennas.length, "antennas exist");
    }
    
    // Draw antenna icons on top
    if (antennas.length > 0) {
      // console.log("Drawing", antennas.length, "antenna icons");
    }
    for (const antenna of antennas) {
      const { x, y } = antenna.position;
      const isSelected = antenna.id === selectedAntennaId;

      // Draw Wi-Fi style antenna symbol - cleaner and more recognizable
      const iconSize = 14; // Optimal size for visibility and clarity      // Draw circular background for contrast
      ctx.fillStyle = isSelected ? 'rgba(255, 140, 0, 0.95)' : 'rgba(59, 130, 246, 0.95)'; // Orange when selected, blue otherwise
      ctx.beginPath();
      ctx.arc(x, y, iconSize/2 + 2, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw white border for definition
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, iconSize/2 + 2, 0, 2 * Math.PI);
      ctx.stroke();
      
      // Draw Wi-Fi symbol - three concentric arcs
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      
      // Center dot
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fill();
      
      // Three signal arcs of increasing size
      for (let i = 1; i <= 3; i++) {
        const arcRadius = i * 3;
        const startAngle = -Math.PI * 0.25; // Start from top-left
        const endAngle = Math.PI * 0.25;    // End at top-right
        
        ctx.beginPath();
        ctx.arc(x, y, arcRadius, startAngle, endAngle);
        ctx.stroke();
        
        // Mirror arc on the bottom
        ctx.beginPath();
        ctx.arc(x, y, arcRadius, Math.PI - endAngle, Math.PI - startAngle);
        ctx.stroke();
      }
      
      // Add signal waves for extra visibility
      if (!showCoverage) { // Only show waves when coverage circles are off
        ctx.strokeStyle = isSelected ? 'rgba(255, 100, 0, 0.6)' : 'rgba(30, 144, 255, 0.6)';
        ctx.lineWidth = 1.5;
        for (let i = 1; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(x, y, iconSize/2 + 2 + i * 4, -Math.PI/4, Math.PI/4);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, iconSize/2 + 2 + i * 4, 3*Math.PI/4, 5*Math.PI/4);
          ctx.stroke();
        }
      }
    }
    
    ctx.restore();
  }
  ctx.restore();
  };

  const drawArea = (points: Point[], label?: string, area?: number) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    if (points.length > 2) {
      ctx.closePath();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.10)';
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw points
    points.forEach(point => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgb(239, 68, 68)';
      ctx.fill();
    });

    // Draw label and area
  if (label && points.length > 0) {
      const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

  ctx.fillStyle = 'black';
  ctx.font = '14px Arial';
      ctx.fillText(label, centerX, centerY - 10);

  if (typeof area === 'number') {
  ctx.fillText(`${formatAreaDisplay(area)}`, centerX, centerY + 10);
      }
    }
  };

  const calculateArea = (points: Point[]): number => {
    if (points.length < 3 || !scale) return 0;
    
    // Convert canvas coordinates back to image coordinates
    const scaleX = image ? image.width / canvasSize.width : 1;
    const scaleY = image ? image.height / canvasSize.height : 1;
    
    // Use shoelace formula with scaled coordinates
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const x1 = points[i].x * scaleX;
      const y1 = points[i].y * scaleY;
      const x2 = points[j].x * scaleX;
      const y2 = points[j].y * scaleY;
      
      area += x1 * y2 - x2 * y1;
    }
    area = Math.abs(area) / 2;
    
    // Convert from pixels to real area in square meters (scale is meters per pixel)
    return area * scale * scale;
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (mustCalibrate && mode !== 'calibrate' && mode !== 'calibrate-area') {
  alert('Please calibrate first (Calibrate Distance or Calibrate Area).');
      setMode('calibrate');
      return;
    }
    const btn = (event.nativeEvent as MouseEvent).button;
    if (btn !== 0) return; // only left click
  if (isPanningRef.current || suppressClickRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas || !imageLoaded) return;
    const rect = canvas.getBoundingClientRect();
    let x = (event.clientX - rect.left) * (canvas.width / rect.width);
    let y = (event.clientY - rect.top) * (canvas.height / rect.height);
    x = (x - pan.x) / zoom;
    y = (y - pan.y) / zoom;
    // Shift: snap for calibrate-area to nearest axis/45° relative to previous point
    if (event.shiftKey && mode === 'calibrate-area' && calibrationAreaPoints.length) {
      const last = calibrationAreaPoints[calibrationAreaPoints.length-1];
      const dx = x - last.x, dy = y - last.y;
      const ang = Math.atan2(dy, dx);
      const step = Math.PI/4; // 45°
      const snapped = Math.round(ang / step) * step;
      const len = Math.hypot(dx, dy);
      x = last.x + Math.cos(snapped) * len;
      y = last.y + Math.sin(snapped) * len;
    }
  if ((mode === 'edit-poly' || mode === 'refine') && perimeter && perimeter.length) {
      const isAlt = event.altKey === true;
      const isCtrl = event.ctrlKey === true || event.metaKey === true;
      const p: Point = { x, y };
      const thr = 10 / Math.max(0.2, zoom);
      if (isAlt) {
        const idx = findClosestVertexIndex(p, perimeter);
        if (idx >= 0 && distance(p, perimeter[idx]) <= thr && perimeter.length > 3) {
      pushHistory();
          const next = perimeter.slice(); next.splice(idx, 1); setPerimeter(next);
        }
        return;
      }
      if (isCtrl) {
        const r = findClosestEdgeIndex(p, perimeter);
        if (r.index >= 0 && r.dist <= thr) {
      pushHistory();
          const next = perimeter.slice(); next.splice(r.index+1, 0, p); setPerimeter(next);
        }
        return;
      }
      return;
    }
  if (mode === 'exclude') {
      const newPoint = { x, y };
    pushHistory();
    setExcludeCurrent(prev => [...prev, newPoint]);
  } else if ((mode === 'edit-hole' || mode === 'refine') && holes.length) {
      // Alt delete vertex; Ctrl insert on closest edge of the targeted hole
      const isAlt = event.altKey === true;
      const isCtrl = event.ctrlKey === true || event.metaKey === true;
      const thr = 10 / Math.max(0.2, zoom);
      // Choose active hole (either selected index, or nearest hole by vertex proximity)
      let hi = editHoleIndex ?? -1;
      if (hi < 0) {
        let bestHi = -1, bestD = Infinity;
        for (let i=0;i<holes.length;i++) {
          const idx = findClosestVertexIndex({x,y}, holes[i]);
          const d = idx>=0 ? distance({x,y}, holes[i][idx]) : Infinity;
          if (d < bestD) { bestD = d; bestHi = i; }
        }
        hi = bestHi >= 0 ? bestHi : 0;
      }
      const hpoly = holes[hi];
      if (!hpoly) return;
      if (isAlt) {
        const vi = findClosestVertexIndex({x,y}, hpoly);
        if (vi >= 0 && distance({x,y}, hpoly[vi]) <= thr && hpoly.length > 3) {
          pushHistory();
          const next = holes.map(h=>h.slice());
          next[hi].splice(vi,1);
          setHoles(next);
          return;
        }
      }
      if (isCtrl) {
        const r = findClosestEdgeIndex({x,y}, hpoly);
        if (r.index >= 0 && r.dist <= thr) {
          pushHistory();
          const next = holes.map(h=>h.slice());
          next[hi].splice(r.index+1, 0, {x,y});
          setHoles(next);
          return;
        }
      }
  } else if (mode === 'select' || mode === 'manual-exclude' || mode === 'measure') {
      // Support Refine-like edits while drawing: Alt to delete vertex, Ctrl to insert on closest edge
      const isAlt = event.altKey === true;
      const isCtrl = event.ctrlKey === true || event.metaKey === true;
      const p: Point = { x, y };
      const thr = 10 / Math.max(0.2, zoom);
      if (isAlt && currentArea.length) {
        const idx = findClosestVertexIndex(p, currentArea);
        if (idx >= 0 && distance(p, currentArea[idx]) <= thr && currentArea.length > 0) {
      pushHistory();
      const next = currentArea.slice(); next.splice(idx, 1); setCurrentArea(next);
          return;
        }
      }
      if (isCtrl && currentArea.length >= 2) {
        const r = findClosestEdgeIndex(p, currentArea);
        if (r.index >= 0 && r.dist <= thr) {
      pushHistory();
      const next = currentArea.slice(); next.splice(r.index+1, 0, p); setCurrentArea(next);
          return;
        }
      }
  const newPoint = { x, y };
  pushHistory();
  setCurrentArea([...currentArea, newPoint]);
    } else if (mode === 'calibrate') {
      const p = { x, y };
      if (calibrationPoints.length < 2) {
    pushHistory();
    setCalibrationPoints(prev => [...prev, p]);
      } else {
    pushHistory();
    setCalibrationPoints([p]);
      }
    } else if (mode === 'calibrate-area') {
      // Editing behaviors: Alt delete, Ctrl insert; else append
      const isAlt = event.altKey === true;
      const isCtrl = event.ctrlKey === true || event.metaKey === true;
      const p: Point = { x, y };
      const thr = 10 / Math.max(0.2, zoom);
      if (isAlt && calibrationAreaPoints.length) {
        const idx = findClosestVertexIndex(p, calibrationAreaPoints);
        if (idx >= 0 && distance(p, calibrationAreaPoints[idx]) <= thr && calibrationAreaPoints.length > 0) {
      pushHistory();
      const next = calibrationAreaPoints.slice(); next.splice(idx, 1); setCalibrationAreaPoints(next);
          return;
        }
      }
      if (isCtrl && calibrationAreaPoints.length >= 2) {
        const r = findClosestEdgeIndex(p, calibrationAreaPoints);
        if (r.index >= 0 && r.dist <= thr) {
      pushHistory();
      const next = calibrationAreaPoints.slice(); next.splice(r.index+1, 0, p); setCalibrationAreaPoints(next);
          return;
        }
      }
    pushHistory();
    setCalibrationAreaPoints(prev => [...prev, p]);
    } else if (mode === 'antenna') {
      const p = { x, y };
      const isAlt = event.altKey === true;
      const isCtrl = event.ctrlKey === true || event.metaKey === true;
      const thr = 15 / Math.max(0.2, zoom); // Slightly larger threshold for antennas
      
      // Alt + click: remove antenna
      if (isAlt) {
        for (let i = 0; i < antennas.length; i++) {
          const antenna = antennas[i];
          const d = Math.hypot(p.x - antenna.position.x, p.y - antenna.position.y);
          if (d <= thr) {
            pushHistory();
            const newAntennas = antennas.filter(a => a.id !== antenna.id);
            setAntennas(newAntennas);
            if (selectedAntennaId === antenna.id) {
              setSelectedAntennaId(null);
            }
            return;
          }
        }
      }
      
      // Ctrl + click: select antenna for editing
      if (isCtrl) {
        for (let i = 0; i < antennas.length; i++) {
          const antenna = antennas[i];
          const d = Math.hypot(p.x - antenna.position.x, p.y - antenna.position.y);
          if (d <= thr) {
            setSelectedAntennaId(selectedAntennaId === antenna.id ? null : antenna.id);
            return;
          }
        }
        setSelectedAntennaId(null);
        return;
      }
      
      // Regular click: place new antenna (dragging handles moving)
      let clickedAntenna = null;
      for (let i = 0; i < antennas.length; i++) {
        const antenna = antennas[i];
        const d = Math.hypot(p.x - antenna.position.x, p.y - antenna.position.y);
        if (d <= thr) {
          clickedAntenna = antenna;
          break;
        }
      }
      
      if (clickedAntenna) {
        // Just select the antenna (dragging handles moving)
        setSelectedAntennaId(clickedAntenna.id);
      } else {
        // Place new antenna
        pushHistory();
        const newAntenna: Antenna = {
          id: Date.now().toString(),
          position: p,
          range: antennaRange,
          power: 50 // Fixed power value
        };
        setAntennas([...antennas, newAntenna]);
        setSelectedAntennaId(newAntenna.id);
      }
    }
  };

  const addSelection = () => {
    console.log('🟡 ADD SELECTION: Called with mode =', mode);
    console.log('🟡 ADD SELECTION: currentArea.length =', currentArea.length);
    console.log('🟡 ADD SELECTION: excludeCurrent.length =', excludeCurrent.length);
    console.log('🟡 ADD SELECTION: perimeter?.length =', perimeter?.length || 0);
    console.log('🟡 ADD SELECTION: autoHolesPreview.length =', autoHolesPreview.length);
    
    if (mustCalibrate) {
      alert('Please calibrate first (Calibrate Distance or Calibrate Area).');
      setMode('calibrate');
      return;
    }
    // Manual session: convert any in-progress polygon into regions (or holes if manual-exclude)
    // Exclude Auto: commit selected preview hole as a negative selection
    if (mode === 'pick-hole' && autoHolesPreview.length && autoHolesIndex >= 0) {
      const holePoly = autoHolesPreview[autoHolesIndex];
      if (holePoly && holePoly.length >= 3) {
        pushHistory();
        const val = -calculateArea(holePoly);
  setSelections(list => [...list, { id: Date.now().toString(), value: val, label: 'Area' }]);
        // Keep visual context
        setSavedExclusions(arr => [...arr, holePoly.map(p=>({...p}))]);
      }
      // Reset interactive state so new object starts clean
  setAutoHolesPreview([]);
  setAutoHolesIndex(-1);
  setRoi(null);
  setPerimeter(null);
  setPerimeterRaw(null);
  setPerimeterConfidence(null);
  setHoles([]);
  setExcludeCurrent([]);
  setCurrentArea([]);
  // Stay in pick-hole (Exclude Auto) mode for consecutive adds
      return;
    }
    // Detected object: add net area
    if (perimeter && perimeter.length >= 3) {
      if (mode === 'exclude' && excludeCurrent.length >= 3) {
        pushHistory();
        setHoles(h => [...h, excludeCurrent.slice()]);
        setExcludeCurrent([]);
      }
      const a = calculateArea(perimeter);
      const ha = holes.reduce((s,h)=> s + (h.length>=3 ? calculateArea(h) : 0), 0);
      const net = Math.max(0, a - ha);
    pushHistory();
  setSelections(list => [...list, { id: Date.now().toString(), value: net, label: 'Area' }]);
      // Persist overlays for context without clearing on Add
      setSavedAreas(arr => [...arr, perimeter.map(p=>({...p}))]);
      if (holes.length) setSavedExclusions(arr => [...arr, ...holes.map(h=>h.map(p=>({...p})))]);
    // Reset interactive state so next object starts clean
  setPerimeter(null);
  setPerimeterRaw(null);
  setPerimeterConfidence(null);
  setHoles([]);
  setExcludeCurrent([]);
  setRoi(null);
  // Keep current mode; do not force 'select' here
    return;
    }
    // Manual polygon: add positive (area) or negative (exclusion)
    if (currentArea.length >= 3) {
      console.log('🟡 ADD SELECTION: Processing currentArea with', currentArea.length, 'points in mode', mode);
      const val = calculateArea(currentArea) * (mode === 'manual-exclude' ? -1 : 1);
      console.log('🟡 ADD SELECTION: Calculated area value =', val);
    pushHistory();
  setSelections(list => [...list, { id: Date.now().toString(), value: val, label: 'Area' }]);
      // Keep polygon on screen as overlay
      if (mode === 'manual-exclude') {
        console.log('🟡 ADD SELECTION: Adding to savedExclusions:', currentArea);
        setSavedExclusions(arr => {
          const newExclusions = [...arr, currentArea.map(p=>({...p}))];
          console.log('🟡 ADD SELECTION: New savedExclusions array:', newExclusions);
          return newExclusions;
        });
      } else {
        console.log('🟡 ADD SELECTION: Adding to savedAreas:', currentArea);
        setSavedAreas(arr => [...arr, currentArea.map(p=>({...p}))]);
      }
    // Reset interactive state for a fresh start
    setCurrentArea([]);
    setExcludeCurrent([]);
    // Stay in manual-exclude to allow consecutive exclusions; otherwise default to select
    if (mode !== 'manual-exclude') {
      setMode('select');
    }
      return;
    }
    alert('Nothing to add. Draw an area or detect one first.');
  };

  const clearAll = () => {
    pushHistory();
    setAreas([]);
    setCurrentArea([]);
    setCalibrationPoints([]);
    setCalibrationAreaPoints([]);
    setCalibrationAreaReal('');
    setScaleMetadata(null);
    setPerimeter(null);
    setPerimeterRaw(null);
    setPerimeterConfidence(null);
    setHoles([]);
    setObjects([]);
    setJustSavedObject(false);
    setAutoHolesPreview([]);
    setAutoHolesIndex(-1);
    setExcludeCurrent([]);
    setRoi(null);
    setManualRegions([]);
    setManualHoles([]);
    setManualResult(null);
  setSelections([]);
    setSavedAreas([]);
    setSavedExclusions([]);
    setMode('select');
  };

  function pushHistory() {
    const snap: Snapshot = {
      areas: areas.map(a => ({ id: a.id, points: a.points.map(p=>({...p})), area: a.area })),
      currentArea: currentArea.map(p=>({...p})),
      // persist scale value inside history snapshot for consistency
      // (not used by undo directly, but included in parent save payload)
      calibrationPoints: calibrationPoints.map(p=>({...p})),
      calibrationAreaPoints: calibrationAreaPoints.map(p=>({...p})),
      calibrationAreaReal,
  scaleMetadata: scaleMetadata ? { ...scaleMetadata } : null,
      perimeter: perimeter ? perimeter.map(p=>({...p})) : null,
      perimeterRaw: perimeterRaw ? perimeterRaw.map(p=>({...p})) : null,
      holes: holes.map(h => h.map(p=>({...p}))),
      objects: objects.map(o => ({ id: o.id, name: o.name, perimeter: o.perimeter.map(p=>({...p})), holes: o.holes.map(h=>h.map(p=>({...p}))) })),
      justSavedObject,
      autoHolesPreview: autoHolesPreview.map(h=>h.map(p=>({...p}))),
      autoHolesIndex,
      antennas: antennas.map(a => ({ ...a, position: { ...a.position } })),
      excludeCurrent: excludeCurrent.map(p=>({...p})),
      roi: roi ? { ...roi } : null,
      mode,
      manualRegions: manualRegions.map(r=> r.map(p=>({...p}))),
      manualHoles: manualHoles.map(r=> r.map(p=>({...p}))),
      manualResult,
      selections: selections.map(s => ({ ...s })),
      savedAreas: savedAreas.map(poly => poly.map(p=>({...p}))),
      savedExclusions: savedExclusions.map(poly => poly.map(p=>({...p}))),
      zoom,
      pan,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
    };
    historyRef.current.push(snap);
    if (historyRef.current.length > 50) historyRef.current.shift();
    
    // Clear redo history when new action is performed
    redoHistoryRef.current = [];
  }
  
  const undo = () => {
    const last = historyRef.current.pop();
    if (!last) return;
    
    // Save current state to redo history before applying undo
    const currentSnap: Snapshot = {
      areas: areas.map(a => ({ id: a.id, points: a.points.map(p=>({...p})), area: a.area })),
      currentArea: currentArea.map(p=>({...p})),
      calibrationPoints: calibrationPoints.map(p=>({...p})),
      calibrationAreaPoints: calibrationAreaPoints.map(p=>({...p})),
      calibrationAreaReal,
  scaleMetadata: scaleMetadata ? { ...scaleMetadata } : null,
      perimeter: perimeter ? perimeter.map(p=>({...p})) : null,
      perimeterRaw: perimeterRaw ? perimeterRaw.map(p=>({...p})) : null,
      holes: holes.map(h => h.map(p=>({...p}))),
      objects: objects.map(o => ({ id: o.id, name: o.name, perimeter: o.perimeter.map(p=>({...p})), holes: o.holes.map(h=>h.map(p=>({...p}))) })),
      justSavedObject,
      autoHolesPreview: autoHolesPreview.map(h=>h.map(p=>({...p}))),
      autoHolesIndex,
      antennas: antennas.map(a => ({ ...a, position: { ...a.position } })),
      excludeCurrent: excludeCurrent.map(p=>({...p})),
      roi: roi ? { ...roi } : null,
      mode,
      manualRegions: manualRegions.map(r=> r.map(p=>({...p}))),
      manualHoles: manualHoles.map(r=> r.map(p=>({...p}))),
      manualResult,
      selections: selections.map(s => ({ ...s })),
      savedAreas: savedAreas.map(poly => poly.map(p=>({...p}))),
      savedExclusions: savedExclusions.map(poly => poly.map(p=>({...p}))),
      zoom,
      pan,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
    };
    redoHistoryRef.current.push(currentSnap);
    if (redoHistoryRef.current.length > 50) redoHistoryRef.current.shift();
    
    // Apply the undo state
    setAreas(last.areas);
    setCurrentArea(last.currentArea);
    setCalibrationPoints(last.calibrationPoints);
    setCalibrationAreaPoints(last.calibrationAreaPoints);
    setCalibrationAreaReal(last.calibrationAreaReal);
    setPerimeter(last.perimeter);
    setPerimeterRaw(last.perimeterRaw);
    setHoles(last.holes);
    setObjects(last.objects);
    setJustSavedObject(last.justSavedObject);
    setAutoHolesPreview(last.autoHolesPreview);
    setAutoHolesIndex(last.autoHolesIndex);
    setAntennas(last.antennas);
    setExcludeCurrent(last.excludeCurrent);
    setRoi(last.roi);
    setManualRegions(last.manualRegions);
    setManualHoles(last.manualHoles);
    setManualResult(last.manualResult);
    setMode(last.mode);
    setSelections(last.selections);
    setSavedAreas(last.savedAreas);
    setSavedExclusions(last.savedExclusions);
  setScaleMetadata(last.scaleMetadata || null);
  };

  // Update undo ref when function changes
  useEffect(() => {
    undoRef.current = undo;
  }, [areas, currentArea, calibrationPoints, calibrationAreaPoints, calibrationAreaReal, scaleMetadata, perimeter, perimeterRaw, holes, objects, justSavedObject, autoHolesPreview, autoHolesIndex, antennas, excludeCurrent, roi, mode, manualRegions, manualHoles, manualResult, selections, savedAreas, savedExclusions]);

  const redo = () => {
    console.log('Redo function called');
    const next = redoHistoryRef.current.pop();
    if (!next) {
      console.log('No redo history available');
      return;
    }
    
    console.log('Applying redo...', next);
    
    // Save current state to undo history before applying redo
    const currentSnap: Snapshot = {
      areas: areas.map(a => ({ id: a.id, points: a.points.map(p=>({...p})), area: a.area })),
      currentArea: currentArea.map(p=>({...p})),
      calibrationPoints: calibrationPoints.map(p=>({...p})),
      calibrationAreaPoints: calibrationAreaPoints.map(p=>({...p})),
      calibrationAreaReal,
  scaleMetadata: scaleMetadata ? { ...scaleMetadata } : null,
      perimeter: perimeter ? perimeter.map(p=>({...p})) : null,
      perimeterRaw: perimeterRaw ? perimeterRaw.map(p=>({...p})) : null,
      holes: holes.map(h => h.map(p=>({...p}))),
      objects: objects.map(o => ({ id: o.id, name: o.name, perimeter: o.perimeter.map(p=>({...p})), holes: o.holes.map(h=>h.map(p=>({...p}))) })),
      justSavedObject,
      autoHolesPreview: autoHolesPreview.map(h=>h.map(p=>({...p}))),
      autoHolesIndex,
      antennas: antennas.map(a => ({ ...a, position: { ...a.position } })),
      excludeCurrent: excludeCurrent.map(p=>({...p})),
      roi: roi ? { ...roi } : null,
      mode,
      manualRegions: manualRegions.map(r=> r.map(p=>({...p}))),
      manualHoles: manualHoles.map(r=> r.map(p=>({...p}))),
      manualResult,
      selections: selections.map(s => ({ ...s })),
      savedAreas: savedAreas.map(poly => poly.map(p=>({...p}))),
      savedExclusions: savedExclusions.map(poly => poly.map(p=>({...p}))),
      zoom,
      pan,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
    };
    historyRef.current.push(currentSnap);
    if (historyRef.current.length > 50) historyRef.current.shift();
    
    // Apply the redo state
    setAreas(next.areas);
    setCurrentArea(next.currentArea);
    setCalibrationPoints(next.calibrationPoints);
    setCalibrationAreaPoints(next.calibrationAreaPoints);
    setCalibrationAreaReal(next.calibrationAreaReal);
    setPerimeter(next.perimeter);
    setPerimeterRaw(next.perimeterRaw);
    setHoles(next.holes);
    setObjects(next.objects);
    setJustSavedObject(next.justSavedObject);
    setAutoHolesPreview(next.autoHolesPreview);
    setAutoHolesIndex(next.autoHolesIndex);
    setAntennas(next.antennas);
    setExcludeCurrent(next.excludeCurrent);
    setRoi(next.roi);
    setManualRegions(next.manualRegions);
    setManualHoles(next.manualHoles);
    setManualResult(next.manualResult);
    setMode(next.mode);
    setSelections(next.selections);
    setSavedAreas(next.savedAreas);
    setSavedExclusions(next.savedExclusions);
  setScaleMetadata(next.scaleMetadata || null);
  };

  // Update redo ref when function changes
  useEffect(() => {
    redoRef.current = redo;
  }, [areas, currentArea, calibrationPoints, calibrationAreaPoints, calibrationAreaReal, scaleMetadata, perimeter, perimeterRaw, holes, objects, justSavedObject, autoHolesPreview, autoHolesIndex, antennas, excludeCurrent, roi, mode, manualRegions, manualHoles, manualResult, selections, savedAreas, savedExclusions]);

  // Restore loaded canvas state with coordinate scaling
  useEffect(() => {
    if (!loadedCanvasState || !image) return;
    
    // Prevent infinite loops by checking if we've already processed this state
    if (processedLoadedStateRef.current === loadedCanvasState) return;
    processedLoadedStateRef.current = loadedCanvasState;
  coverageDiagKeyRef.current = '';
    
    // Use saved canvas size for display if available
    const savedImageDimensions = {
      width: loadedCanvasState.scaleMetadata?.imageWidth
        || loadedCanvasState.originalImageWidth
        || loadedCanvasState.canvasWidth
        || image.width,
      height: loadedCanvasState.scaleMetadata?.imageHeight
        || loadedCanvasState.originalImageHeight
        || loadedCanvasState.canvasHeight
        || image.height,
    };

    const savedCanvasDimensions = {
      width: loadedCanvasState.scaleMetadata?.canvasWidth
        || loadedCanvasState.canvasWidth
        || savedImageDimensions.width,
      height: loadedCanvasState.scaleMetadata?.canvasHeight
        || loadedCanvasState.canvasHeight
        || savedImageDimensions.height,
    };

    const baseCanvasWidth = savedCanvasDimensions.width || savedImageDimensions.width || image.width;
    const baseCanvasHeight = savedCanvasDimensions.height || savedImageDimensions.height || image.height;
    const fittedCanvasSize = computeFittedCanvasSize(baseCanvasWidth, baseCanvasHeight);
    const targetCanvasDimensions = {
      width: fittedCanvasSize.width,
      height: fittedCanvasSize.height,
    };

    setScaleMetadata(loadedCanvasState.scaleMetadata ?? null);

    // If saved canvas size is available, force display size to match
    setCanvasSize(prev => {
      if (Math.abs(prev.width - targetCanvasDimensions.width) < 2 && Math.abs(prev.height - targetCanvasDimensions.height) < 2) {
        return prev;
      }
      return targetCanvasDimensions;
    });

    const fromCanvasDimensions = {
      width: savedCanvasDimensions.width || targetCanvasDimensions.width,
      height: savedCanvasDimensions.height || targetCanvasDimensions.height,
    };
    const canvasScalingNeeded = fromCanvasDimensions.width > 0 && fromCanvasDimensions.height > 0 && (
      Math.abs(fromCanvasDimensions.width - targetCanvasDimensions.width) > 0.5 ||
      Math.abs(fromCanvasDimensions.height - targetCanvasDimensions.height) > 0.5
    );
    const scaleForCanvas = canvasScalingNeeded
      ? (coords: any) => scaleCoordinates(coords, fromCanvasDimensions, targetCanvasDimensions)
      : (coords: any) => coords;

    const currentImageDimensions = {
      width: image.width || savedImageDimensions.width,
      height: image.height || savedImageDimensions.height
    };

    const safeSavedWidth = savedImageDimensions.width || currentImageDimensions.width || 1;
    const safeSavedHeight = savedImageDimensions.height || currentImageDimensions.height || 1;
    const ratioX = currentImageDimensions.width && safeSavedWidth
      ? currentImageDimensions.width / safeSavedWidth
      : 1;
    const ratioY = currentImageDimensions.height && safeSavedHeight
      ? currentImageDimensions.height / safeSavedHeight
      : 1;

    // Only scale if dimensions are different (allow small tolerance)
    const needsScaling = Math.abs(safeSavedWidth - currentImageDimensions.width) > 0.5 || 
                        Math.abs(safeSavedHeight - currentImageDimensions.height) > 0.5;
    
    console.log('Restoring canvas state:', {
      savedDimensions: savedImageDimensions,
      currentDimensions: currentImageDimensions,
      needsScaling,
      ratioX,
      ratioY,
      scaleMetadata: loadedCanvasState.scaleMetadata || null,
    });
    
    // Reset baseline values so floors don't inherit previous state
    historyRef.current = [];
    redoHistoryRef.current = [];
    undoRef.current = undefined;
    redoRef.current = undefined;
    setAntennas([]);
    setPreviewAntennas([]);
    setSelectedAntennaId(null);
    setIsDraggingAntenna(false);
    setIsPlacingAntennas(false);
  setAntennaDensity(65);
  setPlacementMode('gap-first');
    setAreas([]);
    setCurrentArea([]);
    setCalibrationPoints([]);
    setCalibrationAreaPoints([]);
    setCalibrationAreaReal('');
  setCalibrationReal('');
  setCalibrationUnit(scaleUnit || 'meters');
    setPerimeter(null);
    setPerimeterRaw(null);
  setPerimeterConfidence(null);
    setHoles([]);
    setObjects([]);
    setJustSavedObject(false);
    setAutoHolesPreview([]);
    setAutoHolesIndex(-1);
  setEditHoleIndex(null);
    setExcludeCurrent([]);
    setRoi(null);
    setMode('select');
    setManualRegions([]);
    setManualHoles([]);
    setManualResult(null);
    setSelections([]);
    setSavedAreas([]);
    setSavedExclusions([]);
    setShowCoverage(true);
    setShowRadiusBoundary(true);
  setAntennaRange(7);
    setZoom(1);
    setPan({ x: 0, y: 0 });

  if (loadedCanvasState.antennas) setAntennas(scaleForCanvas(loadedCanvasState.antennas));
  if (loadedCanvasState.areas) setAreas(scaleForCanvas(loadedCanvasState.areas));
  if (loadedCanvasState.showCoverage !== undefined) setShowCoverage(!!loadedCanvasState.showCoverage);
  if (loadedCanvasState.showRadiusBoundary !== undefined) setShowRadiusBoundary(!!loadedCanvasState.showRadiusBoundary);
  if (loadedCanvasState.antennaRange !== undefined && typeof loadedCanvasState.antennaRange === 'number') setAntennaRange(loadedCanvasState.antennaRange);
  if (loadedCanvasState.calibrationPoints) setCalibrationPoints(scaleForCanvas(loadedCanvasState.calibrationPoints));
  if (loadedCanvasState.calibrationAreaPoints) setCalibrationAreaPoints(scaleForCanvas(loadedCanvasState.calibrationAreaPoints));
    if (loadedCanvasState.calibrationAreaReal !== undefined) setCalibrationAreaReal(loadedCanvasState.calibrationAreaReal);
  if (loadedCanvasState.perimeter) setPerimeter(scaleForCanvas(loadedCanvasState.perimeter));
  if (loadedCanvasState.perimeterRaw) setPerimeterRaw(scaleForCanvas(loadedCanvasState.perimeterRaw));
  if (loadedCanvasState.holes) setHoles(scaleForCanvas(loadedCanvasState.holes));
  if (loadedCanvasState.objects) setObjects(scaleForCanvas(loadedCanvasState.objects));
  if (loadedCanvasState.autoHolesPreview) setAutoHolesPreview(scaleForCanvas(loadedCanvasState.autoHolesPreview));
    if (loadedCanvasState.autoHolesIndex !== undefined) setAutoHolesIndex(loadedCanvasState.autoHolesIndex);
  if (loadedCanvasState.excludeCurrent) setExcludeCurrent(scaleForCanvas(loadedCanvasState.excludeCurrent));
  if (loadedCanvasState.roi) setRoi(scaleForCanvas(loadedCanvasState.roi));
    if (loadedCanvasState.mode) setMode(loadedCanvasState.mode);
  if (loadedCanvasState.manualRegions) setManualRegions(scaleForCanvas(loadedCanvasState.manualRegions));
  if (loadedCanvasState.manualHoles) setManualHoles(scaleForCanvas(loadedCanvasState.manualHoles));
    if (loadedCanvasState.manualResult !== undefined) setManualResult(loadedCanvasState.manualResult);
    if (loadedCanvasState.selections) setSelections(loadedCanvasState.selections);
  if (loadedCanvasState.savedAreas) setSavedAreas(scaleForCanvas(loadedCanvasState.savedAreas));
  if (loadedCanvasState.savedExclusions) setSavedExclusions(scaleForCanvas(loadedCanvasState.savedExclusions));

    // Restore scale value for antenna circles and calibration
    const storedScale = typeof loadedCanvasState.scale === 'number' ? loadedCanvasState.scale : null;
    const metadata = loadedCanvasState.scaleMetadata ?? null;
    let appliedScale: number | null = null;

    const linearScale = (ratioX + ratioY) / 2 || 1;
    const areaScale = ratioX * ratioY || 1;

    if (metadata) {
      if (metadata.mode === 'distance' && metadata.pixelValue > 0 && metadata.realMeters) {
        const adjustedPixelDistance = metadata.pixelValue * linearScale;
        if (adjustedPixelDistance > 0) {
          appliedScale = metadata.realMeters / adjustedPixelDistance;
        }
      } else if (metadata.mode === 'area' && metadata.pixelValue > 0 && metadata.realSquareMeters) {
        const adjustedPixelArea = metadata.pixelValue * areaScale;
        if (adjustedPixelArea > 0) {
          appliedScale = Math.sqrt(metadata.realSquareMeters / adjustedPixelArea);
        }
      }
    }

    if (appliedScale === null && storedScale !== null) {
      if (needsScaling && ratioX > 0 && ratioY > 0) {
        const inverseLinear = (safeSavedWidth / currentImageDimensions.width + safeSavedHeight / currentImageDimensions.height) / 2;
        appliedScale = storedScale * inverseLinear;
      } else {
        appliedScale = storedScale;
      }
    }

    if (appliedScale !== null && isFinite(appliedScale) && appliedScale > 0) {
      console.log('SCALE LOAD DIAG', {
        storedScale,
        appliedScale,
        metadata,
        ratioX,
        ratioY,
        radiusMeters: antennaRange,
        radiusPixels: antennaRange / appliedScale,
      });
      onScaleDetected && onScaleDetected(appliedScale, scaleUnit, 'restored', 1.0);
    }

    // Always start from a fitted view; zoom/pan will be reset once the image renders
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [loadedCanvasState, image, scaleUnit, computeFittedCanvasSize]);

  const calibrationDistancePx = () => {
    if (calibrationPoints.length < 2 || !image) return 0;
    const scaleX = image ? image.width / canvasSize.width : 1;
    const scaleY = image ? image.height / canvasSize.height : 1;
    const [p1, p2] = calibrationPoints;
    const x1 = p1.x * scaleX, y1 = p1.y * scaleY;
    const x2 = p2.x * scaleX, y2 = p2.y * scaleY;
    const dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx*dx + dy*dy);
  };

  const applyCalibration = () => {
    const px = calibrationDistancePx();
  const real = parseFloat(calibrationReal);
    if (!px || !real || isNaN(real)) {
      alert('Select two points and enter a valid distance.');
      return;
    }
    const unitFactor = unitToMetersFactor(calibrationUnit);
    const realMeters = real * unitFactor;
    const metersPerPixel = realMeters / px;
    setScaleMetadata({
      mode: 'distance',
      pixelValue: px,
      realMeters,
      imageWidth: image?.width || canvasSize.width,
      imageHeight: image?.height || canvasSize.height,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      unitLabel: calibrationUnit,
      capturedAtIso: new Date().toISOString(),
    });
    coverageDiagKeyRef.current = '';
    onCalibrate && onCalibrate(metersPerPixel, calibrationUnit);
    setCalibrationPoints([]);
    setCalibrationReal('');
    setMode('select');
  };

  // Area of a polygon in image pixel coordinates based on current canvas size
  const areaPixels = (points: Point[]): number => {
    if (!image || points.length < 3) return 0;
    const scaleX = image.width / canvasSize.width;
    const scaleY = image.height / canvasSize.height;
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const x1 = points[i].x * scaleX;
      const y1 = points[i].y * scaleY;
      const x2 = points[j].x * scaleX;
      const y2 = points[j].y * scaleY;
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  };

  const applyCalibrationByArea = () => {
    const realArea = parseFloat(calibrationAreaReal);
    if (!image || !isFinite(realArea) || realArea <= 0 || calibrationAreaPoints.length < 3) {
      alert('Draw a polygon and enter a valid area.');
      return;
    }
    const pxArea = areaPixels(calibrationAreaPoints);
    if (!pxArea || !isFinite(pxArea)) { alert('Invalid pixel area.'); return; }
  // If A_real = (unitsPerPixel^2) * A_pixels => unitsPerPixel = sqrt(A_real / A_pixels)
    const unitFactor = unitToMetersFactor(calibrationUnit);
    const realAreaMeters = realArea * unitFactor * unitFactor;
    const metersPerPixel = Math.sqrt(realAreaMeters / pxArea);
    if (!isFinite(metersPerPixel) || metersPerPixel <= 0) { alert('Failed to compute scale from area.'); return; }
    setScaleMetadata({
      mode: 'area',
      pixelValue: pxArea,
      realSquareMeters: realAreaMeters,
      imageWidth: image?.width || canvasSize.width,
      imageHeight: image?.height || canvasSize.height,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      unitLabel: calibrationUnit,
      capturedAtIso: new Date().toISOString(),
    });
    coverageDiagKeyRef.current = '';
    onCalibrate && onCalibrate(metersPerPixel, calibrationUnit);
    setCalibrationAreaPoints([]);
    setCalibrationAreaReal('');
    setMode('select');
  };

  useEffect(() => {
    if (!scale || !image) return;
    if (!isFinite(scale) || scale <= 0) return;
    const referencePolygon = perimeter && perimeter.length >= 3
      ? perimeter
      : (savedAreas.length > 0 && savedAreas[0].length >= 3 ? savedAreas[0] : null);
    const polygonAreaPx = referencePolygon ? areaPixels(referencePolygon) : null;
    const key = [
      scale.toFixed(8),
      antennaRange?.toFixed(4) ?? 'na',
      image.width,
      image.height,
      canvasSize.width,
      canvasSize.height,
      referencePolygon ? referencePolygon.length : 0,
      polygonAreaPx ? polygonAreaPx.toFixed(2) : 'na',
      scaleMetadata?.capturedAtIso ?? 'na',
    ].join('|');
    if (coverageDiagKeyRef.current === key) return;
    coverageDiagKeyRef.current = key;
    const polygonAreaMeters = polygonAreaPx && scale ? polygonAreaPx * scale * scale : null;
    console.log('COVERAGE_DIAG', {
      stage: 'post-load',
      scaleMetersPerPixel: scale,
      radiusMeters: antennaRange,
      radiusPixels: scale ? antennaRange / scale : null,
      polygonAreaPx,
      polygonAreaSqMeters: polygonAreaMeters,
      imageWidth: image.width,
      imageHeight: image.height,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      scaleMetadata,
    });
  }, [scale, antennaRange, image, canvasSize.width, canvasSize.height, perimeter, savedAreas, scaleMetadata]);

  // Zoom with wheel
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const delta = -Math.sign(e.deltaY) * 0.1;
    const newZoom = Math.min(5, Math.max(0.2, zoom + delta));
    if (newZoom === zoom) return;
    // Zoom to mouse position using latest pan values
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = (e.clientX - rect.left) * ((e.target as HTMLCanvasElement).width / rect.width);
    const my = (e.clientY - rect.top) * ((e.target as HTMLCanvasElement).height / rect.height);
    setPan(prev => {
      const r = newZoom / zoom;
      const nx = Math.round(mx - r * (mx - prev.x));
      const ny = Math.round(my - r * (my - prev.y));
      if (nx === prev.x && ny === prev.y) return prev;
      return { x: nx, y: ny };
    });
    if (newZoom !== zoom) setZoom(newZoom);
  };

  // Pan with right- or middle-mouse drag
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mustCalibrate && mode !== 'calibrate' && mode !== 'calibrate-area') {
      if (e.button === 0) {
        e.preventDefault();
        setMode('calibrate');
        return;
      }
    }
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      isPanningRef.current = true;
      setIsPanCursor(true);
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      suppressClickRef.current = true;
  } else if (e.button === 0) {
  if ((mode === 'edit-poly' || mode==='refine') && perimeter && perimeter.length) {
        // start dragging closest vertex if within threshold
        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
        let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const wx = (cx - pan.x) / zoom; const wy = (cy - pan.y) / zoom;
        const idx = findClosestVertexIndex({x: wx, y: wy}, perimeter);
        const thr = 10 / Math.max(0.2, zoom);
        if (idx >= 0 && distance(perimeter[idx], {x: wx, y: wy}) <= thr) {
          pushHistory();
          draggingVertexIdxRef.current = idx;
          draggingTargetRef.current = 'perimeter';
          return;
        }
      }
  if ((mode === 'edit-hole' || mode==='refine') && holes.length) {
        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
        let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const wx = (cx - pan.x) / zoom; const wy = (cy - pan.y) / zoom;
        // Find nearest handle among holes (respect editHoleIndex if set)
        let best = { hi: -1, vi: -1, d: Infinity };
        for (let i=0;i<holes.length;i++) {
          if (editHoleIndex !== null && i !== editHoleIndex) continue;
          const vi = findClosestVertexIndex({x: wx, y: wy}, holes[i]);
          if (vi >= 0) {
            const d = distance({x: wx, y: wy}, holes[i][vi]);
            if (d < best.d) best = { hi: i, vi, d };
          }
        }
        const thr = 10 / Math.max(0.2, zoom);
        if (best.vi >= 0 && best.d <= thr) {
          pushHistory();
          draggingVertexIdxRef.current = best.vi;
      draggingHoleIndexRef.current = best.hi;
      draggingTargetRef.current = 'hole';
      setEditHoleIndex(best.hi);
          return;
        }
      }
      
      // Antenna interactions: Alt=delete, Ctrl=select, else drag if near
      if (mode === 'antenna' && antennas.length > 0) {
        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
        let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const wx = (cx - pan.x) / zoom; const wy = (cy - pan.y) / zoom;
        const isAlt = e.altKey === true;
        const isCtrl = e.ctrlKey === true || e.metaKey === true;

        // Find the nearest antenna
        const thr = 15 / Math.max(0.2, zoom);
        let nearest: { antenna: Antenna; index: number } | null = null;
        for (let i = 0; i < antennas.length; i++) {
          const antenna = antennas[i];
          const d = Math.hypot(wx - antenna.position.x, wy - antenna.position.y);
          if (d <= thr) { nearest = { antenna, index: i }; break; }
        }

        if (nearest) {
          if (isAlt) {
            // Alt+click: delete antenna
            pushHistory();
            setAntennas(prev => prev.filter(a => a.id !== nearest!.antenna.id));
            if (selectedAntennaId === nearest.antenna.id) setSelectedAntennaId(null);
            suppressClickRef.current = true; // prevent click handler from placing a new one
            return;
          }
          if (isCtrl) {
            // Ctrl+click: select/toggle selection
            setSelectedAntennaId(prev => prev === nearest!.antenna.id ? null : nearest!.antenna.id);
            suppressClickRef.current = true;
            return;
          }
          // No modifier: start dragging
          draggingAntennaIdRef.current = nearest.antenna.id;
          suppressClickRef.current = true;
          return;
        }
      }
      
  if ((mode === 'select' || mode === 'measure') && currentArea && currentArea.length) {
        // Allow dragging vertices of the area being drawn
        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
        let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const wx = (cx - pan.x) / zoom; const wy = (cy - pan.y) / zoom;
        const idx = findClosestVertexIndex({x: wx, y: wy}, currentArea);
        const thr = 10 / Math.max(0.2, zoom);
        if (idx >= 0 && distance(currentArea[idx], {x: wx, y: wy}) <= thr) {
          pushHistory();
          draggingVertexIdxRef.current = idx;
          draggingTargetRef.current = 'currentArea';
          return;
        }
      }
    if (mode === 'calibrate-area' && calibrationAreaPoints && calibrationAreaPoints.length) {
        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
        let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const wx = (cx - pan.x) / zoom; const wy = (cy - pan.y) / zoom;
        const idx = findClosestVertexIndex({x: wx, y: wy}, calibrationAreaPoints);
        const thr = 10 / Math.max(0.2, zoom);
        if (idx >= 0 && distance(calibrationAreaPoints[idx], {x: wx, y: wy}) <= thr) {
      pushHistory();
          draggingVertexIdxRef.current = idx;
          draggingTargetRef.current = 'calArea';
          return;
        }
      }
      // ROI start when in roi mode
  if (mode === 'roi' || mode === 'pick-hole') {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
        let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
        // to world coords (pre-transform)
        const wx = (cx - pan.x) / zoom;
        const wy = (cy - pan.y) / zoom;
    roiDragRef.current = { x: wx, y: wy };
    // Defer ROI box creation until we have movement to avoid a quick flash
        return;
      }
      // left click handled by onClick
      return;
    }
  };
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if ((mode === 'edit-poly' || mode==='refine') && perimeter && draggingVertexIdxRef.current !== null && draggingTargetRef.current === 'perimeter') {
      const canvas = canvasRef.current; if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
      const wx = (cx - pan.x) / zoom; const wy = (cy - pan.y) / zoom;
      const idx = draggingVertexIdxRef.current;
      const next = perimeter.slice();
      next[idx] = { x: wx, y: wy };
      setPerimeter(next);
      return;
    }
  if ((mode === 'select' || mode === 'measure') && currentArea && draggingVertexIdxRef.current !== null && draggingTargetRef.current === 'currentArea') {
      const canvas = canvasRef.current; if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
      const wx = (cx - pan.x) / zoom; const wy = (cy - pan.y) / zoom;
      const idx = draggingVertexIdxRef.current;
      const next = currentArea.slice();
      next[idx] = { x: wx, y: wy };
      setCurrentArea(next);
      return;
    }
  if ((mode === 'edit-hole' || mode==='refine') && holes.length && draggingVertexIdxRef.current !== null && draggingTargetRef.current === 'hole') {
      const canvas = canvasRef.current; if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
      const wx = (cx - pan.x) / zoom; const wy = (cy - pan.y) / zoom;
      const idx = draggingVertexIdxRef.current;
      const hi = draggingHoleIndexRef.current ?? editHoleIndex ?? 0;
      const next = holes.map(h=>h.slice());
      if (next[hi]) {
        next[hi][idx] = { x: wx, y: wy };
        setHoles(next);
      }
      return;
    }
    if (mode === 'calibrate-area' && calibrationAreaPoints && draggingVertexIdxRef.current !== null && draggingTargetRef.current === 'calArea') {
      const canvas = canvasRef.current; if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
      let wx = (cx - pan.x) / zoom; let wy = (cy - pan.y) / zoom;
      // Shift: snap dragging to 45° relative to previous or next point for precision
      if ((e as any).shiftKey && calibrationAreaPoints.length >= 2) {
        const idx = draggingVertexIdxRef.current;
        const prev = calibrationAreaPoints[(idx - 1 + calibrationAreaPoints.length) % calibrationAreaPoints.length];
        const dx = wx - prev.x, dy = wy - prev.y;
        const ang = Math.atan2(dy, dx);
        const step = Math.PI/4;
        const snapped = Math.round(ang / step) * step;
        const len = Math.hypot(dx, dy);
        wx = prev.x + Math.cos(snapped) * len;
        wy = prev.y + Math.sin(snapped) * len;
      }
      const idx = draggingVertexIdxRef.current;
      const next = calibrationAreaPoints.slice();
      next[idx] = { x: wx, y: wy };
      setCalibrationAreaPoints(next);
      return;
    }
    
    // Handle antenna dragging
    if (mode === 'antenna' && draggingAntennaIdRef.current !== null) {
      const canvas = canvasRef.current; if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
      const wx = (cx - pan.x) / zoom; const wy = (cy - pan.y) / zoom;
      
      // Update antenna position
      const newAntennas = antennas.map(antenna => 
        antenna.id === draggingAntennaIdRef.current 
          ? { ...antenna, position: { x: wx, y: wy } }
          : antenna
      );
      setAntennas(newAntennas);
      return;
    }
    
  if ((mode === 'roi' || mode === 'pick-hole') && roiDragRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
      const wx = (cx - pan.x) / zoom;
      const wy = (cy - pan.y) / zoom;
      const ax = roiDragRef.current.x;
      const ay = roiDragRef.current.y;
      const x = Math.min(ax, wx);
      const y = Math.min(ay, wy);
      const w = Math.abs(wx - ax);
      const h = Math.abs(wy - ay);
      setRoi({ x, y, w, h });
  return;
    }
    if (!isPanningRef.current || !lastMouseRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  setPan(p => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) }));
  };
  const handleMouseUp = () => { 
    draggingVertexIdxRef.current = null;
    draggingHoleIndexRef.current = null;
    draggingAntennaIdRef.current = null;
    draggingTargetRef.current = null;
    // If we just finished drawing an ROI in pick-hole mode, auto-detect largest hole in that rectangle
    if (mode === 'pick-hole' && roi && roi.w > 5 && roi.h > 5) {
      detectLargestHoleInRect(roi).catch(()=>{});
    }
    // If we just finished drawing an ROI in Select Auto mode, run perimeter detection in that ROI
    if (mode === 'roi' && roi && roi.w > 5 && roi.h > 5) {
      runPerimeterDetection();
    }
    roiDragRef.current = null;
    isPanningRef.current = false; 
    setIsPanCursor(false); 
    if (suppressClickRef.current) {
      setTimeout(() => { suppressClickRef.current = false; }, 80);
    }
  };
  const handleMouseLeave = () => { 
    isPanningRef.current = false; 
    setIsPanCursor(false); 
    if (suppressClickRef.current) {
      setTimeout(() => { suppressClickRef.current = false; }, 80);
    }
  };
  const preventContext = (e: React.MouseEvent) => { e.preventDefault(); };

  // Helpers for refine mode
  function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
  
  // Antenna placement utilities
  const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
    const { x, y } = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  };

  const autoPlaceAntennas = () => {
    if (!scale) {
      alert('Please set scale first before placing antennas');
      return;
    }
    
    setIsPlacingAntennas(true);
    console.log('🟦 AUTO PLACE: Starting antenna placement...');
  console.log('🟦 AUTO PLACE: spacing percent =', normalizedSpacingPercent, 'overlap ≈', overlapPercent, '%', 'mode =', placementMode);
    console.log('🟦 AUTO PLACE: savedAreas =', savedAreas.length, savedAreas);
    console.log('🟦 AUTO PLACE: holes =', holes.length, holes);
    console.log('🟦 AUTO PLACE: manualHoles =', manualHoles.length, manualHoles);
    console.log('🟦 AUTO PLACE: savedExclusions =', savedExclusions.length, savedExclusions);
    console.log('🟦 AUTO PLACE: autoHolesPreview =', autoHolesPreview.length, autoHolesPreview);
    console.log('🟦 AUTO PLACE: excludeCurrent =', excludeCurrent.length, excludeCurrent);
    console.log('🟦 AUTO PLACE: currentArea =', currentArea.length, currentArea);
    console.log('🟦 AUTO PLACE: perimeter =', perimeter?.length || 0);
    console.log('🟦 AUTO PLACE: mode =', mode);
    console.log('🟦 AUTO PLACE: Total exclusions being passed =', [...holes, ...manualHoles, ...savedExclusions].length);
    
    try {
      // Determine active areas preference: perimeter > saved > current
      let activeAreas: Point[][] = [];
      if (perimeter && perimeter.length >=3) activeAreas = [perimeter];
      else if (savedAreas.length) activeAreas = savedAreas;
      else if (currentArea.length >=3) activeAreas = [currentArea];

      const exclusions = [...holes, ...manualHoles, ...savedExclusions, ...autoHolesPreview];
      const canvasToImageScale = computeCanvasToImageScale();
      const newAntennas = simpleAutoPlaceAntennas({
        savedAreas: activeAreas,
        scale,
        defaultAntennaRange: antennaRange,
        defaultAntennaPower: 50,
        isPointInPolygon,
        exclusions,
        gridSpacingPercent: normalizedSpacingPercent,
        canvasToImageScale,
        placementMode
      });

      setAntennas(newAntennas);
      console.log(`Placed ${newAntennas.length} antennas using buffered solver`);
    } catch (error) {
      console.error('Error placing antennas:', error);
      alert('Error placing antennas. Please try again.');
    } finally {
      setIsPlacingAntennas(false);
    }
  };

  // Live preview function - calculates antennas without committing them
  const updateAntennaPreview = () => {
    // Only show preview if in antenna mode and no antennas are placed
    if (mode !== 'antenna') {
      console.log('🔵 PREVIEW: Skipping preview - not in antenna mode (current:', mode, ')');
      setPreviewAntennas([]);
      return;
    }
    
    if (antennas.length > 0) {
      console.log('🔵 PREVIEW: Skipping preview - antennas already placed');
      setPreviewAntennas([]);
      return;
    }
    
    console.log('🔵 PREVIEW: Updating antenna preview...');
    console.log('🔵 PREVIEW: scale =', scale);
    console.log('🔵 PREVIEW: savedAreas.length =', savedAreas.length);
    console.log('🔵 PREVIEW: currentArea.length =', currentArea.length);
    console.log('🔵 PREVIEW: perimeter?.length =', perimeter?.length);
    
    // Determine which areas to use for preview
    let areasToUse = [];
    if (perimeter && perimeter.length >= 3) {
      areasToUse = [perimeter];
      console.log('🔵 PREVIEW: Using perimeter for preview');
    } else if (currentArea.length >= 3) {
      areasToUse = [currentArea];
      console.log('🔵 PREVIEW: Using currentArea for preview');
    } else if (savedAreas.length > 0) {
      areasToUse = savedAreas;
      console.log('🔵 PREVIEW: Using savedAreas for preview');
    } else {
      console.log('🔵 PREVIEW: No areas available for preview');
      setPreviewAntennas([]);
      return;
    }
    
    if (!scale) {
      console.log('🔵 PREVIEW: No scale set');
      setPreviewAntennas([]);
      return;
    }

    try {
      console.log('🔵 PREVIEW: Generating preview (buffer-aware solver)');
      const canvasToImageScale = computeCanvasToImageScale();
      const previewAntennas = simpleAutoPlaceAntennas({
        savedAreas: areasToUse,
        scale,
        defaultAntennaRange: antennaRange,
        defaultAntennaPower: 50,
        isPointInPolygon,
        exclusions: [...holes, ...manualHoles, ...savedExclusions, ...autoHolesPreview],
        gridSpacingPercent: normalizedSpacingPercent,
        canvasToImageScale,
        placementMode
      });

      console.log('🔵 PREVIEW: Generated', previewAntennas.length, 'preview antennas');
      setPreviewAntennas(previewAntennas);
    } catch (error) {
      console.error('🔵 PREVIEW: Error in preview:', error);
      setPreviewAntennas([]);
    }
  };

  // Don't automatically update preview when sliders change
  // Let user explicitly trigger preview via Auto Place button
  // This prevents unwanted preview antennas from appearing
  /*
  useEffect(() => {
    // Only show preview if no actual antennas are placed
    if (antennas.length === 0) {
      updateAntennaPreview();
    } else {
      setPreviewAntennas([]); // Clear preview when antennas exist
    }
  }, [antennaRange, antennaDensity, savedAreas, currentArea, perimeter, scale, holes, manualHoles, savedExclusions, autoHolesPreview, antennas.length]);
  */

  // Don't automatically show preview when switching to antenna mode
  // Let user explicitly trigger preview via Auto Place or other actions
  useEffect(() => {
    if (mode === 'antenna' && antennas.length === 0) {
      console.log('🔵 MODE: Switched to antenna mode, clearing any existing preview');
      setPreviewAntennas([]); // Clear preview instead of showing it
    }
  }, [mode]);

  function findClosestVertexIndex(p: Point, poly: Point[]) {
    let best = -1, bd = Infinity;
    for (let i=0;i<poly.length;i++) { const d = distance(p, poly[i]); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function pointToSegmentDistance(p: Point, a: Point, b: Point) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return { dist: distance(p, a), t: 0 };
    let t = ((p.x - a.x)*dx + (p.y - a.y)*dy) / len2; t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + t*dx, y: a.y + t*dy };
    return { dist: distance(p, proj), t };
  }
  function findClosestEdgeIndex(p: Point, poly: Point[]) {
    let best = -1, bd = Infinity, bt = 0;
    for (let i=0;i<poly.length;i++) {
      const a = poly[i], b = poly[(i+1)%poly.length];
      const r = pointToSegmentDistance(p, a, b);
      if (r.dist < bd) { bd = r.dist; best = i; bt = r.t; }
    }
    return { index: best, t: bt, dist: bd };
  }

  // Utility: promise timeout
  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout')), ms);
      p.then(v => { clearTimeout(to); resolve(v); }).catch(e => { clearTimeout(to); reject(e); });
    });
  }

  // Use a Web Worker to trim via OpenCV.js without blocking the UI
  function trimWithWorker(dataUrl: string, timeoutMs = 4000): Promise<{ dataUrl: string; quad: {x:number;y:number}[]; confidence: number } | null> {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('/workers/trim-opencv.js');
        const timer = setTimeout(() => {
          try { worker.terminate(); } catch {}
          reject(new Error('timeout'));
        }, timeoutMs);
        worker.onmessage = (ev: MessageEvent) => {
          clearTimeout(timer);
          const msg = ev.data;
          try { worker.terminate(); } catch {}
          if (msg && msg.ok) {
            resolve({ dataUrl: msg.dataUrl, quad: msg.quad, confidence: msg.confidence ?? 0.0 });
          } else {
            resolve(null);
          }
        };
        worker.onerror = (err) => {
          clearTimeout(timer);
          try { worker.terminate(); } catch {}
          reject(err);
        };
        worker.postMessage({ imageUrl: dataUrl, timeoutMs, mode: 'frame' });
      } catch (e) {
        reject(e);
      }
    });
  }

  function contentTrimWithWorker(dataUrl: string, timeoutMs = 4000): Promise<{ dataUrl: string; quad: {x:number;y:number}[]; confidence: number } | null> {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('/workers/trim-opencv.js');
        const timer = setTimeout(() => { try { worker.terminate(); } catch {} ; reject(new Error('timeout')); }, timeoutMs);
        worker.onmessage = (ev: MessageEvent) => {
          clearTimeout(timer);
          const msg = ev.data;
          try { worker.terminate(); } catch {}
          if (msg && msg.ok) {
            resolve({ dataUrl: msg.dataUrl, quad: msg.quad, confidence: msg.confidence ?? 0.0 });
          } else {
            resolve(null);
          }
        };
        worker.onerror = (err) => { clearTimeout(timer); try { worker.terminate(); } catch {}; reject(err); };
        worker.postMessage({ imageUrl: dataUrl, timeoutMs, mode: 'content' });
      } catch (e) { reject(e); }
    });
  }

  // Simple JS-only auto-crop: estimates border color and trims margins where pixels are similar to border.
  async function simpleAutoCrop(dataUrl: string): Promise<{ dataUrl: string; quad: {x:number;y:number}[]; confidence: number } | null> {
    // Decode using an Image element (more robust across blob/data URLs)
    const imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = (e) => reject(new Error('image decode failed'));
      im.src = dataUrl;
    });
    // Downscale for detection
    const maxSide = 1500;
    const scale = Math.min(1, maxSide / Math.max(imgEl.width, imgEl.height));
    const dw = Math.max(1, Math.round(imgEl.width * scale));
    const dh = Math.max(1, Math.round(imgEl.height * scale));
    const dcanvas = document.createElement('canvas');
    dcanvas.width = dw; dcanvas.height = dh;
    const dctx = dcanvas.getContext('2d');
    if (!dctx) return null;
    dctx.drawImage(imgEl, 0, 0, dw, dh);
      const img = dctx.getImageData(0, 0, dw, dh);
      const data = img.data;
      const stride = 4;
      // Estimate border color from outer 2% frame
      const m = Math.max(1, Math.floor(Math.min(dw, dh) * 0.02));
      let sr=0, sg=0, sb=0, n=0;
      const sample = (x:number,y:number)=>{
        const i=(y*dw + x)*stride; sr+=data[i]; sg+=data[i+1]; sb+=data[i+2]; n++; };
      for (let x=0; x<dw; x++){ for (let y=0; y<m; y++) sample(x,y); for (let y=dh-m; y<dh; y++) sample(x,y); }
      for (let y=0; y<dh; y++){ for (let x=0; x<m; x++) sample(x,y); for (let x=dw-m; x<dw; x++) sample(x,y); }
      const br = n? sr/n : 255, bg = n? sg/n : 255, bb = n? sb/n : 255;
      const colorDist = (r:number,g:number,b:number)=> Math.hypot(r-br, g-bg, b-bb);
      // Scan inward until sufficient content appears per line
      const contentThresh = 28; // distance from border color
      const contentRatio = 0.04; // 4% pixels different to consider content present
      const lineHasContent = (y:number)=>{
        let c=0; for(let x=0;x<dw;x++){ const i=(y*dw+x)*stride; if (data[i+3]>8 && colorDist(data[i],data[i+1],data[i+2])>contentThresh) c++; }
        return c > dw*contentRatio; };
      const colHasContent = (x:number)=>{
        let c=0; for(let y=0;y<dh;y++){ const i=(y*dw+x)*stride; if (data[i+3]>8 && colorDist(data[i],data[i+1],data[i+2])>contentThresh) c++; }
        return c > dh*contentRatio; };
      let top=0, bottom=dh-1, left=0, right=dw-1;
      while (top<bottom && !lineHasContent(top)) top++;
      while (bottom>top && !lineHasContent(bottom)) bottom--;
      while (left<right && !colHasContent(left)) left++;
      while (right>left && !colHasContent(right)) right--;
      // Safety margins and validity
      if (left>=right || top>=bottom) return null;
      let minX = left, minY = top, maxX = right, maxY = bottom;
      if (maxX < 0 || maxY < 0) return null;
      // Add a tiny margin
      const margin = Math.round(Math.max(dw, dh) * 0.005);
      minX = Math.max(0, minX - margin);
      minY = Math.max(0, minY - margin);
      maxX = Math.min(dw - 1, maxX + margin);
      maxY = Math.min(dh - 1, maxY + margin);
  const bx0 = Math.round(minX / scale);
  const by0 = Math.round(minY / scale);
  const bw = Math.max(1, Math.round((maxX - minX + 1) / scale));
  const bh = Math.max(1, Math.round((maxY - minY + 1) / scale));
      // If crop is almost full image, treat as no-op
  const cov = (bw*bh) / (imgEl.width * imgEl.height);
      if (cov > 0.98) return null;
      // Produce final cropped image
      const outCanvas = document.createElement('canvas');
      outCanvas.width = bw; outCanvas.height = bh;
      const octx = outCanvas.getContext('2d');
      if (!octx) return null;
  octx.drawImage(imgEl, bx0, by0, bw, bh, 0, 0, bw, bh);
      const outUrl = outCanvas.toDataURL('image/png');
      const quad = [
        { x: 0, y: 0 },
        { x: bw, y: 0 },
        { x: bw, y: bh },
        { x: 0, y: bh }
      ];
      // Confidence proportional to how much was cropped
  const croppedRatio = 1 - cov;
  const confidence = Math.max(0.25, Math.min(0.92, croppedRatio * 1.1));
      return { dataUrl: outUrl, quad, confidence };
  }

  // Last-resort: crop a fixed margin percentage from all sides
  async function fixedMarginCrop(dataUrl: string, marginPct = 0.02): Promise<{ dataUrl: string; quad: {x:number;y:number}[]; confidence: number } | null> {
    if (marginPct <= 0 || marginPct >= 0.45) return null;
    const imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image decode failed'));
      im.src = dataUrl;
    });
    const mx = Math.round(imgEl.width * marginPct);
    const my = Math.round(imgEl.height * marginPct);
    const w = Math.max(1, imgEl.width - mx*2);
    const h = Math.max(1, imgEl.height - my*2);
    if (w < imgEl.width || h < imgEl.height) {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(imgEl, mx, my, w, h, 0, 0, w, h);
      const out = canvas.toDataURL('image/png');
      const quad = [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
      const confidence = Math.max(0.1, Math.min(0.4, marginPct * 1.2));
      return { dataUrl: out, quad, confidence };
    }
    return null;
  }

  // Capture current view so we can restore it after the next image loads
  function captureViewForNextImage() {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    // composite scale from image px to screen px
    const base = canvasSize.width > 0 && image.width > 0 ? (canvasSize.width / image.width) : 1;
    const compositeScale = base * zoom;
    // screen center in image px
    const centerCanvas = { x: canvas.width / 2, y: canvas.height / 2 };
    const worldX = (centerCanvas.x - pan.x) / (zoom || 1);
    const worldY = (centerCanvas.y - pan.y) / (zoom || 1);
    const scaleToImg = image.width > 0 ? (image.width / canvasSize.width) : 1;
    const centerImg = { x: worldX * scaleToImg, y: worldY * scaleToImg };
    preserveViewRef.current = { compositeScale, centerImg };
  }

  // Outside trigger to start calibrate — only when token increments
  const lastCalibrateTokenRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (requestCalibrateToken === undefined) return;
    if (lastCalibrateTokenRef.current === undefined) {
      // Initialize baseline without triggering on first mount
      lastCalibrateTokenRef.current = requestCalibrateToken;
      return;
    }
    if (requestCalibrateToken === lastCalibrateTokenRef.current) return;
    lastCalibrateTokenRef.current = requestCalibrateToken;
    setMode('calibrate');
    setCalibrationPoints([]);
    setCalibrationAreaPoints([]);
    setCalibrationAreaReal('');
  }, [requestCalibrateToken]);

  // Global shortcuts: Ctrl/Cmd+Z undo, Ctrl+Y/Ctrl+Shift+Z redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key?.toLowerCase?.() || '';
      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) { 
        e.preventDefault(); 
        console.log('Ctrl+Z pressed - calling undo via ref');
        undoRef.current?.(); 
        return; 
      }
      if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) { 
        e.preventDefault(); 
        console.log('Redo shortcut pressed - calling redo via ref');
        redoRef.current?.(); 
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mustCalibrate]);

  // Prevent page scroll while zooming over the canvas/container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (ev: WheelEvent) => { if (el.contains(ev.target as Node)) { ev.preventDefault(); } };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler as any);
  }, []);

  // Lock body scroll when overlay is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Detect perimeter via worker, optionally limited to ROI
  async function runPerimeterDetection() {
    if (mustCalibrate) { alert('Please calibrate first (Calibrate or Calibrate Area).'); setMode('calibrate'); return; }
    if (!image || !imageUrl) return;
    setBusy(true);
    try {
  setJustSavedObject(false);
      pushHistory();
      // Map ROI (world coords) to image coords
      let roiImg: {x:number;y:number;w:number;h:number}|undefined = undefined;
      if (roi) {
        const sx = image.width / canvasSize.width;
        const sy = image.height / canvasSize.height;
        roiImg = { x: Math.round(roi.x * sx), y: Math.round(roi.y * sy), w: Math.round(roi.w * sx), h: Math.round(roi.h * sy) };
      }
      const res = await new Promise<any>((resolve, reject) => {
        const w = new Worker('/workers/perimeter-opencv.js');
        const to = setTimeout(() => { try{w.terminate();}catch{}; reject(new Error('timeout')); }, 10000);
        w.onmessage = ev => { clearTimeout(to); try{w.terminate();}catch{}; resolve(ev.data); };
        w.onerror = err => { clearTimeout(to); try{w.terminate();}catch{}; reject(err); };
  w.postMessage({ imageUrl, roi: roiImg, timeoutMs: 8000 });
      });
      if (res && res.ok && res.points?.length) {
        // Map image points to world coords
        const sx = canvasSize.width / image.width;
        const sy = canvasSize.height / image.height;
        const pts: Point[] = res.points.map((p:Point) => ({ x: p.x * sx, y: p.y * sy }));
        const raw: Point[] | null = Array.isArray(res.rawPoints) && res.rawPoints.length ? res.rawPoints.map((p:Point)=>({ x: p.x * sx, y: p.y * sy })) : null;
        // Prefer simplifying from raw right away to avoid initial offset
        if (raw && raw.length > 3) {
          const epsilon = simplify; // canvas/world pixels
          const simp = simplifyDouglasPeucker(raw, epsilon, true);
          setPerimeter(simp && simp.length >= 3 ? simp : (pts || raw));
        } else {
          setPerimeter(pts);
        }
        setPerimeterRaw(raw);
        setPerimeterConfidence(res.confidence ?? null);
        setHoles([]);
  setJustSavedObject(false);
        // Auto-nudge simplify to fix any residual misalignment
        if (raw && raw.length > 3) autoNudgeSimplify(simplify);
      } else {
        alert('No perimeter detected');
      }
    } catch (e:any) {
      alert('Perimeter detection failed: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  // Area helper for canvas-space polygons
  function polyAreaCanvas(pts: Point[]) {
    if (!pts || pts.length < 3) return 0;
    let a = 0; for (let i=0,j=pts.length-1; i<pts.length; j=i++) { a += (pts[j].x + pts[i].x)*(pts[j].y - pts[i].y); }
    return Math.abs(a/2);
  }

  // Detect the largest hole within a given ROI rectangle (world/canvas coords)
  async function detectLargestHoleInRect(roiRect: {x:number;y:number;w:number;h:number}) {
    if (mustCalibrate) { alert('Please calibrate first (Calibrate or Calibrate Area).'); setMode('calibrate'); return; }
    if (!image) return;
    setBusy(true);
    try {
      const sx = image.width / canvasSize.width;
      const sy = image.height / canvasSize.height;
      const rx = Math.round(roiRect.x * sx), ry = Math.round(roiRect.y * sy);
      const rw = Math.round(roiRect.w * sx), rh = Math.round(roiRect.h * sy);
      const polyImg = [
        { x: rx, y: ry },
        { x: rx + rw, y: ry },
        { x: rx + rw, y: ry + rh },
        { x: rx, y: ry + rh }
      ];
      const res:any = await new Promise((resolve, reject)=>{
        const w = new Worker('/workers/holes-opencv.js');
        const to = setTimeout(()=>{ try{w.terminate();}catch{}; reject(new Error('timeout')); }, 10000);
        w.onmessage = ev=>{ clearTimeout(to); try{w.terminate();}catch{}; resolve(ev.data); };
        w.onerror = err=>{ clearTimeout(to); try{w.terminate();}catch{}; reject(err); };
        w.postMessage({ imageUrl, perimeterPoints: polyImg, timeoutMs: 9000 });
      });
      if (res && res.ok && Array.isArray(res.holes) && res.holes.length) {
        const cx = canvasSize.width / image.width;
        const cy = canvasSize.height / image.height;
        let holesWorld: Point[][] = res.holes.map((poly:Point[])=> poly.map(pt=>({ x: pt.x * cx, y: pt.y * cy })));
        holesWorld.sort((a,b)=> polyAreaCanvas(b) - polyAreaCanvas(a));
        // Keep only largest for this rectangle
        holesWorld = holesWorld.length ? [holesWorld[0]] : [];
        setAutoHolesPreview(holesWorld);
        setAutoHolesIndex(holesWorld.length ? 0 : -1);
      } else {
        setAutoHolesPreview([]);
        setAutoHolesIndex(-1);
        alert('No hole found in the selected rectangle');
      }
    } catch (e:any) {
      alert('Hole detection failed: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  // Apply simplification from raw points at a given epsilon
  function applySimplify(epsilon: number) {
    if (!perimeterRaw || perimeterRaw.length < 3) return;
    const simp = simplifyDouglasPeucker(perimeterRaw, epsilon, true);
    if (simp && simp.length >= 3) setPerimeter(simp);
  }
  // Auto-nudge: briefly increase epsilon then restore to settle the outline
  function autoNudgeSimplify(baseEpsilon: number) {
    if (!perimeterRaw || perimeterRaw.length < 3) return;
    const up = Math.max(2, Math.min(40, baseEpsilon + 1));
    applySimplify(up);
    // restore next frame
    requestAnimationFrame(() => {
      applySimplify(baseEpsilon);
    });
  }

  const perimeterArea = perimeter && perimeter.length >= 3 ? calculateArea(perimeter) : null;
  const holesArea = holes.length ? holes.reduce((sum, h) => sum + (h.length >= 3 ? calculateArea(h) : 0), 0) : 0;
  const netArea = perimeterArea !== null ? Math.max(0, (perimeterArea || 0) - holesArea) : null;
  const objectsSummary = objects.map(o => {
    const a = o.perimeter.length>=3 ? calculateArea(o.perimeter) : 0;
    const ha = o.holes.reduce((s,h)=> s + (h.length>=3 ? calculateArea(h) : 0), 0);
    return { id: o.id, name: o.name || 'Object', gross: a, holes: ha, net: Math.max(0, a - ha) };
  });
  
  // Define area summaries based on saved areas
  
  // Calculate total from both manual selections and saved areas

  const captureAntennaScreenshot = useCallback(async () => {
    if (isCapturingScreenshot) {
      return;
    }

  const canvasEl = canvasRef.current;
  const summaryEl = summaryRef.current;
    if (!canvasEl) {
      alert('Floorplan canvas is not available yet.');
      return;
    }
    if (!summaryEl) {
      alert('Summary panel is not visible, nothing to capture.');
      return;
    }

    setIsCapturingScreenshot(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const floorplanCanvas = canvasEl;
      if ((floorplanCanvas.width || 0) === 0 || (floorplanCanvas.height || 0) === 0) {
        throw new Error('Floorplan canvas is not ready yet.');
      }

      const summaryScale = Math.min(2, window.devicePixelRatio || 1);
      await document.fonts?.ready.catch(() => undefined);

      const originalRect = summaryEl.getBoundingClientRect();
      if ((originalRect.width || 0) === 0 || (originalRect.height || 0) === 0) {
        throw new Error('Summary panel is not ready yet.');
      }

      const summaryClone = summaryEl.cloneNode(true) as HTMLElement;
      const copyComputedStyles = (source: HTMLElement, target: HTMLElement) => {
        const sourceStyles = window.getComputedStyle(source);
        const targetStyle = target.style;
        for (let i = 0; i < sourceStyles.length; i += 1) {
          const property = sourceStyles.item(i);
          if (!property) {
            continue;
          }
          const value = sourceStyles.getPropertyValue(property);
          const priority = sourceStyles.getPropertyPriority(property);
          try {
            targetStyle.setProperty(property, value, priority);
          } catch {
            // Ignore properties the browser refuses to set (rare)
          }
        }
      };
      copyComputedStyles(summaryEl, summaryClone);

      const originalChildren = Array.from(summaryEl.querySelectorAll<HTMLElement>('*'));
      const cloneChildren = Array.from(summaryClone.querySelectorAll<HTMLElement>('*'));
      const childrenLength = Math.min(originalChildren.length, cloneChildren.length);
      for (let i = 0; i < childrenLength; i += 1) {
        copyComputedStyles(originalChildren[i], cloneChildren[i]);
      }

  const computedOriginal = window.getComputedStyle(summaryEl);
  summaryClone.style.position = 'static';
  summaryClone.style.left = 'auto';
  summaryClone.style.right = 'auto';
  summaryClone.style.top = 'auto';
  summaryClone.style.bottom = 'auto';
  summaryClone.style.width = `${originalRect.width}px`;
  summaryClone.style.maxWidth = `${originalRect.width}px`;
  summaryClone.style.minWidth = `${originalRect.width}px`;
  summaryClone.style.margin = '0';
  summaryClone.style.opacity = '1';
  summaryClone.style.transform = 'none';
  summaryClone.style.filter = 'none';
  summaryClone.style.pointerEvents = 'auto';
  summaryClone.style.boxShadow = computedOriginal?.boxShadow || 'none';
  summaryClone.style.background = computedOriginal?.background || '#ffffff';
  summaryClone.style.borderRadius = computedOriginal?.borderRadius || summaryClone.style.borderRadius;
  summaryClone.style.display = 'block';

  const stagingContainer = document.createElement('div');
  stagingContainer.style.position = 'fixed';
  stagingContainer.style.left = '-10000px';
  stagingContainer.style.top = '-10000px';
  stagingContainer.style.width = `${originalRect.width}px`;
  stagingContainer.style.height = 'auto';
  stagingContainer.style.overflow = 'visible';
  stagingContainer.style.zIndex = '-1';
  stagingContainer.style.background = 'transparent';
  stagingContainer.appendChild(summaryClone);
      document.body.appendChild(stagingContainer);

      const pickGradientFallbackColor = (gradient: string, fallback: string): string => {
        const colorMatch = gradient.match(/(rgba?\([^\)]+\)|#[0-9a-fA-F]{3,8})/);
        if (colorMatch && colorMatch[0]) {
          return colorMatch[0];
        }
        return fallback;
      };

      const sanitizeGradients = (root: HTMLElement) => {
        const overrides: Array<{ element: HTMLElement; backgroundImage: string; backgroundColor: string }> = [];
        const stack: HTMLElement[] = [root];
        while (stack.length) {
          const el = stack.pop()!;
          const style = window.getComputedStyle(el);
          const bgImage = style?.backgroundImage || '';
          if (bgImage.includes('gradient')) {
            overrides.push({
              element: el,
              backgroundImage: el.style.backgroundImage,
              backgroundColor: el.style.backgroundColor,
            });
            el.style.backgroundImage = 'none';
            const computedColor = style?.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent'
              ? style.backgroundColor
              : undefined;
            el.style.backgroundColor = pickGradientFallbackColor(bgImage, computedColor || '#2563eb');
          }
          Array.from(el.children).forEach(child => {
            if (child instanceof HTMLElement) stack.push(child);
          });
        }
        return overrides;
      };

      const restoreGradients = (overrides: Array<{ element: HTMLElement; backgroundImage: string; backgroundColor: string }>) => {
        overrides.forEach(({ element, backgroundImage, backgroundColor }) => {
          element.style.backgroundImage = backgroundImage;
          element.style.backgroundColor = backgroundColor;
        });
      };

      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      let summaryCanvas: HTMLCanvasElement;
      const cloneOverrides = sanitizeGradients(summaryClone);
      try {
        summaryCanvas = await html2canvas(summaryClone, {
          backgroundColor: '#ffffff',
          scale: summaryScale,
          useCORS: true,
          logging: false,
          removeContainer: true,
          width: Math.round(summaryClone.offsetWidth || originalRect.width),
          height: Math.round(summaryClone.offsetHeight || originalRect.height),
          scrollX: 0,
          scrollY: 0,
          foreignObjectRendering: true,
          ignoreElements: element => element?.getAttribute?.('data-ignore-screenshot') === 'true',
        });
      } finally {
        restoreGradients(cloneOverrides);
      }

      if ((summaryCanvas.width || 0) === 0 || (summaryCanvas.height || 0) === 0) {
        console.warn('html2canvas produced empty summary canvas; falling back to live summary element.');
        const summaryRect = summaryEl.getBoundingClientRect();
        const originalOverrides = sanitizeGradients(summaryEl);
        try {
          await new Promise(resolve => requestAnimationFrame(resolve));
          summaryCanvas = await html2canvas(summaryEl, {
            backgroundColor: '#ffffff',
            scale: summaryScale,
            useCORS: true,
            logging: false,
            width: Math.round(summaryEl.offsetWidth || summaryRect.width || originalRect.width),
            height: Math.round(summaryEl.offsetHeight || summaryRect.height || originalRect.height),
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            foreignObjectRendering: true,
            ignoreElements: element => element?.getAttribute?.('data-ignore-screenshot') === 'true',
          });
        } finally {
          restoreGradients(originalOverrides);
        }
      }

      stagingContainer.remove();

      let summaryRenderCanvas: HTMLCanvasElement = summaryCanvas;
      if ((summaryCanvas.width || 0) === 0 || (summaryCanvas.height || 0) === 0) {
  console.warn('Summary element screenshot fallback reduced to text rendering.');
  const summaryTextLines = summaryEl.innerText
          .split(/\n+/)
          .map(line => line.trim())
          .filter(line => line.length > 0);
        const rect = summaryEl.getBoundingClientRect();
        const fallbackWidth = Math.max(400, Math.round(rect.width) || 0);
        const paddingX = 28;
        const paddingY = 32;
        const lineHeight = 22;
        const scaleFactor = summaryScale > 0 ? summaryScale : 1;
        const contentWidth = fallbackWidth - paddingX * 2;

        const fallbackCanvas = document.createElement('canvas');
        fallbackCanvas.width = Math.max(320, Math.round(fallbackWidth * scaleFactor));
        fallbackCanvas.height = Math.max(220, Math.round((summaryTextLines.length * lineHeight + paddingY * 2) * scaleFactor));
        const fallbackCtx = fallbackCanvas.getContext('2d');
        if (!fallbackCtx) {
          throw new Error('Summary panel is not ready yet.');
        }

        fallbackCtx.scale(scaleFactor, scaleFactor);
        fallbackCtx.fillStyle = '#ffffff';
        fallbackCtx.fillRect(0, 0, fallbackCanvas.width / scaleFactor, fallbackCanvas.height / scaleFactor);
        fallbackCtx.fillStyle = '#0f172a';
        fallbackCtx.font = '16px "Inter", sans-serif';
        fallbackCtx.textBaseline = 'top';

        let textY = paddingY;
        const wrapLine = (line: string): string[] => {
          const words = line.split(/\s+/);
          const wrapped: string[] = [];
          let currentLine = '';
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const measured = fallbackCtx.measureText(testLine).width / scaleFactor;
            if (measured > contentWidth && currentLine) {
              wrapped.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          if (currentLine) {
            wrapped.push(currentLine);
          }
          return wrapped.length ? wrapped : [''];
        };

        summaryTextLines.forEach(line => {
          const wrapped = wrapLine(line);
          wrapped.forEach(seg => {
            fallbackCtx.fillText(seg, paddingX, textY);
            textY += lineHeight;
          });
          textY += 6;
        });

        summaryRenderCanvas = fallbackCanvas;
      }
      const margin = 48;
      const gap = 40;
      const summaryPadding = 28;

  const floorplanWidth = floorplanCanvas.width || canvasSize.width;
  const floorplanHeight = floorplanCanvas.height || canvasSize.height;
  const summaryWidth = summaryRenderCanvas.width;
  const summaryHeight = summaryRenderCanvas.height;

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = floorplanWidth + summaryWidth + margin * 2 + gap + summaryPadding * 2;
  exportCanvas.height = Math.max(floorplanHeight, summaryHeight + summaryPadding * 2) + margin * 2;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Unable to create export context');
      }

      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

      const floorplanX = margin;
      const floorplanY = margin;
      ctx.drawImage(floorplanCanvas, floorplanX, floorplanY);

  const summaryX = floorplanX + floorplanWidth + gap;
  const summaryY = margin + Math.max(0, (floorplanHeight - (summaryHeight + summaryPadding * 2)) / 2);

      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.35)';
      ctx.shadowBlur = 36;
      ctx.shadowOffsetY = 12;
      ctx.fillStyle = '#0b1220';
    ctx.fillRect(summaryX - summaryPadding, summaryY - summaryPadding, summaryWidth + summaryPadding * 2, summaryHeight + summaryPadding * 2);
      ctx.restore();

      ctx.fillStyle = '#ffffff';
  ctx.fillRect(summaryX - summaryPadding, summaryY - summaryPadding, summaryWidth + summaryPadding * 2, summaryHeight + summaryPadding * 2);
  ctx.drawImage(summaryRenderCanvas, summaryX, summaryY, summaryWidth, summaryHeight);

      const exportBlob = await new Promise<Blob | null>(resolve => exportCanvas.toBlob(resolve, 'image/png', 0.95));
      const dataUrl = exportBlob ? null : exportCanvas.toDataURL('image/png');

      if (!exportBlob && !dataUrl) {
        throw new Error('Failed to encode screenshot.');
      }

      let copied = false;
      const clipboardItemCtor = typeof window !== 'undefined' ? (window as any).ClipboardItem : undefined;
      if (exportBlob && navigator.clipboard && 'write' in navigator.clipboard && clipboardItemCtor) {
        try {
          const item = new clipboardItemCtor({ 'image/png': exportBlob });
          await navigator.clipboard.write([item]);
          copied = true;
          showScreenshotMessage('Screenshot copied to clipboard');
        } catch (err) {
          console.warn('Clipboard write failed, falling back to download', err);
        }
      }

      if (!copied) {
        const link = document.createElement('a');
        const href = exportBlob ? URL.createObjectURL(exportBlob) : (dataUrl as string);
        link.href = href;
        link.download = `floorplan-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (exportBlob) {
          setTimeout(() => URL.revokeObjectURL(href), 5000);
        }
        showScreenshotMessage('Screenshot downloaded');
      }
    } catch (error) {
      console.error('Failed to capture antenna screenshot', error);
      alert('Unable to capture the screenshot. Please try again.');
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [
    isCapturingScreenshot,
    showScreenshotMessage,
  ]);

  const content = (
    <div className="flex flex-col relative h-full min-h-0">
      {/* Controls */}
  <div
        ref={controlsRef}
        className="bg-gradient-to-r from-blue-500 to-orange-500 px-6 py-4 flex flex-col gap-3"
      >
        <div className="flex w-full flex-wrap items-start gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <button type="button"
            onClick={() => { if (mustCalibrate) { setMode('calibrate'); return; } setMode('select'); }}
            disabled={mustCalibrate}
            className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${
              mode === 'select' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
          >
            Select Area
          </button>
          <button type="button"
            onClick={() => {
              if (mustCalibrate) { setMode('calibrate'); return; }
              if (mode === 'measure') {
                // Toggle off: clear lines and switch to select
                setCurrentArea([]);
                setMode('select');
              } else {
                setMode('measure');
              }
            }}
            disabled={mustCalibrate}
            className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${
              mode === 'measure' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
            title="Measure path (multi-segment)"
          >
            Measure
          </button>
          <button type="button"
            onClick={() => {
              console.log('🟥 EXCLUDE BUTTON: Current mode =', mode);
              if (mustCalibrate) { setMode('calibrate'); return; }
              if (mode === 'exclude' || mode === 'manual-exclude') { 
                console.log('🟥 EXCLUDE BUTTON: Switching back to select mode');
                setMode('select'); 
                return; 
              }
              // Always use manual-exclude mode for consistent polygon-style exclusion selection
              console.log('🟥 EXCLUDE BUTTON: Switching to manual-exclude mode');
              setMode('manual-exclude');
            }}
            disabled={mustCalibrate}
            className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${ (mode==='exclude' || mode==='manual-exclude') ? 'bg-white text-red-600 shadow-sm' : 'bg-white/20 text-white hover:bg-white/30'}`}
            title="Draw exclusion zones (polygon selection like areas)"
          >
            Exclude
          </button>
          <button type="button"
            onClick={() => { if (mustCalibrate) { setMode('calibrate'); return; } setMode('antenna'); }}
            disabled={mustCalibrate}
            className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${
              mode === 'antenna' 
                ? 'bg-white text-green-600 shadow-sm' 
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
            title="Place and manage antennas"
          >
            Antennas
          </button>
          <button type="button"
            onClick={addSelection}
            disabled={mustCalibrate || mode==='measure'}
            className="bg-green-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-600 transition-all transform hover:scale-105 shadow-sm"
            title="Add current selection to Summary"
          >
            Add
          </button>
          {/* Calibration buttons and extra options removed for simplicity */}
          <button type="button"
            onClick={clearAll}
            className="bg-red-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-600 transition-all transform hover:scale-105 shadow-sm"
          >
            Clear Selection
          </button>
          {/* Calibration entry points */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 text-white">
            <span className="text-sm font-medium">Calibrate</span>
            <button type="button"
              onClick={() => { setMode('calibrate'); setCalibrationPoints([]); setCalibrationReal(''); }}
              className={`px-3 py-1.5 rounded-md font-medium transition-all transform hover:scale-105 ${mode==='calibrate' ? 'bg-white text-orange-600 shadow-sm' : 'bg-white/20 text-white hover:bg-white/30'}`}
              title="Calibrate by known distance"
            >
              Distance
            </button>
            <button type="button"
              onClick={() => { setMode('calibrate-area'); setCalibrationAreaPoints([]); setCalibrationAreaReal(''); }}
              className={`px-3 py-1.5 rounded-md font-medium transition-all transform hover:scale-105 ${mode==='calibrate-area' ? 'bg-white text-orange-600 shadow-sm' : 'bg-white/20 text-white hover:bg-white/30'}`}
              title="Calibrate by known area"
            >
              Area
            </button>
          </div>
          <button type="button"
            onClick={undo}
            className="bg-white/20 text-white px-4 py-2 rounded-lg font-medium hover:bg-white/30 transition-all transform hover:scale-105 shadow-sm disabled:opacity-50"
            title="Undo (Ctrl+Z)"
            disabled={historyRef.current.length === 0}
          >
            Undo
          </button>
          <button type="button"
            onClick={redo}
            className="bg-white/20 text-white px-4 py-2 rounded-lg font-medium hover:bg-white/30 transition-all transform hover:scale-105 shadow-sm disabled:opacity-50"
            title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
            disabled={redoHistoryRef.current.length === 0}
          >
            Redo
          </button>
          <button type="button"
            onClick={() => { if (mustCalibrate) { setMode('calibrate'); return; } setMode(mode==='pick-hole' ? 'select' : 'pick-hole'); setAutoHolesPreview([]); setAutoHolesIndex(-1); setRoi(null); }}
            disabled={mustCalibrate}
            className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${mode==='pick-hole' ? 'bg-white text-amber-600 shadow-sm' : 'bg-white/20 text-white hover:bg-white/30'}`}
            title="Draw a rectangle around a hole to auto-select the largest hole inside"
          >
            Exclude Auto
          </button>
              {/* Auto ROI removed */}
              <button type="button"
                onClick={() => { if (mustCalibrate) { setMode('calibrate'); return; } setMode('roi'); setRoi(null); }}
                disabled={busy || mustCalibrate}
                className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${mode==='roi' ? 'bg-white text-amber-600 shadow-sm' : 'bg-white/20 text-white hover:bg-white/30'} disabled:opacity-50`}
                title="Select an object area (draw a rectangle)"
              >
                Select Auto
              </button>
              {/* Object finalization moved into Finish; Add More removed */}
              {/* Auto Holes (in Region) removed */}
              {/* Preview navigation removed for simplicity; single pick-hole flow */}
              {/* Confirm handled by Finish */}
              <button type="button"
                onClick={() => { if (mustCalibrate) { setMode('calibrate'); return; } setMode(mode==='refine' ? 'select' : 'refine'); }}
                disabled={mustCalibrate || (!perimeter && !holes.length)}
                className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${mode==='refine' ? 'bg-white text-amber-600 shadow-sm' : 'bg-white/20 text-white hover:bg-white/30'} disabled:opacity-50`}
                title="Refine (perimeter and holes)"
              >
                Refine
              </button>
              {/* Trim, Exclude mode switch, and separate Refine Holes removed */}
              {perimeter && (
                <div className="flex items-center ml-2 text-white/90 text-sm">
                  <span className="mr-2">Simplify</span>
                  <input type="range" min={2} max={40} step={1} value={simplify} onChange={(e)=>{
                    const v = parseInt(e.target.value,10) || 12; setSimplify(v);
                    if (perimeterRaw && perimeterRaw.length>3) {
                      applySimplify(v);
                    }
                  }} />
                </div>
              )}
              {perimeterConfidence !== null && (
                <span className="px-2 py-1 rounded-lg bg-white/20 text-white text-sm">conf {Math.round(perimeterConfidence*100)}%{netArea !== null ? ` • ${formatAreaDisplay(netArea)}` : (perimeterArea ? ` • ${formatAreaDisplay(perimeterArea)}` : '')}{holes.length ? ` • excl ${holes.length}` : ''}</span>
              )}
              {objects.length > 0 && (
                <span className="px-2 py-1 rounded-lg bg-white/20 text-white text-sm">objects {objects.length}</span>
              )}
              
              {/* Save and Reset buttons moved to far right */}
              {onSaveProject && (
                <button type="button"
                  onClick={() => { console.log('Canvas Save clicked'); if (onSaveProject) { onSaveProject(); } else { try { (window as any).dispatchEvent(new Event('request-save')); } catch {} } }}
                  disabled={isSaving}
                  className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 shadow-sm ml-4 text-white ${
                    isSaving ? 'bg-blue-400 cursor-not-allowed'
                    : justSaved ? 'bg-green-600'
                    : 'bg-blue-500 hover:bg-blue-600'
                  }`}
                  title="Save current project"
                >
                  {isSaving ? 'Saving…' : justSaved ? 'Saved ✓' : (isUpdate ? 'Update' : 'Save')}
                </button>
              )}
              <button type="button"
                onClick={onReset}
                className="bg-red-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-600 transition-all transform hover:scale-105 shadow-sm ml-2"
                title="Upload a different floorplan"
              >
                Reset
              </button>
          </div>
          <div className="flex items-center gap-2 ml-auto text-white self-start">
            {scale ? (
              <div className="px-3 py-1.5 bg-white/20 text-white rounded-lg text-sm backdrop-blur-sm">
        📏 Scale: {(() => {
          const mPerPx = scale;
          const pxPerM = mPerPx > 0 ? (1 / mPerPx) : 0;
          const ratio = pxPerM > 0 ? Math.ceil(pxPerM) : 0; // round up
          return `1:${ratio}`;
        })()}
                {scaleConfidence !== null && (
                  <span className="ml-2 inline-flex items-center text-xs px-2 py-0.5 rounded bg-white/30 text-white">
                    {Math.round(scaleConfidence*100)}%{scaleMethod ? ` • ${scaleMethod}` : ''}
                  </span>
                )}
              </div>
            ) : (
              <div className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-sm">⚠️ No Scale Set</div>
            )}
            <div className="flex items-center">
              <div className="bg-white/20 rounded-lg text-white text-xs overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDisplayUnit('m')}
                  className={`px-2 py-1 ${displayUnit === 'm' ? 'bg-white/30 font-semibold' : 'hover:bg-white/10'}`}
                  title="Show distances/areas in meters"
                >m</button>
                <button
                  type="button"
                  onClick={() => setDisplayUnit('ft')}
                  className={`px-2 py-1 ${displayUnit === 'ft' ? 'bg-white/30 font-semibold' : 'hover:bg-white/10'}`}
                  title="Show distances/areas in feet"
                >ft</button>
              </div>
            </div>
          </div>
        </div>

        {/* Antenna Controls */}
        {mode === 'antenna' && (
          <div className="mt-3 space-y-2 rounded-lg bg-white/10 p-3 backdrop-blur-sm text-sm text-white">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 font-medium">
                <span>📡 <strong>Antenna Mode</strong></span>
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white text-sm font-semibold cursor-help"
                  title="Click to place • Drag to move • Ctrl+Click to select • Alt+Click to delete"
                >
                  ?
                </span>
              </div>
              <SmartAutoPlaceButton
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg shadow-sm hover:bg-green-700 disabled:opacity-40"
                onClick={() => {
                console.log('Auto Place clicked with data:', {
                  perimeter: perimeter?.length,
                  scale,
                  currentArea: currentArea.length,
                  savedAreas: savedAreas.length,
                  antennaRange,
                  spacingPercent: normalizedSpacingPercent,
                  overlapPercent,
                  placementMode
                });
                
                if (!scale) {
                  alert('Please set a scale first by calibrating the distance or area.');
                  return;
                }
                
                // Determine which areas to use for antenna placement
                let areasToUse = [];
                if (perimeter && perimeter.length >= 3) {
                  areasToUse = [perimeter];
                } else if (currentArea.length >= 3) {
                  areasToUse = [currentArea];
                } else if (savedAreas.length > 0) {
                  areasToUse = savedAreas;
                } else {
                  alert('Please select an area first or draw a perimeter for antenna placement.');
                  return;
                }
                
                console.log('🟩 SMART PLACE: Placing antennas in areas:', areasToUse.length);
                console.log('🟩 SMART PLACE: holes =', holes.length, holes);
                console.log('🟩 SMART PLACE: manualHoles =', manualHoles.length, manualHoles);
                console.log('🟩 SMART PLACE: savedExclusions =', savedExclusions.length, savedExclusions);
                console.log('🟩 SMART PLACE: autoHolesPreview =', autoHolesPreview.length, autoHolesPreview);
                
                // Debug: log the actual exclusion zone coordinates
                const allExclusions = [...holes, ...manualHoles, ...savedExclusions, ...autoHolesPreview];
                console.log('🟩 SMART PLACE: ALL EXCLUSIONS DETAILED:', allExclusions.map((exc, i) => ({
                  index: i,
                  points: exc.length,
                  coordinates: exc.length > 0 ? exc.slice(0, 3).map(p => `(${p.x?.toFixed(1) || 'undefined'}, ${p.y?.toFixed(1) || 'undefined'})`) : [],
                  firstPoint: exc[0]
                })));
                console.log('🟩 SMART PLACE: Total exclusions being passed =', allExclusions.length);
                
                const canvasToImageScale = computeCanvasToImageScale();

                // Generate antennas using shared buffered solver
                const placedAntennas = simpleAutoPlaceAntennas({
                  savedAreas: areasToUse,
                  scale,
                  defaultAntennaRange: antennaRange,
                  defaultAntennaPower: 50,
                  isPointInPolygon,
                  exclusions: allExclusions,
                  gridSpacingPercent: normalizedSpacingPercent,
                  canvasToImageScale,
                  placementMode,
                });
                
                if (placedAntennas.length > 0) {
                  pushHistory();
                  setAntennas(placedAntennas);
                  setSelectedAntennaId(null);
                  setPreviewAntennas([]); // Clear any existing preview
                  console.log('🟩 SMART PLACE: Placed', placedAntennas.length, 'antennas');
                } else {
                  alert('No antennas could be placed. Check your area selection and exclusion zones.');
                }
                }}
                perimeter={perimeter}
                savedAreas={savedAreas}
                objects={objects}
                selection={currentArea.length > 0 ? currentArea : null}
                scale={scale}
              />
              <button
                onClick={() => {
                console.log('Coverage button clicked, current state:', showCoverage);
                setShowCoverage(!showCoverage);
                // Remove forced redraw - let React handle it naturally
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                showCoverage 
                  ? 'bg-green-500 text-white shadow-sm' 
                  : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                Coverage
              </button>
              <button
                onClick={() => {
                console.log('Boundaries button clicked, current state:', showRadiusBoundary);
                setShowRadiusBoundary(!showRadiusBoundary);
                // Let React handle redraw naturally
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                showRadiusBoundary 
                  ? 'bg-blue-500 text-white shadow-sm' 
                  : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                Boundaries
              </button>
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white/5 px-2 py-1 text-xs sm:text-sm">
                <span>Radius:</span>
                <input
                  type="range"
                  min="1"
                  max="30"
                  step="0.5"
                  value={selectedAntennaId ? (antennas.find(a => a.id === selectedAntennaId)?.range ?? antennaRange) : antennaRange}
                  onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (selectedAntennaId) {
                    pushHistory();
                    // Edit only the selected antenna's radius
                    setAntennas(prev => prev.map(a => a.id === selectedAntennaId ? { ...a, range: v } : a));
                  } else {
                    // Global change: update default and only antennas that matched the previous default
                    const old = antennaRange;
                    if (v !== old) pushHistory();
                    setAntennaRange(v);
                    if (antennas.length > 0) {
                      setAntennas(prev => prev.map(a => (a.range === old ? { ...a, range: v } : a)));
                    }
                    if (previewAntennas.length > 0) {
                      setPreviewAntennas(prev => prev.map(a => ({ ...a, range: v })));
                    }
                  }
                  }}
                  className="w-24"
                />
                <input
                  type="number"
                  min="1"
                  max="50"
                  step="0.1"
                  value={selectedAntennaId ? (antennas.find(a => a.id === selectedAntennaId)?.range ?? antennaRange) : antennaRange}
                  onChange={(e) => {
                  const v = parseFloat(e.target.value) || 1;
                  if (selectedAntennaId) {
                    pushHistory();
                    // Edit only the selected antenna's radius
                    setAntennas(prev => prev.map(a => a.id === selectedAntennaId ? { ...a, range: v } : a));
                  } else {
                    // Global change: update default and only antennas that matched the previous default
                    const old = antennaRange;
                    if (v !== old) pushHistory();
                    setAntennaRange(v);
                    if (antennas.length > 0) {
                      setAntennas(prev => prev.map(a => (a.range === old ? { ...a, range: v } : a)));
                    }
                    if (previewAntennas.length > 0) {
                      setPreviewAntennas(prev => prev.map(a => ({ ...a, range: v })));
                    }
                  }
                  }}
                  className="w-12 px-1 py-0.5 rounded bg-white/20 text-white text-center text-xs border border-white/30 focus:border-white/50 focus:outline-none"
                />
                <span>m</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs sm:text-sm">Overlap</span>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="1"
                    value={overlapPercent}
                    onChange={(e) => handleOverlapChange(parseInt(e.target.value, 10))}
                    className="w-28"
                  />
                  <span className="text-xs sm:text-sm w-10">{overlapPercent}%</span>
                </div>
              </div>
              <button
                onClick={() => {
                console.log('Clearing antennas...');
                pushHistory();
                setAntennas([]);
                setSelectedAntennaId(null);
                // No need for setTimeout - useEffect will handle redraw
                }}
                className="bg-red-500/80 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-500 transition-all"
              >
                Clear Antennas
              </button>
              <button
                type="button"
                onClick={captureAntennaScreenshot}
                disabled={isCapturingScreenshot}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
                  isCapturingScreenshot
                    ? 'bg-white/40 text-slate-600 cursor-progress'
                    : 'bg-indigo-500 text-white hover:bg-indigo-600'
                }`}
                title="Capture the current antenna layout with summary"
              >
                {isCapturingScreenshot ? 'Capturing…' : 'Screenshot'}
              </button>
              {antennas.length > 0 && (
                <div className="text-white/90 text-sm bg-white/10 px-3 py-1.5 rounded-lg backdrop-blur-sm">
                  <span className="font-medium">{antennas.length}</span> antenna{antennas.length !== 1 ? 's' : ''} placed
                </div>
              )}
            </div>

            {screenshotMessage && (
              <div data-ignore-screenshot="true" className="flex items-center gap-2 rounded-md bg-white/15 px-3 py-2 text-sm text-white/95 shadow-sm">
                <span role="img" aria-label="Camera">📸</span>
                <span>{screenshotMessage}</span>
              </div>
            )}

            {selectedAntennaId && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-white/80 border-t border-white/10 pt-2 mt-1">
                <span className="rounded bg-white/15 px-2 py-0.5 uppercase tracking-wide text-white/85">
                  Editing selected antenna
                </span>
                <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-white">
                  Selected: {antennas.find(a => a.id === selectedAntennaId)?.id.slice(-4)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const sel = antennas.find(a => a.id === selectedAntennaId);
                    if (!sel || sel.range === antennaRange) return;
                    pushHistory();
                    setAntennas(prev => prev.map(a => (a.id === selectedAntennaId ? { ...a, range: antennaRange } : a)));
                  }}
                  disabled={(antennas.find(a => a.id === selectedAntennaId)?.range ?? antennaRange) === antennaRange}
                  className="px-2 py-0.5 rounded border border-white/25 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-50"
                  title="Reset selected antenna to the global radius"
                >
                  Reset to global radius
                </button>
              </div>
            )}
          </div>
        )}
        
        {/* Refine Mode Instructions */}
        {mode === 'refine' && (
          <div className="px-3 py-1.5 bg-blue-500/20 text-white rounded-lg text-sm backdrop-blur-sm">
            🔧 Refine: Drag to move • Alt+click to delete • Ctrl+click to add dots
          </div>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative flex flex-1 min-h-0 items-end overflow-hidden"
        style={{
          overscrollBehavior: 'contain',
          touchAction: 'none',
          paddingLeft: CANVAS_EDGE_MARGIN,
          paddingTop: CANVAS_VERTICAL_PADDING,
          paddingBottom: CANVAS_VERTICAL_PADDING,
          paddingRight: CANVAS_EDGE_MARGIN,
        }}
      >
        {imageLoaded ? (
          <div className="flex h-full w-full items-end justify-start">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={preventContext}
      data-main-canvas="1"
      className={`block border border-gray-200 ${isPanCursor ? 'cursor-grabbing' : 'cursor-crosshair'} shadow-lg rounded`}
              style={{ 
                width: canvasSize.width || undefined,
                height: canvasSize.height || undefined,
                maxWidth: '100%',
                maxHeight: '100%',
              }}
            />
          </div>
        ) : imageUrl ? (
          <div className="flex items-center justify-center h-64 text-gray-500">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
              <p>Loading image...</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-500">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p>No image loaded</p>
            </div>
          </div>
        )}
      </div>

      {/* Calibration Panel */}
      {mode === 'calibrate' && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[1100] p-3 rounded-lg bg-orange-50/95 border border-orange-200 shadow">
          <div className="flex flex-wrap items-center gap-3 text-sm text-orange-900">
            <span className="font-medium">Calibration:</span>
            <span>{calibrationPoints.length} point(s) selected{calibrationPoints.length === 2 ? ` • ${calibrationDistancePx().toFixed(3)} px` : ''}</span>
            <input type="number" step="any" placeholder="Known distance" value={calibrationReal} onChange={(e)=> setCalibrationReal(e.target.value)} className="px-2 py-1 border rounded" style={{minWidth:120}} />
            <select value={calibrationUnit} onChange={e=> setCalibrationUnit(e.target.value)} className="px-2 py-1 border rounded">
              <option value="meters">meters</option>
              <option value="feet">feet</option>
              <option value="centimeters">centimeters</option>
              <option value="millimeters">millimeters</option>
            </select>
            <button onClick={applyCalibration} className="px-3 py-1.5 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50" disabled={calibrationPoints.length !== 2 || !calibrationReal}>Apply</button>
          </div>
        </div>
      )}

      {/* Calibrate by Area Panel */}
      {mode === 'calibrate-area' && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[1100] p-3 rounded-lg bg-orange-50/95 border border-orange-200 shadow">
          <div className="flex flex-wrap items-center gap-3 text-sm text-orange-900">
            <span className="font-medium">Calibrate by Area:</span>
            <span>{calibrationAreaPoints.length} point(s){calibrationAreaPoints.length >= 3 && image ? ` • ${areaPixels(calibrationAreaPoints).toFixed(2)} px²` : ''}</span>
            <input type="number" step="any" placeholder="Known area" value={calibrationAreaReal} onChange={(e)=> setCalibrationAreaReal(e.target.value)} className="px-2 py-1 border rounded" style={{minWidth:120}} />
            <select value={calibrationUnit} onChange={e=> setCalibrationUnit(e.target.value)} className="px-2 py-1 border rounded">
              <option value="meters">m²</option>
              <option value="feet">ft²</option>
              <option value="centimeters">cm²</option>
              <option value="millimeters">mm²</option>
            </select>
            <button onClick={applyCalibrationByArea} className="px-3 py-1.5 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50" disabled={calibrationAreaPoints.length < 3 || !calibrationAreaReal}>Apply</button>
          </div>
        </div>
      )}

  {/* Area Results - Professional */}
  {(selections.length > 0 || floors.length > 0) && (
        <div
          ref={summaryRef}
          className="absolute z-[1100] p-4 bg-white/95 border rounded-lg shadow flex flex-col min-w-80 max-w-96"
          style={{ top: summaryTopOffset, bottom: CANVAS_VERTICAL_PADDING, right: CANVAS_EDGE_MARGIN }}>
          <h3 className="font-semibold text-gray-900 mb-4">Summary</h3>

          {/* Floors Panel - Always show so Add Floor button is available */}
          <FloorsPanel
            floors={floors}
            currentFloorId={currentFloorId}
            onSelectFloor={onSelectFloor || (() => {})}
            onRenameFloor={onRenameFloor || (() => {})}
            onDeleteFloor={onDeleteFloor || (() => {})}
            onAddFloor={onAddFloor || (() => {})}
            isLoading={floorsLoading}
            onDetectFloorName={onDetectFloorName}
            aiNameStatus={floorNameAiStatus}
            className="flex-1 overflow-y-auto pr-1"
          />
        </div>
      )}

  {/* Current area/path status - Professional */}
  {currentArea.length > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[1100] p-3 rounded-lg bg-blue-50/95 border border-blue-200 shadow">
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
              <svg width="12" height="12" className="text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
              </svg>
            </div>
            <div>
<p className="text-sm font-medium text-blue-800">{mode === 'measure' ? 'Measuring distance' : 'Drawing area'}</p>
<p className="text-xs text-blue-600">{currentArea.length} points selected{mode === 'measure' ? ' • Add is disabled in Measure' : (currentArea.length >= 3 ? ' • Click "Add" to complete' : ` • ${3 - currentArea.length} more points needed`)}</p>
            </div>
          </div>
        </div>
      )}
    {(mode === 'edit-poly' || mode==='refine') && perimeter && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[1100] p-3 rounded-lg bg-amber-50/95 border border-amber-200 shadow text-amber-900 text-sm">
      Drag vertices (perimeter and holes). Ctrl+click near an edge to add a point. Alt+click a vertex to delete.
        </div>
      )}
    {(mode === 'edit-hole' || mode==='refine') && holes.length > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[1100] p-3 rounded-lg bg-red-50/95 border border-red-200 shadow text-red-900 text-sm">
          Drag hole vertices. Ctrl+click near an edge to add a point. Alt+click a vertex to delete.
        </div>
      )}
    </div>
  );

  // Build calibration overlay (rendered via portal). Hide immediately once user enters calibration.
  const shouldShowOverlay = mustCalibrate && (mode !== 'calibrate' && mode !== 'calibrate-area');
  useEffect(() => {
    // no-op; reserved for future analytics hooks
  }, [shouldShowOverlay]);

  const releaseModalRoot = useCallback(() => {
    try {
      const el = typeof document !== 'undefined' ? document.getElementById('modal-root') : null;
      if (!el) return;
      el.style.pointerEvents = 'none';
      el.setAttribute('data-active', '0');
    } catch {}
  }, []);

  // Ensure overlay fully releases interaction when entering calibrate modes
  useEffect(() => {
    if (mode === 'calibrate' || mode === 'calibrate-area') {
      if ('requestAnimationFrame' in window) requestAnimationFrame(releaseModalRoot); else setTimeout(releaseModalRoot, 0);
    }
  }, [mode, releaseModalRoot]);

  const handleChooseCalibrate = useCallback((which: 'calibrate'|'calibrate-area') => {
    setMode(which);
    if ('requestAnimationFrame' in window) requestAnimationFrame(releaseModalRoot); else setTimeout(releaseModalRoot, 0);
  }, [releaseModalRoot]);

  const overlay = shouldShowOverlay ? (
    <Portal>
      <div id="calibration-overlay" style={{ position: 'absolute', inset: 0 as any, zIndex: 2147483646, pointerEvents: 'auto' }}>
        <div style={{ position: 'absolute', inset: 0 as any, background: 'rgba(0,0,0,0.35)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '100%', maxWidth: 520, background: '#fff', borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,0.35)', border: '1px solid rgba(0,0,0,0.08)', padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', marginBottom: 8 }}>Calibration required</h2>
          <p style={{ fontSize: 14, color: '#4B5563', marginBottom: 16 }}>Set the scale before measuring. Choose a known distance (Calibrate Distance) or a known area (Calibrate Area).</p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => handleChooseCalibrate('calibrate')} style={{ flex: 1, padding: '10px 16px', borderRadius: 8, background: '#EA580C', color: '#fff' }}>Calibrate Distance</button>
            <button onClick={() => handleChooseCalibrate('calibrate-area')} style={{ flex: 1, padding: '10px 16px', borderRadius: 8, background: '#FFEDD5', color: '#7C2D12' }}>Calibrate Area</button>
          </div>
        </div>
      </div>
    </Portal>
  ) : null;

  // Safety: when overlay hides, ensure the modal portal releases clicks
  useEffect(() => {
    if (shouldShowOverlay) return;
    // Defer to next frame to run after unmount
    if ('requestAnimationFrame' in window) requestAnimationFrame(releaseModalRoot); else setTimeout(releaseModalRoot, 0);
  }, [shouldShowOverlay, releaseModalRoot]);

  const contentZ = 2147483600; // slightly lower than overlay
  const contentStyle: React.CSSProperties = { zIndex: contentZ };

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // No fallback injection needed; overlay is rendered via portal only now.

  return (
    <>
      <div id="measure-overlay" data-keep="true" className="fixed inset-0 bg-white overflow-hidden flex flex-col min-h-0" style={contentStyle}>
        {content}
      </div>
  {mounted && overlay}
    </>
  );
}

// Douglas–Peucker polyline simplification (closed polygon supported)
function simplifyDouglasPeucker(points: {x:number;y:number}[], epsilon: number, forceClosed = false) {
  if (!points || points.length < 3) return points;
  // Ensure closed by duplicating first at end during calc
  const isClosed = forceClosed || Math.hypot(points[0].x - points[points.length-1].x, points[0].y - points[points.length-1].y) < 1e-6;
  const pts = isClosed ? points.slice(0, points.length-1) : points.slice();
  function dp(ptsArr: {x:number;y:number}[], start: number, end: number, out: boolean[]) {
    let maxDist = 0; let index = -1;
    const a = ptsArr[start], b = ptsArr[end];
    for (let i=start+1; i<end; i++) {
      const d = pointLineDistance(ptsArr[i], a, b);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > epsilon && index !== -1) {
      dp(ptsArr, start, index, out);
      dp(ptsArr, index, end, out);
    } else {
      out[start] = true; out[end] = true;
    }
  }
  function pointLineDistance(p:{x:number;y:number}, a:{x:number;y:number}, b:{x:number;y:number}) {
    const A = p.x - a.x, B = p.y - a.y, C = b.x - a.x, D = b.y - a.y;
    const dot = A*C + B*D;
    const len_sq = C*C + D*D;
    let param = len_sq ? (dot / len_sq) : -1;
    let xx, yy;
    if (param < 0) { xx = a.x; yy = a.y; }
    else if (param > 1) { xx = b.x; yy = b.y; }
    else { xx = a.x + param * C; yy = a.y + param * D; }
    const dx = p.x - xx; const dy = p.y - yy; return Math.hypot(dx, dy);
  }
  const outFlags: boolean[] = new Array(pts.length).fill(false);
  dp(pts, 0, pts.length-1, outFlags);
  const res = pts.filter((_,i)=> outFlags[i]);
  if (isClosed) res.push(res[0]);
  return res;
}
