'use client';

import React from 'react';
import Link from 'next/link';

const TestNavigation = () => {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Floorplan Test Navigation</h1>
      
      <div className="space-y-4">
        <div className="p-4 border rounded-md bg-gray-50">
          <h2 className="text-xl font-semibold mb-2">Test Pages</h2>
          <ul className="space-y-2">
            <li>
              <Link href="/test" className="text-blue-500 hover:text-blue-700 underline">
                Basic Test Page
              </Link>
              <p className="text-sm text-gray-600">Simple canvas test with fixed antenna positions</p>
            </li>
            <li>
              <Link href="/antenna-test" className="text-blue-500 hover:text-blue-700 underline">
                Antenna Placement Test
              </Link>
              <p className="text-sm text-gray-600">Grid-based antenna placement with configurable settings</p>
            </li>
            <li>
              <Link href="/advanced-antenna-test" className="text-blue-500 hover:text-blue-700 underline">
                Advanced Antenna Test
              </Link>
              <p className="text-sm text-gray-600">More sophisticated antenna placement with detailed room settings</p>
            </li>
            <li>
              <Link href="/" className="text-blue-500 hover:text-blue-700 underline">
                Main Application
              </Link>
              <p className="text-sm text-gray-600">Return to the main floorplan application</p>
            </li>
          </ul>
        </div>
        
        <div className="p-4 border rounded-md bg-gray-50">
          <h2 className="text-xl font-semibold mb-2">Debugging Information</h2>
          <p>These test pages are designed to isolate and test specific functionality:</p>
          <ul className="list-disc ml-6 mt-2 space-y-1">
            <li>Isolated from complex component interactions</li>
            <li>Simplified rendering for direct testing</li>
            <li>Clear visual feedback</li>
            <li>Detailed console logging</li>
          </ul>
          <p className="mt-2 text-sm text-gray-600">
            Use the browser console (F12) to view detailed logs and error messages.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TestNavigation;
