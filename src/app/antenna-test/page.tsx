'use client';

import React, { useState } from 'react';
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

const AntennaTest = () => {
  const [message, setMessage] = useState('No test run yet');
  const [antennas, setAntennas] = useState<Antenna[]>([]);
  const [gridSize, setGridSize] = useState(5); // meters between grid points
  const [antennaRange, setAntennaRange] = useState(10); // meters of coverage radius

  // Simple grid-based antenna placement
  const autoPlaceAntennas = () => {
    try {
    setMessage('Running antenna placement algorithm...');

    // Test environment
    const pixelsPerMeter = 10; // 10 pixels = 1 meter
      
      // Create a simple room boundary (rectangle)
      const roomBoundary: Wall[] = [
        { x1: 100, y1: 100, x2: 700, y2: 100 }, // top
        { x1: 700, y1: 100, x2: 700, y2: 500 }, // right
        { x1: 700, y1: 500, x2: 100, y2: 500 }, // bottom
        { x1: 100, y1: 500, x2: 100, y2: 100 }  // left
      ];
      
      // Convert grid size from meters to pixels
      const gridSizePixels = gridSize * pixelsPerMeter;
      const rangePixels = antennaRange * pixelsPerMeter;
      
      // Create grid points across the canvas
      const gridPoints: {x: number, y: number}[] = [];
      for (let x = 100 + gridSizePixels; x < 700; x += gridSizePixels) {
        for (let y = 100 + gridSizePixels; y < 500; y += gridSizePixels) {
          gridPoints.push({ x, y });
        }
      }
      
      console.log(`Created ${gridPoints.length} grid points with grid size ${gridSize}m (${gridSizePixels}px)`);
      
      // Simply place antennas at grid points
      const newAntennas: Antenna[] = gridPoints.map(point => ({
        x: point.x,
        y: point.y,
        range: rangePixels
      }));
      
      setAntennas(newAntennas);
      setMessage(`Placed ${newAntennas.length} antennas on a grid with ${gridSize}m spacing and ${antennaRange}m range.`);
      
      // Redraw
      drawTestCanvas(roomBoundary, newAntennas);
    } catch (error: any) {
      console.error('Antenna placement error:', error);
      setMessage(`Error during antenna placement: ${error.message || 'Unknown error'}`);
    }
  };
  
  // Draw the test canvas
  const drawTestCanvas = (walls: Wall[], antennas: Antenna[]) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setMessage('Error: Could not get canvas context');
        return;
      }
      
      // Clear canvas
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw walls
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 2;
      walls.forEach(wall => {
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.stroke();
      });
      
      // Draw antennas
      antennas.forEach(antenna => {
        // Draw coverage area
        ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, antenna.range, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw antenna point
        ctx.fillStyle = 'blue';
        ctx.beginPath();
        ctx.arc(antenna.x, antenna.y, 5, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Insert the canvas into the DOM
      const canvasContainer = document.getElementById('antenna-test-canvas');
      if (canvasContainer) {
        canvasContainer.innerHTML = '';
        canvasContainer.appendChild(canvas);
      }
    } catch (error: any) {
      console.error('Drawing error:', error);
      setMessage(`Error drawing canvas: ${error.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Simplified Antenna Placement Test</h1>
      
      <div className="flex space-x-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Grid Spacing (meters)</label>
          <input
            type="number"
            value={gridSize}
            onChange={(e) => setGridSize(Number(e.target.value))}
            className="mt-1 block w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
            min="1"
            max="20"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Antenna Range (meters)</label>
          <input
            type="number"
            value={antennaRange}
            onChange={(e) => setAntennaRange(Number(e.target.value))}
            className="mt-1 block w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
            min="1"
            max="50"
          />
        </div>
      </div>
      
      <div className="mb-4">
        <button 
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mr-2"
          onClick={autoPlaceAntennas}
        >
          Place Antennas
        </button>
      </div>
      
      <div className="p-2 bg-gray-100 rounded mb-4">
        <h2 className="font-bold">Result:</h2>
        <p>{message}</p>
        <p className="mt-2">Antennas placed: {antennas.length}</p>
      </div>
      
      <div 
        id="antenna-test-canvas" 
        className="border border-gray-300 rounded"
        style={{ width: '800px', height: '600px' }}
      >
        <p className="text-center p-4">Canvas will appear here when test is run</p>
      </div>
      
      <EmergencyTestButton onClick={autoPlaceAntennas} />
    </div>
  );
};

export default AntennaTest;
