'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface FloorplanCanvasProps {
  imageUrl: string;
  scale: number | null;
  scaleUnit: string;
  onCalibrate?: (scale: number, unit: string) => void;
  requestCalibrateToken?: number; // increment to start calibrate from outside
  requestFullscreenToken?: number; // increment to open fullscreen from outside
  onFullscreenChange?: (isFs: boolean) => void;
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

export default function FloorplanCanvas({ imageUrl, scale, scaleUnit, onCalibrate, requestCalibrateToken, requestFullscreenToken, onFullscreenChange }: FloorplanCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [currentArea, setCurrentArea] = useState<Point[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [mode, setMode] = useState<'select' | 'calibrate'>('select');
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [calibrationReal, setCalibrationReal] = useState<string>("");
  const [calibrationUnit, setCalibrationUnit] = useState<string>('meters');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x:0, y:0});
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef<{x:number;y:number}|null>(null);
  const [isPanCursor, setIsPanCursor] = useState(false);
  const suppressClickRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Track last image url we've auto-opened for
  const lastAutoFsForUrlRef = useRef<string | null>(null);
  const lastFsTokenRef = useRef<number | undefined>(undefined);

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

      // Calculate display size to fit available container area while preserving aspect ratio
      const recalc = () => {
        const container = containerRef.current;
        if (!container) return;
        const availW = container.clientWidth || window.innerWidth;
        const availH = container.clientHeight || Math.floor(window.innerHeight * 0.8);
        const scale = Math.min(availW / img.width, availH / img.height, 1);
        const displayWidth = Math.max(1, Math.floor(img.width * scale));
        const displayHeight = Math.max(1, Math.floor(img.height * scale));
        setCanvasSize({ width: displayWidth, height: displayHeight });
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
      const availH = container.clientHeight || Math.floor(window.innerHeight * 0.8);
      const scaleFit = Math.min(availW / image.width, availH / image.height, 1);
      const displayWidth = Math.max(1, Math.floor(image.width * scaleFit));
      const displayHeight = Math.max(1, Math.floor(image.height * scaleFit));
      setCanvasSize({ width: displayWidth, height: displayHeight });
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
    if (prev.width > 0 && prev.height > 0 && (prev.width !== curr.width || prev.height !== curr.height)) {
      const sx = curr.width / prev.width;
      const sy = curr.height / prev.height;
      if (isFinite(sx) && isFinite(sy) && sx > 0 && sy > 0) {
        setAreas(a => a.map(ar => ({
          ...ar,
          points: ar.points.map(p => ({ x: p.x * sx, y: p.y * sy }))
        })));
        setCurrentArea(ca => ca.map(p => ({ x: p.x * sx, y: p.y * sy })));
        setCalibrationPoints(cp => cp.map(p => ({ x: p.x * sx, y: p.y * sy })));
        setPan(p => ({ x: p.x * sx, y: p.y * sy }));
      }
    }
    prevSizeRef.current = curr;
  }, [canvasSize.width, canvasSize.height]);

  // Draw canvas whenever dependencies change
  useEffect(() => {
    if (imageLoaded && image && canvasSize.width > 0) {
      drawCanvas();
    }
  }, [imageLoaded, image, canvasSize, areas, currentArea, mode, calibrationPoints, zoom, pan]);

  // Recompute areas when scale changes
  useEffect(() => {
    if (!image || !scale) return;
    setAreas(prev => prev.map(a => ({
      ...a,
      area: calculateArea(a.points)
    })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, scaleUnit]);

  const drawCanvas = () => {
    if (!image || !imageLoaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set canvas size
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    
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
    
    // Draw current area being drawn
    if (currentArea.length > 0) {
      drawArea(currentArea, 'Current Area');
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
  ctx.restore();
  };

  const drawArea = (points: Point[], label: string, area?: number) => {
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
      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.fill();
    }

    ctx.strokeStyle = 'rgb(59, 130, 246)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw points
    points.forEach(point => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgb(239, 68, 68)';
      ctx.fill();
    });

    // Draw label and area
    if (points.length > 0) {
      const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

      ctx.fillStyle = 'black';
      ctx.font = '14px Arial';
      ctx.fillText(label, centerX, centerY - 10);

  if (typeof area === 'number') {
        ctx.fillText(`${area.toFixed(2)} ${scaleUnit}²`, centerX, centerY + 10);
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
    if (mode === 'select') {
      const newPoint = { x, y };
      setCurrentArea([...currentArea, newPoint]);
    } else if (mode === 'calibrate') {
      const p = { x, y };
      if (calibrationPoints.length < 2) {
        setCalibrationPoints(prev => [...prev, p]);
      } else {
        setCalibrationPoints([p]);
      }
    }
  };

  const finishArea = () => {
    if (currentArea.length < 3) {
      alert('Please select at least 3 points to create an area');
      return;
    }
    
    const area = calculateArea(currentArea);
    const newArea: Area = {
      id: Date.now().toString(),
      points: [...currentArea],
      area: area
    };
    
    setAreas(prevAreas => [...prevAreas, newArea]);
    setCurrentArea([]);
  };

  const clearAll = () => {
    setAreas([]);
    setCurrentArea([]);
    setCalibrationPoints([]);
  };

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

  // Zoom with wheel
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.1;
    const newZoom = Math.min(5, Math.max(0.2, zoom + delta));
    if (newZoom === zoom) return;
    // Zoom to mouse position using latest pan values
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = (e.clientX - rect.left) * ((e.target as HTMLCanvasElement).width / rect.width);
    const my = (e.clientY - rect.top) * ((e.target as HTMLCanvasElement).height / rect.height);
    setPan(prev => {
      const r = newZoom / zoom;
      return { x: mx - r * (mx - prev.x), y: my - r * (my - prev.y) };
    });
    setZoom(newZoom);
  };

  // Pan with right- or middle-mouse drag
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      isPanningRef.current = true;
      setIsPanCursor(true);
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      suppressClickRef.current = true;
    } else if (e.button === 0) {
      // left click handled by onClick
      return;
    }
  };
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPanningRef.current || !lastMouseRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
  };
  const handleMouseUp = () => { 
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

  // Outside trigger to start calibrate
  useEffect(() => {
    if (requestCalibrateToken !== undefined) {
      setMode('calibrate');
      setCalibrationPoints([]);
    }
  }, [requestCalibrateToken]);

  // Exit browser-overlay fullscreen on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const content = (
    <div className="flex flex-col relative h-full min-h-0">
      {/* Controls */}
      <div className="bg-gradient-to-r from-blue-500 to-orange-500 px-6 py-4 flex justify-between items-center flex-wrap gap-3">
        <div className="flex items-center space-x-3">
          <button type="button"
            onClick={() => setMode('select')}
            className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${
              mode === 'select' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
          >
            Select Area
          </button>
          <button type="button"
            onClick={() => { setMode(mode === 'calibrate' ? 'select' : 'calibrate'); setCalibrationPoints([]); }}
            className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${
              mode === 'calibrate' 
                ? 'bg-white text-orange-600 shadow-sm' 
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
          >
            Calibrate
          </button>
          <button type="button"
            onClick={finishArea}
            disabled={currentArea.length < 3}
            className="bg-green-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-600 disabled:bg-white/20 disabled:cursor-not-allowed transition-all transform hover:scale-105 shadow-sm"
          >
            Finish ({currentArea.length})
          </button>
          <button type="button"
            onClick={clearAll}
            className="bg-red-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-600 transition-all transform hover:scale-105 shadow-sm"
          >
            Clear All
          </button>
          <button type="button"
            onClick={() => setIsFullscreen(v => !v)}
            className="bg-white/20 text-white px-4 py-2 rounded-lg font-medium hover:bg-white/30 transition-all transform hover:scale-105 shadow-sm"
            title={isFullscreen ? 'Exit fullscreen' : 'Open fullscreen'}
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
        
        <div className="flex items-center space-x-2">
          {scale ? (
            <div className="px-3 py-1.5 bg-white/20 text-white rounded-lg text-sm backdrop-blur-sm">
              📏 Scale: 1px = {scale} {scaleUnit}
            </div>
          ) : (
            <div className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-sm">
              ⚠️ No Scale Set
            </div>
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
              <span>{calibrationPoints.length} point(s) selected{calibrationPoints.length === 2 ? ` • ${calibrationDistancePx().toFixed(1)} px` : ''}</span>
              <input type="number" placeholder="Known distance" value={calibrationReal} onChange={(e)=> setCalibrationReal(e.target.value)} className="px-2 py-1 border rounded" style={{minWidth:120}} />
              <select value={calibrationUnit} onChange={e=> setCalibrationUnit(e.target.value)} className="px-2 py-1 border rounded">
                <option value="meters">meters</option>
                <option value="feet">feet</option>
                <option value="centimeters">centimeters</option>
              </select>
              <button onClick={applyCalibration} className="px-3 py-1.5 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50" disabled={calibrationPoints.length !== 2 || !calibrationReal}>Apply</button>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-orange-50 border-t border-orange-200">
            <div className="flex flex-wrap items-center gap-3 text-sm text-orange-900">
              <span className="font-medium">Calibration:</span>
              <span>{calibrationPoints.length} point(s) selected{calibrationPoints.length === 2 ? ` • ${calibrationDistancePx().toFixed(1)} px` : ''}</span>
              <input type="number" placeholder="Known distance" value={calibrationReal} onChange={(e)=> setCalibrationReal(e.target.value)} className="px-2 py-1 border rounded" style={{minWidth:120}} />
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

      {/* Area Results - Professional */}
      {areas.length > 0 && (
        isFullscreen ? (
          <div className="absolute right-4 top-24 bottom-4 w-96 z-[1100] p-4 bg-white/95 border rounded-lg shadow overflow-auto">
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900 mb-2">Calculated Areas</h3>
              <p className="text-sm text-gray-600">{areas.length} area{areas.length !== 1 ? 's' : ''} measured</p>
            </div>
            <div className="space-y-3 mb-4">
              {areas.map((area, index) => (
                <div key={area.id} className="flex items-center justify-between p-3 bg-white rounded-lg border shadow-sm">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-orange-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">{index + 1}</span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Area {index + 1}</p>
                      <p className="text-sm text-gray-500">{area.points.length} points</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="text-right">
                      <p className="font-semibold text-blue-600">
                        {area.area !== undefined ? `${area.area.toFixed(2)} ${scaleUnit}²` : 'No scale set'}
                      </p>
                    </div>
                    <button onClick={() => setAreas(areas.filter(a => a.id !== area.id))} className="w-6 h-6 bg-red-100 hover:bg-red-200 text-red-600 rounded-full flex items-center justify-center text-xs transition-colors">✕</button>
                  </div>
                </div>
              ))}
            </div>
            {scale && (
              <div className="p-4 bg-gradient-to-r from-blue-500 to-orange-500 rounded-lg">
                <div className="flex items-center justify-between text-white">
                  <h4 className="font-semibold">Total Area</h4>
                  <p className="text-xl font-bold">{areas.reduce((sum, area) => sum + (area.area || 0), 0).toFixed(2)} {scaleUnit}²</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 bg-gray-50">
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900 mb-2">Calculated Areas</h3>
              <p className="text-sm text-gray-600">{areas.length} area{areas.length !== 1 ? 's' : ''} measured</p>
            </div>
            <div className="space-y-3 mb-4">
              {areas.map((area, index) => (
                <div key={area.id} className="flex items-center justify-between p-3 bg-white rounded-lg border shadow-sm">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-orange-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">{index + 1}</span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Area {index + 1}</p>
                      <p className="text-sm text-gray-500">{area.points.length} points</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="text-right">
                      <p className="font-semibold text-blue-600">
                        {area.area !== undefined ? `${area.area.toFixed(2)} ${scaleUnit}²` : 'No scale set'}
                      </p>
                    </div>
                    <button 
                      onClick={() => {
                        const newAreas = areas.filter(a => a.id !== area.id);
                        setAreas(newAreas);
                      }}
                      className="w-6 h-6 bg-red-100 hover:bg-red-200 text-red-600 rounded-full flex items-center justify-center text-xs transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {scale && (
              <div className="p-4 bg-gradient-to-r from-blue-500 to-orange-500 rounded-lg">
                <div className="flex items-center justify-between text-white">
                  <h4 className="font-semibold">Total Area</h4>
                  <p className="text-xl font-bold">
                    {areas.reduce((sum, area) => sum + (area.area || 0), 0).toFixed(2)} {scaleUnit}²
                  </p>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* Current area status - Professional */}
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
                <p className="text-sm font-medium text-blue-800">Drawing in progress</p>
                <p className="text-xs text-blue-600">{currentArea.length} points selected{currentArea.length >= 3 ? ' • Click "Finish" to complete' : ` • ${3 - currentArea.length} more points needed`}</p>
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
                <p className="text-sm font-medium text-blue-800">Drawing in progress</p>
                <p className="text-xs text-blue-600">{currentArea.length} points selected{currentArea.length >= 3 ? ' • Click "Finish" to complete' : ` • ${3 - currentArea.length} more points needed`}</p>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );

  const overlayTarget = (typeof window !== 'undefined' && document.getElementById('app-root')) || (typeof window !== 'undefined' ? document.body : null);
  const overlay = isFullscreen && overlayTarget
    ? createPortal(
        <div id="measure-overlay" data-keep="true" className="fixed inset-0 z-[2147483647] bg-white overflow-hidden flex flex-col min-h-0" style={{zIndex:2147483647}}>
          {content}
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
