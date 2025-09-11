'use client';

import React, { useState, useEffect } from 'react';
import EmergencyTestButton from '@/components/EmergencyTestButton';

// Define types
interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Antenna {
  x: number;
  y: number;
  range: number;
}

interface Point {
  x: number;
  y: number;
}

const AdvancedAntennaTest = () => {
  const [message, setMessage] = useState('No test run yet');
  const [antennas, setAntennas] = useState<Antenna[]>([]);
  const [roomDimensions, setRoomDimensions] = useState({ width: 60, height: 40 }); // in meters
  const [antennaRange, setAntennaRange] = useState(15); // meters of coverage radius
  const [pixelsPerMeter, setPixelsPerMeter] = useState(10);
  const [showDebugPoints, setShowDebugPoints] = useState(true);
  const [debugPoints, setDebugPoints] = useState<Point[]>([]);

  // Canvas dimensions
  const canvasWidth = roomDimensions.width * pixelsPerMeter;
  const canvasHeight = roomDimensions.height * pixelsPerMeter;
  
  // Padding for the room inside the canvas
  const padding = 50;
  
  // Calculate room coordinates with padding
  const roomCoords = {
    x1: padding,
    y1: padding,
    x2: padding + (roomDimensions.width * pixelsPerMeter),
    y2: padding + (roomDimensions.height * pixelsPerMeter)
  };

  // Advanced antenna placement using a more sophisticated algorithm
  const placeAntennas = () => {
    try {
      setMessage('Running advanced antenna placement algorithm...');
      setDebugPoints([]);
      
      // Convert antenna range to pixels
      const rangePx = antennaRange * pixelsPerMeter;
      
      // Create the room walls
      const walls: Wall[] = [
        { x1: roomCoords.x1, y1: roomCoords.y1, x2: roomCoords.x2, y2: roomCoords.y1 }, // top
        { x1: roomCoords.x2, y1: roomCoords.y1, x2: roomCoords.x2, y2: roomCoords.y2 }, // right
        { x1: roomCoords.x2, y1: roomCoords.y2, x2: roomCoords.x1, y2: roomCoords.y2 }, // bottom
        { x1: roomCoords.x1, y1: roomCoords.y2, x2: roomCoords.x1, y2: roomCoords.y1 }  // left
      ];
      
      // Calculate grid size based on antenna range (place antennas at optimal distance)
      // Using range * 1.5 for spacing to avoid too much overlap
      const gridSize = rangePx * 1.5;
      
      // Generate candidate points on a grid
      const candidatePoints: Point[] = [];
      for (let x = roomCoords.x1 + gridSize/2; x < roomCoords.x2; x += gridSize) {
        for (let y = roomCoords.y1 + gridSize/2; y < roomCoords.y2; y += gridSize) {
          // Only add points inside the room
          if (x > roomCoords.x1 && x < roomCoords.x2 && y > roomCoords.y1 && y < roomCoords.y2) {
            candidatePoints.push({ x, y });
          }
        }
      }
      
      console.log(`Generated ${candidatePoints.length} candidate points with grid size ${gridSize}px`);
      
      // Store candidate points for debugging
      setDebugPoints(candidatePoints);
      
      // Place antennas at candidate points (in a real implementation, we would filter
      // these based on coverage optimization, but this is a simplified example)
      const newAntennas: Antenna[] = candidatePoints.map(point => ({
        x: point.x,
        y: point.y,
        range: rangePx
      }));
      
      setAntennas(newAntennas);
      setMessage(`Placed ${newAntennas.length} antennas with ${antennaRange}m range.`);
      
      // Draw
      drawCanvas(walls, newAntennas, candidatePoints);
    } catch (error: any) {
      console.error('Advanced antenna placement error:', error);
      setMessage(`Error: ${error.message || 'Unknown error'}`);
    }
  };
  
  // Draw the canvas with walls, antennas, and debug points
  const drawCanvas = (walls: Wall[], antennas: Antenna[], points: Point[]) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth + (padding * 2);
      canvas.height = canvasHeight + (padding * 2);
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setMessage('Error: Could not get canvas context');
        return;
      }
      
      // Clear canvas
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw room
      ctx.fillStyle = 'rgba(240, 240, 240, 0.5)';
      ctx.fillRect(roomCoords.x1, roomCoords.y1, roomCoords.x2 - roomCoords.x1, roomCoords.y2 - roomCoords.y1);
      
      // Draw walls
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 2;
      walls.forEach(wall => {
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.stroke();
      });
      
      // Draw debug points if enabled
      if (showDebugPoints) {
        ctx.fillStyle = 'rgba(200, 0, 0, 0.3)';
        points.forEach(point => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      
      // Draw antenna coverage areas
      antennas.forEach(antenna => {
        // Draw coverage area
        ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, antenna.range, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(0, 0, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, antenna.range, 0, Math.PI * 2);
        ctx.stroke();
      });
      
      // Draw antenna points
      antennas.forEach(antenna => {
        ctx.fillStyle = 'blue';
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, 5, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Add scale indicator
      ctx.fillStyle = 'black';
      ctx.font = '12px Arial';
      ctx.fillText(`Scale: ${pixelsPerMeter} pixels = 1 meter`, 10, 20);
      ctx.fillText(`Room: ${roomDimensions.width}m × ${roomDimensions.height}m`, 10, 40);
      ctx.fillText(`Antenna range: ${antennaRange}m`, 10, 60);
      
      // Insert the canvas into the DOM
      const canvasContainer = document.getElementById('advanced-antenna-test-canvas');
      if (canvasContainer) {
        canvasContainer.innerHTML = '';
        canvasContainer.appendChild(canvas);
      }
    } catch (error: any) {
      console.error('Drawing error:', error);
      setMessage(`Error drawing canvas: ${error.message || 'Unknown error'}`);
    }
  };
  
  // Initialize canvas on mount
  useEffect(() => {
    const walls: Wall[] = [
      { x1: roomCoords.x1, y1: roomCoords.y1, x2: roomCoords.x2, y2: roomCoords.y1 }, // top
      { x1: roomCoords.x2, y1: roomCoords.y1, x2: roomCoords.x2, y2: roomCoords.y2 }, // right
      { x1: roomCoords.x2, y1: roomCoords.y2, x2: roomCoords.x1, y2: roomCoords.y2 }, // bottom
      { x1: roomCoords.x1, y1: roomCoords.y2, x2: roomCoords.x1, y2: roomCoords.y1 }  // left
    ];
    drawCanvas(walls, [], []);
  }, [roomDimensions, pixelsPerMeter]);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Advanced Antenna Placement Test</h1>
      
      <div className="flex flex-wrap gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Room Width (meters)</label>
          <input
            type="number"
            value={roomDimensions.width}
            onChange={(e) => setRoomDimensions({...roomDimensions, width: Number(e.target.value)})}
            className="mt-1 block w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
            min="10"
            max="100"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Room Height (meters)</label>
          <input
            type="number"
            value={roomDimensions.height}
            onChange={(e) => setRoomDimensions({...roomDimensions, height: Number(e.target.value)})}
            className="mt-1 block w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
            min="10"
            max="100"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Antenna Range (meters)</label>
          <input
            type="number"
            value={antennaRange}
            onChange={(e) => setAntennaRange(Number(e.target.value))}
            className="mt-1 block w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
            min="5"
            max="30"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Pixels Per Meter</label>
          <input
            type="number"
            value={pixelsPerMeter}
            onChange={(e) => setPixelsPerMeter(Number(e.target.value))}
            className="mt-1 block w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
            min="1"
            max="20"
          />
        </div>
        
        <div className="flex items-end">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={showDebugPoints}
              onChange={(e) => setShowDebugPoints(e.target.checked)}
              className="mr-2 h-4 w-4"
            />
            <span className="text-sm font-medium text-gray-700">Show Debug Points</span>
          </label>
        </div>
      </div>
      
      <div className="mb-4">
        <button 
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mr-2"
          onClick={placeAntennas}
        >
          Place Antennas
        </button>
        
        <button 
          className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
          onClick={() => {
            setAntennas([]);
            setDebugPoints([]);
            const walls: Wall[] = [
              { x1: roomCoords.x1, y1: roomCoords.y1, x2: roomCoords.x2, y2: roomCoords.y1 }, // top
              { x1: roomCoords.x2, y1: roomCoords.y1, x2: roomCoords.x2, y2: roomCoords.y2 }, // right
              { x1: roomCoords.x2, y1: roomCoords.y2, x2: roomCoords.x1, y2: roomCoords.y2 }, // bottom
              { x1: roomCoords.x1, y1: roomCoords.y2, x2: roomCoords.x1, y2: roomCoords.y1 }  // left
            ];
            drawCanvas(walls, [], []);
            setMessage('Canvas cleared');
          }}
        >
          Clear
        </button>
      </div>
      
      <div className="p-2 bg-gray-100 rounded mb-4">
        <h2 className="font-bold">Result:</h2>
        <p>{message}</p>
        <p className="mt-2">Antennas placed: {antennas.length}</p>
        <p className="mt-1">Debug points: {debugPoints.length}</p>
      </div>
      
      <div 
        id="advanced-antenna-test-canvas" 
        className="border border-gray-300 rounded overflow-auto"
        style={{ maxWidth: '100%', maxHeight: '600px' }}
      >
        <p className="text-center p-4">Canvas will appear here when test is run</p>
      </div>
      
      <EmergencyTestButton onClick={placeAntennas} />
    </div>
  );
};

export default AdvancedAntennaTest;
