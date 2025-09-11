'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SmartAutoPlaceButton from './SmartAutoPlaceButton';
import useFixAutoPlaceButton from '@/hooks/useFixAutoPlaceButton';
import { simpleAutoPlaceAntennas } from '@/utils/antennaUtils';
// Trim now runs in a Web Worker at /workers/trim-opencv.js to avoid blocking UI

interface FloorplanCanvasProps {
  imageUrl: string;
  scale: number | null;
  scaleUnit: string;
  onCalibrate?: (scale: number, unit: string) => void;
  requestCalibrateToken?: number; // increment to start calibrate from outside
  requestFullscreenToken?: number; // increment to open fullscreen from outside
  onFullscreenChange?: (isFs: boolean) => void;
  onTrimmedImage?: (croppedDataUrl: string, quad?: {x:number;y:number}[], confidence?: number) => void;
  onScaleDetected?: (unitsPerPixel: number, unit: string, method?: string, confidence?: number) => void;
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

export default function FloorplanCanvas({ imageUrl, scale, scaleUnit, onCalibrate, requestCalibrateToken, requestFullscreenToken, onFullscreenChange, onTrimmedImage, onScaleDetected }: FloorplanCanvasProps) {
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
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [currentArea, setCurrentArea] = useState<Point[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [mode, setMode] = useState<'select' | 'measure' | 'calibrate' | 'calibrate-area' | 'roi' | 'edit-poly' | 'exclude' | 'pick-hole' | 'edit-hole' | 'manual-exclude' | 'refine' | 'antenna'>('select');
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [calibrationReal, setCalibrationReal] = useState<string>("");
  const [calibrationUnit, setCalibrationUnit] = useState<string>('meters');
  // Calibrate by Area
  const [calibrationAreaPoints, setCalibrationAreaPoints] = useState<Point[]>([]);
  const [calibrationAreaReal, setCalibrationAreaReal] = useState<string>("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x:0, y:0});
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef<{x:number;y:number}|null>(null);
  const [isPanCursor, setIsPanCursor] = useState(false);
  const suppressClickRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scaleConfidence, setScaleConfidence] = useState<number | null>(null);
  const [scaleMethod, setScaleMethod] = useState<string | null>(null);
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
  
  // Antenna placement feature
  const [antennas, setAntennas] = useState<Antenna[]>([]);
  const [selectedAntennaId, setSelectedAntennaId] = useState<string | null>(null);
  const [showCoverage, setShowCoverage] = useState<boolean>(true);
  const [showRadiusBoundary, setShowRadiusBoundary] = useState<boolean>(true);
  // Always force coverage to be visible for debugging
  useEffect(() => {
    setShowCoverage(true);
  }, []);
  const [isDraggingAntenna, setIsDraggingAntenna] = useState<boolean>(false);
  const [isPlacingAntennas, setIsPlacingAntennas] = useState<boolean>(false); // Flag for auto-placement in progress
  const [antennaRange, setAntennaRange] = useState<number>(5); // Default 5m range (changed from 25m)
  const [antennaDensity, setAntennaDensity] = useState<number>(130); // Default density 130% (grid spacing percentage)
  const [previewAntennas, setPreviewAntennas] = useState<Antenna[]>([]); // For live preview
  
  // Redraw canvas when antennas, preview, or coverage settings change
  useEffect(() => {
    console.log('Antenna state changed, redrawing canvas. Antennas:', antennas.length, 'Preview:', previewAntennas.length, 'Coverage:', showCoverage);
    if (imageLoaded) {
      drawCanvas();
    }
  }, [antennas, previewAntennas, showCoverage, showRadiusBoundary]);
  
  // History for Undo: snapshot all relevant measurable state
  type Snapshot = {
    areas: Area[];
    currentArea: Point[];
    calibrationPoints: Point[];
    calibrationAreaPoints: Point[];
    calibrationAreaReal: string;
    perimeter: Point[] | null;
    perimeterRaw: Point[] | null;
    holes: Point[][];
    objects: ObjectRegion[];
    justSavedObject: boolean;
    autoHolesPreview: Point[][];
    autoHolesIndex: number;
    antennas: Antenna[]; // Added for antenna state
    excludeCurrent: Point[];
    roi: {x:number;y:number;w:number;h:number} | null;
    mode: typeof mode;
    manualRegions: Point[][];
    manualHoles: Point[][];
    manualResult: number | null;
    selections: SelectionEntry[];
    savedAreas: Point[][];
    savedExclusions: Point[][];
  };

  const historyRef = useRef<Snapshot[]>([]);
  const draggingVertexIdxRef = useRef<number | null>(null);
  const draggingHoleIndexRef = useRef<number | null>(null);
  const draggingAntennaIdRef = useRef<string | null>(null);
  const draggingTargetRef = useRef<'perimeter' | 'currentArea' | 'calArea' | 'hole' | null>(null);
  // Preserve view (zoom/pan) across image replacements (e.g., after Trim)
  const preserveViewRef = useRef<null | { compositeScale: number; centerImg: {x:number;y:number} }>(null);
  // Track last image url we've auto-opened for
  const lastAutoFsForUrlRef = useRef<string | null>(null);
  const lastFsTokenRef = useRef<number | undefined>(undefined);
  // Mandatory calibration gating
  const mustCalibrate = !scale;

  // Load image when imageUrl changes
  useEffect(() => {
    if (!imageUrl) {
      setImage(null);
      setImageLoaded(false);
      return;
    }

    setImageLoaded(false);
    const img = new Image();

    img.onload = () => {
      setImage(img);

      // Calculate display size to fit available container width while preserving aspect ratio (avoid height-driven jitter)
      const recalc = () => {
        const container = containerRef.current;
        if (!container) return;
        const availW = container.clientWidth || window.innerWidth;
        const scale = Math.min(availW / img.width, 1);
        const displayWidth = Math.max(1, Math.floor(img.width * scale));
        const displayHeight = Math.max(1, Math.floor(img.height * scale));
        setCanvasSize(prev => {
          if (Math.abs((prev?.width||0) - displayWidth) < 2 && Math.abs((prev?.height||0) - displayHeight) < 2) return prev;
          return { width: displayWidth, height: displayHeight };
        });
        setImageLoaded(true);
      };
      recalc();
    };
    
    img.onerror = () => {
      console.error('Failed to load image');
      // Don't clear an already-visible image; only prevent switching
      if (!image) {
        alert('Failed to load image. Please try a different file.');
        setImageLoaded(false);
      }
    };
    
    img.src = imageUrl;
  }, [imageUrl]);

  // Auto-open fullscreen when the new image has actually loaded
  useEffect(() => {
    if (imageLoaded && imageUrl && lastAutoFsForUrlRef.current !== imageUrl) {
      setIsFullscreen(true);
      lastAutoFsForUrlRef.current = imageUrl;
    }
  }, [imageLoaded, imageUrl]);

  // Scroll to top when entering fullscreen to avoid any off-screen artifacts
  useEffect(() => {
    if (isFullscreen) {
      try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior }); } catch { window.scrollTo(0, 0); }
    }
  onFullscreenChange && onFullscreenChange(isFullscreen);
  }, [isFullscreen]);

  // Recalculate canvas size on container resize or fullscreen toggle
  useEffect(() => {
    if (!image) return;
    const recalc = () => {
      const container = containerRef.current;
      if (!container) return;
      const availW = container.clientWidth || window.innerWidth;
      const scaleFit = Math.min(availW / image.width, 1);
      const displayWidth = Math.max(1, Math.floor(image.width * scaleFit));
      const displayHeight = Math.max(1, Math.floor(image.height * scaleFit));
      setCanvasSize(prev => {
        if (Math.abs((prev?.width||0) - displayWidth) < 2 && Math.abs((prev?.height||0) - displayHeight) < 2) return prev;
        return { width: displayWidth, height: displayHeight };
      });
    };
    recalc();
    const ro = new ResizeObserver(() => recalc());
    if (containerRef.current) ro.observe(containerRef.current);
    const onWin = () => recalc();
    window.addEventListener('resize', onWin);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWin);
    };
  }, [image, isFullscreen]);
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
  }, [imageLoaded, image, canvasSize, areas, currentArea, mode, calibrationPoints, calibrationAreaPoints, holes, excludeCurrent, autoHolesPreview, zoom, pan, roi, perimeter]);

  // Auto-enter calibration if no scale is set
  useEffect(() => {
    if (imageLoaded && mustCalibrate && mode !== 'calibrate' && mode !== 'calibrate-area') {
      setMode('calibrate');
    }
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
          const formatDist = (val: number) => `${val.toFixed(2)} ${scaleUnit}`;

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
            const segUnits = Math.hypot(dx, dy) * scale;
            totalUnits += segUnits;
            // mid-point for label in canvas coords
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            drawLabel(mx, my, formatDist(segUnits));
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
        ctx.fillText(`${area.toFixed(2)} m²`, centerX, centerY + 10);
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
    
    // Convert from pixels to real units
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
      setMode('select');
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
    setMode('select');
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
    setMode('select');
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
      calibrationPoints: calibrationPoints.map(p=>({...p})),
      calibrationAreaPoints: calibrationAreaPoints.map(p=>({...p})),
      calibrationAreaReal,
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
    };
    historyRef.current.push(snap);
    if (historyRef.current.length > 50) historyRef.current.shift();
  }
  function undo() {
    const last = historyRef.current.pop();
    if (!last) return;
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
  }

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
    const s = real / px; // units per pixel (image coordinates)
    onCalibrate && onCalibrate(s, calibrationUnit);
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
    const upp = Math.sqrt(realArea / pxArea);
    if (!isFinite(upp) || upp <= 0) { alert('Failed to compute scale from area.'); return; }
    onCalibrate && onCalibrate(upp, calibrationUnit);
    setCalibrationAreaPoints([]);
    setCalibrationAreaReal('');
    setMode('select');
  };

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
      
      // Add antenna dragging support
      if (mode === 'antenna' && antennas.length > 0) {
        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        let cx = (e.clientX - rect.left) * (canvas.width / rect.width);
        let cy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const wx = (cx - pan.x) / zoom; const wy = (cy - pan.y) / zoom;
        
        // Find the nearest antenna
        const thr = 15 / Math.max(0.2, zoom);
        for (let i = 0; i < antennas.length; i++) {
          const antenna = antennas[i];
          const d = Math.hypot(wx - antenna.position.x, wy - antenna.position.y);
          if (d <= thr) {
            // Start dragging this antenna
            draggingAntennaIdRef.current = antenna.id;
            suppressClickRef.current = true; // Prevent click event from firing
            return;
          }
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
      const newAntennas = simpleAutoPlaceAntennas({
        savedAreas,
        scale,
        defaultAntennaRange: antennaRange, // Use current range setting
        defaultAntennaPower: 50, // Fixed power value
        isPointInPolygon,
        exclusions: [...holes, ...manualHoles, ...savedExclusions, ...autoHolesPreview],
        gridSpacingPercent: antennaDensity, // Pass density to algorithm
        placementMode: 'adaptive',
      });
      
      setAntennas(newAntennas);
      console.log(`Placed ${newAntennas.length} antennas`);
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
      // Use current settings to generate preview
      const gridSpacingPercent = antennaDensity; // 100-200% range
      console.log('🔵 PREVIEW: Generating preview with density =', gridSpacingPercent);
      
      const previewAntennas = simpleAutoPlaceAntennas({
        savedAreas: areasToUse,
        scale,
        defaultAntennaRange: antennaRange,
        defaultAntennaPower: 50, // Fixed power for preview
        isPointInPolygon,
        exclusions: [...holes, ...manualHoles, ...savedExclusions, ...autoHolesPreview],
        gridSpacingPercent // Pass density to algorithm
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

  // Outside trigger to start calibrate
  useEffect(() => {
    if (requestCalibrateToken !== undefined) {
  setMode('calibrate');
  setCalibrationPoints([]);
  setCalibrationAreaPoints([]);
  setCalibrationAreaReal('');
    }
  }, [requestCalibrateToken]);

  // Global shortcuts: Escape exit fullscreen, Ctrl/Cmd+Z undo, M toggle Measure/Select
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key?.toLowerCase?.() || '';
      if (key === 'escape') {
        setIsFullscreen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); undo(); return; }
      if (key === 'm') {
        e.preventDefault();
        if (mustCalibrate) { setMode('calibrate'); return; }
        setMode(prev => (prev === 'measure' ? 'select' : 'measure'));
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mustCalibrate]);

  // Outside trigger to open fullscreen ONLY when token changes
  useEffect(() => {
    if (requestFullscreenToken === undefined) return;
    if (lastFsTokenRef.current === undefined) {
      // Initialize without triggering on first mount
      lastFsTokenRef.current = requestFullscreenToken;
      return;
    }
    if (requestFullscreenToken !== lastFsTokenRef.current) {
      setIsFullscreen(true);
      lastFsTokenRef.current = requestFullscreenToken;
    }
  }, [requestFullscreenToken]);

  // Prevent page scroll while zooming over the canvas/container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (ev: WheelEvent) => { if (el.contains(ev.target as Node)) { ev.preventDefault(); } };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler as any);
  }, []);

  // Lock body scroll when fullscreen overlay is open
  useEffect(() => {
    if (!isFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isFullscreen]);

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
  const areaSummaries = areas.map((area, index) => ({
    label: `Area ${index + 1}`,
    value: area.area || 0
  }));
  
  // Calculate total from both manual selections and saved areas
  const manualTotal = selections.reduce((s, it) => s + it.value, 0);
  const savedAreasTotal = areaSummaries.reduce((s, it) => s + it.value, 0);
  const consolidatedTotal = manualTotal + savedAreasTotal;

  const content = (
    <div className="flex flex-col relative h-full min-h-0">
      {/* Controls */}
      <div className="bg-gradient-to-r from-blue-500 to-orange-500 px-6 py-4 flex justify-between items-center flex-wrap gap-3">
        <div className="flex items-center space-x-3">
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
            onClick={() => { if (mustCalibrate) { setMode('calibrate'); return; } setMode('measure'); }}
            disabled={mustCalibrate}
            className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${
              mode === 'measure' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
            title="Measure Distance (multi-segment path)"
          >
            Measure Distance
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
            Clear All
          </button>
          {/* Calibration entry points */}
          <button type="button"
            onClick={() => { setMode('calibrate'); setCalibrationPoints([]); setCalibrationReal(''); }}
            className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${mode==='calibrate' ? 'bg-white text-orange-600 shadow-sm' : 'bg-white/20 text-white hover:bg-white/30'}`}
            title="Calibrate by known distance"
          >
            Calibrate Distance
          </button>
          <button type="button"
            onClick={() => { setMode('calibrate-area'); setCalibrationAreaPoints([]); setCalibrationAreaReal(''); }}
            className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${mode==='calibrate-area' ? 'bg-white text-orange-600 shadow-sm' : 'bg-white/20 text-white hover:bg-white/30'}`}
            title="Calibrate by known area"
          >
            Calibrate Area
          </button>
          <button type="button"
            onClick={undo}
            className="bg-white/20 text-white px-4 py-2 rounded-lg font-medium hover:bg-white/30 transition-all transform hover:scale-105 shadow-sm"
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
      {isFullscreen && (
            <>
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
                className="bg-white/20 text-white px-4 py-2 rounded-lg font-medium hover:bg-white/30 transition-all transform hover:scale-105 shadow-sm disabled:opacity-50"
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
                <span className="px-2 py-1 rounded-lg bg-white/20 text-white text-sm">conf {Math.round(perimeterConfidence*100)}%{netArea !== null ? ` • ${netArea.toFixed(2)} m²` : (perimeterArea ? ` • ${perimeterArea.toFixed(2)} m²` : '')}{holes.length ? ` • excl ${holes.length}` : ''}</span>
              )}
              {objects.length > 0 && (
                <span className="px-2 py-1 rounded-lg bg-white/20 text-white text-sm">objects {objects.length}</span>
              )}
            </>
          )}
          <button type="button"
            onClick={() => setIsFullscreen(v => !v)}
            className="bg-white/20 text-white px-4 py-2 rounded-lg font-medium hover:bg-white/30 transition-all transform hover:scale-105 shadow-sm"
            title={isFullscreen ? 'Exit fullscreen' : 'Open fullscreen'}
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
        
        {/* Antenna Controls */}
        {mode === 'antenna' && (
          <div className="flex items-center space-x-3 mt-3 p-3 bg-white/10 rounded-lg backdrop-blur-sm">
            <div className="text-white text-sm font-medium">
              📡 <strong>Antenna Mode</strong> • Click to place • Drag to move • Ctrl+Click to select • Alt+Click to delete
            </div>
            
            <SmartAutoPlaceButton 
              onClick={() => {
                console.log('Auto Place clicked with data:', {
                  perimeter: perimeter?.length,
                  scale,
                  currentArea: currentArea.length,
                  savedAreas: savedAreas.length,
                  antennaRange,
                  antennaDensity
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
                
                // Generate antennas directly (don't rely on preview)
                const placedAntennas = simpleAutoPlaceAntennas({
                  savedAreas: areasToUse,
                  scale,
                  defaultAntennaRange: antennaRange,
                  defaultAntennaPower: 50, // Fixed power as we removed power controls
                  isPointInPolygon,
                  exclusions: allExclusions,
                  gridSpacingPercent: antennaDensity,
                  placementMode: 'adaptive',
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
            
            <div className="flex items-center space-x-2 text-white text-sm">
              <span>Radius:</span>
              <input
                type="range"
                min="3"
                max="15"
                step="0.5"
                value={antennaRange}
                onChange={(e) => setAntennaRange(parseFloat(e.target.value))}
                className="w-20"
              />
              <input
                type="number"
                min="1"
                max="100"
                step="0.1"
                value={antennaRange}
                onChange={(e) => setAntennaRange(parseFloat(e.target.value) || 5)}
                className="w-12 px-1 py-0.5 rounded bg-white/20 text-white text-center text-xs border border-white/30 focus:border-white/50 focus:outline-none"
              />
              <span>m</span>
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
            
            {antennas.length > 0 && (
              <div className="text-white/90 text-sm bg-white/10 px-3 py-1.5 rounded-lg backdrop-blur-sm">
                <span className="font-medium">{antennas.length}</span> antenna{antennas.length !== 1 ? 's' : ''} placed
              </div>
            )}
            
            {selectedAntennaId && (
              <div className="text-white/80 text-xs bg-white/10 px-2 py-1 rounded">
                Selected: {antennas.find(a => a.id === selectedAntennaId)?.id.slice(-4)}
              </div>
            )}
          </div>
        )}
        
        <div className="flex items-center space-x-2">
      {scale ? (
            <div className="px-3 py-1.5 bg-white/20 text-white rounded-lg text-sm backdrop-blur-sm">
        📏 Scale: 1cm = {(scale * 10).toFixed(1)}m
              {isFullscreen && scaleConfidence !== null && (
                <span className="ml-2 inline-flex items-center text-xs px-2 py-0.5 rounded bg-white/30 text-white">
                  {Math.round(scaleConfidence*100)}%{scaleMethod ? ` • ${scaleMethod}` : ''}
                </span>
              )}
            </div>
          ) : (
            <div className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-sm">⚠️ No Scale Set</div>
          )}
        </div>
      </div>

      {/* Canvas */}
  <div ref={containerRef} className="flex-1 min-h-0 overflow-auto p-4" style={{ overscrollBehavior: 'contain', touchAction: 'none' }}>
        {imageLoaded ? (
          <div className="flex justify-center">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={preventContext}
      className={`border border-gray-200 ${isPanCursor ? 'cursor-grabbing' : 'cursor-crosshair'} shadow-lg rounded`}
              style={{ 
                maxWidth: '100%',
                height: 'auto'
              }}
            />
      {mustCalibrate && mode !== 'calibrate' && mode !== 'calibrate-area' && (
              <div className="absolute mt-4 p-2 rounded bg-amber-100 text-amber-900 border border-amber-200 shadow">
        Please calibrate to begin. Use Calibrate Distance or Calibrate Area.
              </div>
            )}
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
        isFullscreen ? (
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
        ) : (
          <div className="p-4 bg-orange-50 border-t border-orange-200">
            <div className="flex flex-wrap items-center gap-3 text-sm text-orange-900">
              <span className="font-medium">Calibration:</span>
              <span>{calibrationPoints.length} point(s) selected{calibrationPoints.length === 2 ? ` • ${calibrationDistancePx().toFixed(3)} px` : ''}</span>
              <input type="number" step="any" placeholder="Known distance" value={calibrationReal} onChange={(e)=> setCalibrationReal(e.target.value)} className="px-2 py-1 border rounded" style={{minWidth:120}} />
              <select value={calibrationUnit} onChange={e=> setCalibrationUnit(e.target.value)} className="px-2 py-1 border rounded">
                <option value="meters">meters</option>
                <option value="feet">feet</option>
                <option value="centimeters">centimeters</option>
              </select>
              <button onClick={applyCalibration} className="px-3 py-1.5 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50" disabled={calibrationPoints.length !== 2 || !calibrationReal}>Apply</button>
            </div>
          </div>
        )
      )}

      {/* Calibrate by Area Panel */}
      {mode === 'calibrate-area' && (
        isFullscreen ? (
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
        ) : (
          <div className="p-4 bg-orange-50 border-t border-orange-200">
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
        )
      )}

  {/* Area Results - Professional */}
  {(selections.length > 0) && (
        isFullscreen ? (
          <div className="absolute right-4 top-32 bottom-4 w-80 z-[1100] p-4 bg-white/95 border rounded-lg shadow overflow-auto">
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900 mb-2">Summary</h3>
              {/* Unified selections list */}
            </div>
            <div className="space-y-3 mb-4">
              {selections.map((s, index) => (
                <div key={s.id} className="flex items-center justify-between p-3 bg-white rounded-lg border shadow-sm">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-orange-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">{index + 1}</span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{s.label || 'Area'}</p>
                    </div>
                  </div>
                    <div className="flex items-center space-x-3">
                    <div className="text-right">
                      <p className={`font-semibold ${s.value >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        {scale ? `${s.value.toFixed(2)} m²` : '—'}
                      </p>
                    </div>
                    <button onClick={() => { pushHistory(); setSelections(list => list.filter(it => it.id !== s.id)); }} className="w-6 h-6 bg-red-100 hover:bg-red-200 text-red-600 rounded-full flex items-center justify-center text-xs transition-colors">✕</button>
                  </div>
                </div>
              ))}
            </div>
            {scale && (
              <div className="p-3 bg-gradient-to-r from-blue-500 to-orange-500 rounded-lg text-white">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">Total</h4>
                  <p className="text-lg font-bold">{consolidatedTotal.toFixed(2)} m²</p>
                </div>
              </div>
            )}
            {/* Removed duplicate bottom Total card to keep a single Total in header */}
          </div>
        ) : (
          <div className="p-6 bg-gray-50">
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900 mb-2">Summary</h3>
              {/* Unified selections list */}
            </div>
            <div className="space-y-3 mb-4">
              {selections.map((s, index) => (
                <div key={s.id} className="flex items-center justify-between p-3 bg-white rounded-lg border shadow-sm">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-orange-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">{index + 1}</span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{s.label || 'Area'}</p>
                    </div>
                  </div>
                    <div className="flex items-center space-x-3">
                    <div className="text-right">
                      <p className={`font-semibold ${s.value >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        {scale ? `${s.value.toFixed(2)} m²` : '—'}
                      </p>
                    </div>
                    <button 
                      onClick={() => { pushHistory(); setSelections(list => list.filter(it => it.id !== s.id)); }}
                      className="w-6 h-6 bg-red-100 hover:bg-red-200 text-red-600 rounded-full flex items-center justify-center text-xs transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {scale && (
              <div className="p-3 bg-gradient-to-r from-blue-500 to-orange-500 rounded-lg text-white">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">Total</h4>
                  <p className="text-lg font-bold">{consolidatedTotal.toFixed(2)} m²</p>
                </div>
              </div>
            )}
            {/* Removed duplicate bottom Total card to keep a single Total in header */}
          </div>
        )
      )}

  {/* Current area/path status - Professional */}
  {currentArea.length > 0 && (
        isFullscreen ? (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[1100] p-3 rounded-lg bg-blue-50/95 border border-blue-200 shadow">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                <svg width="12" height="12" className="text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
                </svg>
              </div>
              <div>
  <p className="text-sm font-medium text-blue-800">{mode === 'measure' ? 'Measuring distance (press M to toggle)' : 'Drawing area'}</p>
  <p className="text-xs text-blue-600">{currentArea.length} points selected{mode === 'measure' ? ' • Add is disabled in Measure' : (currentArea.length >= 3 ? ' • Click "Add" to complete' : ` • ${3 - currentArea.length} more points needed`)}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-blue-50 border-t border-blue-200">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                <svg width="12" height="12" className="text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
                </svg>
              </div>
              <div>
  <p className="text-sm font-medium text-blue-800">{mode === 'measure' ? 'Measuring distance (press M to toggle)' : 'Drawing area'}</p>
  <p className="text-xs text-blue-600">{currentArea.length} points selected{mode === 'measure' ? ' • Add is disabled in Measure' : (currentArea.length >= 3 ? ' • Click "Add" to complete' : ` • ${3 - currentArea.length} more points needed`)}</p>
              </div>
            </div>
          </div>
        )
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

  const overlayTarget = (typeof window !== 'undefined' && document.getElementById('app-root')) || (typeof window !== 'undefined' ? document.body : null);
  // Format scale with higher precision while trimming trailing zeros
  function fmtScale(n: number) {
    if (!isFinite(n)) return String(n);
    const dec = Math.abs(n) >= 1 ? 4 : 6;
    return n.toFixed(dec).replace(/0+$/, '').replace(/\.$/, '');
  }
  const overlay = isFullscreen && overlayTarget
    ? createPortal(
        <div id="measure-overlay" data-keep="true" className="fixed inset-0 z-[2147483647] bg-white overflow-hidden flex flex-col min-h-0" style={{zIndex:2147483647}}>
          {content}
          {mustCalibrate && mode !== 'calibrate' && mode !== 'calibrate-area' && (
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
              <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md border">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Calibration required</h2>
                <p className="text-sm text-gray-600 mb-4">Set the scale before measuring. Choose a known distance (Calibrate Distance) or a known area (Calibrate Area).</p>
                <div className="flex items-center gap-3">
                  <button onClick={() => setMode('calibrate')} className="flex-1 px-4 py-2 rounded-lg bg-orange-600 text-white hover:bg-orange-700">Calibrate Distance</button>
                  <button onClick={() => setMode('calibrate-area')} className="flex-1 px-4 py-2 rounded-lg bg-orange-100 text-orange-900 hover:bg-orange-200">Calibrate Area</button>
                </div>
              </div>
            </div>
          )}
        </div>,
        overlayTarget
      )
    : null;
  const launcher = !isFullscreen && imageLoaded
    ? createPortal(
        <button
          type="button"
          onClick={() => setIsFullscreen(true)}
          className="fixed bottom-6 right-6 z-[99998] px-4 py-2 rounded-lg bg-blue-600 text-white shadow-lg hover:bg-blue-700 focus:outline-none"
          title="Open Measure Fullscreen"
        >
          Measure Fullscreen
        </button>,
        document.body
      )
    : null;
  return <>
    {content}
    {overlay}
    {!isFullscreen && launcher}
  </>;
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
