'use client';

import { useEffect, useRef, useState } from 'react';

interface FloorplanCanvasProps {
  imageUrl: string;
  scale: number | null;
  scaleUnit: string;
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

export default function FloorplanCanvas({ imageUrl, scale, scaleUnit }: FloorplanCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentArea, setCurrentArea] = useState<Point[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [mode, setMode] = useState<'select' | 'reference'>('select');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const context = canvas.getContext('2d');
    setCtx(context);
  }, []);

  useEffect(() => {
    if (!imageUrl) return;
    
    const img = new Image();
    img.onload = () => {
      setImage(img);
      if (canvasRef.current && ctx) {
        // Set canvas size to match image
        canvasRef.current.width = img.width;
        canvasRef.current.height = img.height;
        drawCanvas();
      }
    };
    img.src = imageUrl;
  }, [imageUrl, ctx]);

  const drawCanvas = () => {
    if (!ctx || !image) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    // Draw image
    ctx.drawImage(image, 0, 0);
    
    // Draw existing areas
    areas.forEach((area, index) => {
      drawArea(area.points, `Area ${index + 1}`, area.area);
    });
    
    // Draw current area being drawn
    if (currentArea.length > 0) {
      drawArea(currentArea, 'Current Area');
    }
  };

  const drawArea = (points: Point[], label: string, area?: number) => {
    if (!ctx || points.length < 2) return;
    
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
      
      if (area) {
        ctx.fillText(`${area.toFixed(2)} ${scaleUnit}²`, centerX, centerY + 10);
      }
    }
  };

  const calculateArea = (points: Point[]): number => {
    if (points.length < 3 || !scale) return 0;
    
    // Use shoelace formula
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    area = Math.abs(area) / 2;
    
    // Convert from pixels to real units
    return area * scale * scale;
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    if (mode === 'select') {
      const newPoint = { x, y };
      setCurrentArea([...currentArea, newPoint]);
      drawCanvas();
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
    
    setAreas([...areas, newArea]);
    setCurrentArea([]);
    drawCanvas();
  };

  const clearAll = () => {
    setAreas([]);
    setCurrentArea([]);
    drawCanvas();
  };

  useEffect(() => {
    drawCanvas();
  }, [ctx, image, areas, currentArea]);

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="p-4 border-b bg-gray-50 flex justify-between items-center flex-wrap gap-2">
        <div className="flex space-x-2">
          <button
            onClick={() => setMode('select')}
            className={`px-4 py-2 rounded transition-colors ${
              mode === 'select' 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Select Area
          </button>
          <button
            onClick={finishArea}
            disabled={currentArea.length < 3}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Finish Area
          </button>
          <button
            onClick={clearAll}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
          >
            Clear All
          </button>
        </div>
        
        <div className="text-sm text-gray-600">
          {scale ? `Scale: 1px = ${scale} ${scaleUnit}` : 'No scale set'}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-auto p-4">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="border border-gray-200 cursor-crosshair max-w-full h-auto"
          style={{ maxHeight: 'calc(100vh - 300px)' }}
        />
      </div>

      {/* Area List */}
      {areas.length > 0 && (
        <div className="p-4 border-t bg-gray-50">
          <h3 className="font-semibold mb-2">Calculated Areas:</h3>
          <div className="space-y-1">
            {areas.map((area, index) => (
              <div key={area.id} className="text-sm">
                Area {index + 1}: {area.area ? `${area.area.toFixed(2)} ${scaleUnit}²` : 'No scale set'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
