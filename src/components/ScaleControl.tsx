'use client';

import { useState } from 'react';

interface ScaleControlProps {
  onScaleSet: (scale: number, unit: string) => void;
  currentScale: number | null;
  currentUnit: string;
  onRequestCalibrate?: () => void;
}

export default function ScaleControl({ onScaleSet, currentScale, currentUnit, onRequestCalibrate }: ScaleControlProps) {
  const [unit] = useState('meters');

  const handleAutoDetect = async () => {
    // TODO: Implement AI scale detection
    alert('AI scale detection will be implemented here');
  };

  // Manual numeric entry removed; prefer Calibrate on canvas

  return (
    <div className="space-y-4">
      {currentScale ? (
        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
              <svg width="12" height="12" className="text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-green-800">Scale Configured</p>
              <p className="text-xs text-green-600">1 pixel = {currentScale} {currentUnit}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center">
              <svg width="12" height="12" className="text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-amber-800">Scale Required</p>
              <p className="text-xs text-amber-600">Set scale for accurate measurements</p>
            </div>
          </div>
        </div>
      )}

          <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleAutoDetect}
          className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:from-blue-600 hover:to-blue-700 transition-all transform hover:scale-105 shadow-sm"
        >
          Auto Detect
        </button>
            <button
              onClick={() => onRequestCalibrate && onRequestCalibrate()}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all transform hover:scale-105 shadow-sm bg-white text-gray-700 border border-gray-300 hover:bg-gray-50`}
            >
              Start Calibrate
            </button>
      </div>

          <p className="text-xs text-gray-500">
            Tip: Prefer Calibrate — click two points of a known distance on the plan to set scale automatically.
          </p>
    </div>
  );
}
