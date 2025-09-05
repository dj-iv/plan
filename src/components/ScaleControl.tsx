'use client';

import { useState } from 'react';

interface ScaleControlProps {
  onScaleSet: (scale: number, unit: string) => void;
  currentScale: number | null;
  currentUnit: string;
}

export default function ScaleControl({ onScaleSet, currentScale, currentUnit }: ScaleControlProps) {
  const [isManualMode, setIsManualMode] = useState(false);
  const [referenceLength, setReferenceLength] = useState('');
  const [unit, setUnit] = useState('meters');

  const handleAutoDetect = async () => {
    // TODO: Implement AI scale detection
    alert('AI scale detection will be implemented here');
  };

  const handleManualScale = () => {
    if (!referenceLength || isNaN(parseFloat(referenceLength))) {
      alert('Please enter a valid reference length');
      return;
    }
    
    const scale = parseFloat(referenceLength);
    onScaleSet(scale, unit);
    alert(`Scale set: 1 pixel = ${scale} ${unit}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex space-x-2">
        <button
          onClick={handleAutoDetect}
          className="flex-1 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition-colors"
        >
          Auto Detect Scale
        </button>
        <button
          onClick={() => setIsManualMode(!isManualMode)}
          className={`flex-1 px-4 py-2 rounded transition-colors ${
            isManualMode 
              ? 'bg-gray-500 text-white hover:bg-gray-600' 
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          Manual Scale
        </button>
      </div>

      {isManualMode && (
        <div className="space-y-3 p-4 bg-gray-50 rounded border">
          <p className="text-sm text-gray-600">
            1. Draw a line on a known distance in the floorplan
            2. Enter the real-world length below
          </p>
          
          <div className="flex space-x-2">
            <input
              type="number"
              placeholder="Length"
              value={referenceLength}
              onChange={(e) => setReferenceLength(e.target.value)}
              className="flex-1 px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="meters">meters</option>
              <option value="feet">feet</option>
              <option value="centimeters">cm</option>
            </select>
          </div>
          
          <button
            onClick={handleManualScale}
            className="w-full bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 transition-colors"
          >
            Set Scale
          </button>
        </div>
      )}

      {currentScale && (
        <div className="p-3 bg-blue-50 rounded border border-blue-200">
          <p className="text-sm text-blue-800">
            ✓ Scale set: 1 pixel = {currentScale} {currentUnit}
          </p>
        </div>
      )}
    </div>
  );
}
