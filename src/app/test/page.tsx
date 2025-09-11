'use client';

import React, { useState, useEffect } from 'react';
import EmergencyTestButton from '@/components/EmergencyTestButton';

const TestPage = () => {
  const [message, setMessage] = useState('No test run yet');

  const runTest = () => {
    try {
      setMessage('Running test...');
      
      // Simple test to place antennas in predefined positions
      const mockCanvas = document.createElement('canvas');
      mockCanvas.width = 800;
      mockCanvas.height = 600;
      
      // Create test data
      const testData = {
        width: 800,
        height: 600,
        scale: 10, // 10 pixels = 1 meter
        walls: [
          // Sample walls
          { x1: 100, y1: 100, x2: 700, y2: 100 },
          { x1: 700, y1: 100, x2: 700, y2: 500 },
          { x1: 700, y1: 500, x2: 100, y2: 500 },
          { x1: 100, y1: 500, x2: 100, y2: 100 },
        ]
      };
      
      // Place antennas at fixed positions (this is a simplified test)
      const antennas = [
        { x: 200, y: 200, range: 50 },
        { x: 600, y: 200, range: 50 },
        { x: 400, y: 400, range: 50 }
      ];
      
      // Log the result
      console.log('Test antennas:', antennas);
      setMessage(`Test completed. Placed ${antennas.length} antennas at fixed positions. Check console for details.`);
      
      // Draw on test canvas for verification
      const ctx = mockCanvas.getContext('2d');
      if (ctx) {
        // Draw walls
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        testData.walls.forEach(wall => {
          ctx.beginPath();
          ctx.moveTo(wall.x1, wall.y1);
          ctx.lineTo(wall.x2, wall.y2);
          ctx.stroke();
        });
        
        // Draw antennas
        antennas.forEach(antenna => {
          // Draw antenna
          ctx.fillStyle = 'blue';
          ctx.beginPath();
          ctx.arc(antenna.x, antenna.y, 5, 0, Math.PI * 2);
          ctx.fill();
          
          // Draw coverage range
          ctx.strokeStyle = 'rgba(0, 0, 255, 0.3)';
          ctx.beginPath();
          ctx.arc(antenna.x, antenna.y, antenna.range, 0, Math.PI * 2);
          ctx.stroke();
        });
        
        // Insert the canvas into the DOM for visualization
        const canvasContainer = document.getElementById('test-canvas-container');
        if (canvasContainer) {
          canvasContainer.innerHTML = '';
          canvasContainer.appendChild(mockCanvas);
        }
      }
    } catch (error: any) {
      console.error('Test error:', error);
      setMessage(`Error during test: ${error.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Antenna Placement Test Page</h1>
      
      <div className="mb-4">
        <button 
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={runTest}
        >
          Run Simple Antenna Test
        </button>
      </div>
      
      <div className="p-2 bg-gray-100 rounded mb-4">
        <h2 className="font-bold">Test Result:</h2>
        <p>{message}</p>
      </div>
      
      <div 
        id="test-canvas-container" 
        className="border border-gray-300 rounded"
        style={{ width: '800px', height: '600px' }}
      >
        <p className="text-center p-4">Canvas will appear here when test is run</p>
      </div>
      
      <EmergencyTestButton onClick={runTest} />
    </div>
  );
};

export default TestPage;
